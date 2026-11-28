/*
 * mbtiles.js — خواندن مستقیم فایل MBTiles (SQLite) رستری از روی Blob/File، بدون سرور و بدون بارگذاری کل فایل در حافظه.
 * فقط صفحه‌های لازم (ایندکس + تایل) با File.slice خوانده می‌شوند؛ کش صفحات حدود ۴۸ مگابایت.
 * پشتیبانی: جدول tiles (rowid یا WITHOUT ROWID) و ساختار map + images. فرمت تصویر: PNG / JPEG / WebP.
 * محدودیت: فایل باید روی (zoom_level, tile_column, tile_row) ایندکس داشته باشد (تقریباً همه‌ی ابزارها می‌سازند).
 */
(function (g) {
  'use strict';
  const TD = new TextDecoder('utf-8');
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  let VL = 0; /* طول آخرین varint خوانده‌شده */
  function vi(b, o) {
    let v = 0;
    for (let i = 0; i < 8; i++) { const c = b[o + i]; v = v * 128 + (c & 127); if (!(c & 128)) { VL = i + 1; return v; } }
    v = v * 256 + b[o + 8]; VL = 9; return v;
  }
  function sint(b, o, n) {
    let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
    if (b[o] & 128) v -= Math.pow(2, 8 * n); return v;
  }
  const SZ = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0];
  /* خواندن ستون‌های اول یک رکورد SQLite؛ end = پایان بایت‌های موجود (بخش محلی صفحه) */
  function parseRec(b, start, end, maxCols) {
    let o = start; const hs = vi(b, o); o += VL; const hend = start + hs, types = [];
    while (o < hend && types.length < maxCols) { types.push(vi(b, o)); o += VL; }
    let d = hend; const vals = [];
    for (const t of types) {
      let v = null;
      if (t === 0) v = null;
      else if (t <= 6) { v = sint(b, d, SZ[t]); d += SZ[t]; }
      else if (t === 7) { v = new DataView(b.buffer, b.byteOffset + d, 8).getFloat64(0); d += 8; }
      else if (t === 8) v = 0;
      else if (t === 9) v = 1;
      else if (t >= 12) {
        const n = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2, e = Math.min(d + n, end);
        v = t % 2 === 0 ? b.subarray(d, e) : TD.decode(b.subarray(d, e)); d += n;
      }
      vals.push(v);
    }
    return vals;
  }
  const rank = v => v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3;
  function cmpVal(a, b) {
    const ra = rank(a), rb = rank(b); if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 1 || ra === 2) return a < b ? -1 : a > b ? 1 : 0;
    if (ra === 3) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return a.length - b.length; }
    return 0;
  }
  const cmpKey = (key, rec) => { for (let i = 0; i < key.length; i++) { const c = cmpVal(key[i], rec[i] === undefined ? null : rec[i]); if (c) return c; } return 0; };

  class SQLiteRO {
    constructor(blob) { this.blob = blob; this.cache = new Map(); this.fl = new Map(); }
    async read(off, len) {
      if (off >= this.blob.size) return new Uint8Array(0);
      if (off + len > this.blob.size) len = this.blob.size - off;
      return new Uint8Array(await this.blob.slice(off, off + len).arrayBuffer());
    }
    async open() {
      const h = await this.read(0, 100);
      if (h.length < 100 || TD.decode(h.subarray(0, 15)) !== 'SQLite format 3') throw new Error('این فایل SQLite/MBTiles معتبر نیست');
      let ps = (h[16] << 8) | h[17]; if (ps === 1) ps = 65536;
      this.ps = ps; this.U = ps - h[20];
      const enc = u32(h, 56); if (enc > 1) throw new Error('رمزگذاری متن UTF-16 پشتیبانی نمی‌شود');
      this.maxPages = Math.max(256, Math.floor(48 * 1048576 / ps));
      this.schema = [];
      await this.scanTable(1, r => this.schema.push({ type: r[0], name: r[1], tbl: r[2], root: r[3], sql: r[4] }));
    }
    put(n, b) { this.cache.set(n, b); if (this.cache.size > this.maxPages) this.cache.delete(this.cache.keys().next().value); }
    async page(n) {
      const c = this.cache.get(n); if (c) { this.cache.delete(n); this.cache.set(n, c); return c; }
      const f = this.fl.get(n); if (f) return f;
      const p = this.read((n - 1) * this.ps, this.ps).then(b => { this.fl.delete(n); this.put(n, b); return b; }, e => { this.fl.delete(n); throw e; });
      this.fl.set(n, p); return p;
    }
    /* خواندن چند صفحه‌ی پشت‌سرهم با یک درخواست (زنجیره‌ی overflow معمولاً پیوسته است) */
    async pageRA(n, count) {
      const c = this.cache.get(n); if (c) return c;
      count = Math.max(1, Math.min(count, Math.floor(262144 / this.ps) || 1));
      if (count === 1) return this.page(n);
      const b = await this.read((n - 1) * this.ps, count * this.ps);
      for (let i = 0; i * this.ps < b.length; i++) this.put(n + i, b.subarray(i * this.ps, (i + 1) * this.ps));
      return this.cache.get(n) || this.page(n);
    }
    bt(pg, hdr) {
      const type = pg[hdr], n = (pg[hdr + 3] << 8) | pg[hdr + 4], hs = (type === 2 || type === 5) ? 12 : 8;
      if (type !== 2 && type !== 5 && type !== 10 && type !== 13) throw new Error('ساختار فایل SQLite خراب است');
      const arr = new Array(n); for (let i = 0; i < n; i++) arr[i] = (pg[hdr + hs + 2 * i] << 8) | pg[hdr + hs + 2 * i + 1];
      return { type, n, arr, right: hs === 12 ? u32(pg, hdr + 8) : 0 };
    }
    cell(pg, off, type) {
      const U = this.U; let left = 0, rowid = 0, P = 0, ps = 0, X;
      if (type === 5) { left = u32(pg, off); rowid = vi(pg, off + 4); return { left, rowid }; }
      if (type === 13) { P = vi(pg, off); let o = off + VL; rowid = vi(pg, o); o += VL; ps = o; X = U - 35; }
      else if (type === 10) { P = vi(pg, off); ps = off + VL; X = Math.floor((U - 12) * 64 / 255) - 23; }
      else { left = u32(pg, off); P = vi(pg, off + 4); ps = off + 4 + VL; X = Math.floor((U - 12) * 64 / 255) - 23; }
      let local = P;
      if (P > X) { const M = Math.floor((U - 12) * 32 / 255) - 23, K = M + ((P - M) % (U - 4)); local = K <= X ? K : M; }
      return { left, rowid, psize: P, pstart: ps, local, ovf: P > local ? u32(pg, ps + local) : 0 };
    }
    async fullPayload(pg, ci) {
      if (!ci.ovf) return pg.subarray(ci.pstart, ci.pstart + ci.psize);
      const out = new Uint8Array(ci.psize); out.set(pg.subarray(ci.pstart, ci.pstart + ci.local), 0);
      let pos = ci.local, next = ci.ovf; const U4 = this.U - 4;
      while (pos < ci.psize && next) {
        const p = await this.pageRA(next, Math.ceil((ci.psize - pos) / U4));
        const n = Math.min(U4, ci.psize - pos); out.set(p.subarray(4, 4 + n), pos); pos += n; next = u32(p, 0);
      }
      return out;
    }
    async scanTable(root, fn) {
      const pg = await this.page(root), b = this.bt(pg, root === 1 ? 100 : 0);
      if (b.type === 13) { for (const off of b.arr) { const ci = this.cell(pg, off, 13), pl = await this.fullPayload(pg, ci); fn(parseRec(pl, 0, pl.length, 99), ci.rowid); } }
      else if (b.type === 5) { for (const off of b.arr) await this.scanTable(this.cell(pg, off, 5).left, fn); await this.scanTable(b.right, fn); }
    }
    /* جستجوی کلید در b-tree ایندکس (یا جدول WITHOUT ROWID) → {pg,ci,rec} یا null */
    async indexFind(root, key) {
      let n = root;
      for (let depth = 0; depth < 40; depth++) {
        const pg = await this.page(n), b = this.bt(pg, n === 1 ? 100 : 0);
        let lo = 0, hi = b.n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1, ci = this.cell(pg, b.arr[mid], b.type);
          const rec = parseRec(pg, ci.pstart, ci.pstart + ci.local, key.length);
          if (cmpKey(key, rec) > 0) lo = mid + 1; else hi = mid;
        }
        if (lo < b.n) {
          const ci = this.cell(pg, b.arr[lo], b.type), rec = parseRec(pg, ci.pstart, ci.pstart + ci.local, key.length);
          if (cmpKey(key, rec) === 0) return { pg, ci, rec };
          if (b.type === 10) return null;
          n = ci.left;
        } else { if (b.type === 10) return null; n = b.right; }
      }
      return null;
    }
    /* پیدا کردن ردیف جدول با rowid → {pg,ci} */
    async tableFind(root, rowid) {
      let n = root;
      for (let depth = 0; depth < 40; depth++) {
        const pg = await this.page(n), b = this.bt(pg, n === 1 ? 100 : 0);
        if (b.type === 5) {
          let lo = 0, hi = b.n;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cell(pg, b.arr[mid], 5).rowid < rowid) lo = mid + 1; else hi = mid; }
          n = lo < b.n ? this.cell(pg, b.arr[lo], 5).left : b.right;
        } else if (b.type === 13) {
          let lo = 0, hi = b.n - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1, ci = this.cell(pg, b.arr[mid], 13);
            if (ci.rowid === rowid) return { pg, ci };
            if (ci.rowid < rowid) lo = mid + 1; else hi = mid - 1;
          }
          return null;
        } else return null;
      }
      return null;
    }
    async col(hit, idx) { const pl = await this.fullPayload(hit.pg, hit.ci), r = parseRec(pl, 0, pl.length, idx + 1); return r[idx]; }
    /* مقدار ستون‌های اول کوچک‌ترین/بزرگ‌ترین کلید یک ایندکس (برای zoom کمینه/بیشینه) */
    async edgeKey(root, last, ncol) {
      let n = root;
      for (let d = 0; d < 40; d++) {
        const pg = await this.page(n), b = this.bt(pg, n === 1 ? 100 : 0);
        if (b.type === 2) { n = last ? b.right : this.cell(pg, b.arr[0], 2).left; continue; }
        if (!b.n) return null;
        const ci = this.cell(pg, b.arr[last ? b.n - 1 : 0], 10);
        return parseRec(pg, ci.pstart, ci.pstart + ci.local, ncol);
      }
      return null;
    }
  }

  /* ---- ابزارهای طرح جدول ---- */
  function colNames(sql) {
    if (!sql) return [];
    const a = sql.indexOf('('), z = sql.lastIndexOf(')'); if (a < 0 || z < 0) return [];
    const body = sql.slice(a + 1, z), parts = []; let depth = 0, cur = '';
    for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    return parts.map(p => p.trim()).filter(p => p && !/^(primary|unique|check|foreign|constraint)\b/i.test(p))
      .map(p => p.replace(/^["'`\[]/, '').split(/["'`\]\s]/)[0].toLowerCase());
  }
  function idxCols(sql) {
    const m = /\bON\s+[^(]+\(([^)]*)\)/i.exec(sql || ''); if (!m) return null;
    return m[1].split(',').map(x => x.trim().replace(/\s+(asc|desc)$/i, '').replace(/^["'`\[]|["'`\]]$/g, '').toLowerCase());
  }
  function findIndex(db, table, cols) {
    const t = db.schema.find(x => x.type === 'table' && x.name === table); if (!t) return null;
    const pkRe = new RegExp('(primary\\s+key|unique)\\s*\\(\\s*' + cols.map(c => '["\'`\\[]?' + c + '["\'`\\]]?').join('\\s*,\\s*'), 'i');
    for (const x of db.schema) {
      if (x.type !== 'index' || x.tbl !== table) continue;
      const c = x.sql ? idxCols(x.sql) : null;
      if (c ? cols.every((n, i) => c[i] === n) : pkRe.test(t.sql || '')) return { root: x.root, n: c ? c.length : cols.length };
    }
    if (cols.length === 1 && new RegExp('\\b' + cols[0] + '\\b[^,]*\\b(primary key|unique)', 'i').test(t.sql || '')) {
      const au = db.schema.find(x => x.type === 'index' && x.tbl === table && !x.sql); if (au) return { root: au.root, n: 1 };
    }
    return null;
  }
  function sniff(u) {
    if (u[0] === 0x89 && u[1] === 0x50) return 'image/png';
    if (u[0] === 0xFF && u[1] === 0xD8) return 'image/jpeg';
    if (u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57) return 'image/webp';
    if (u[0] === 0x1F && u[1] === 0x8B) return 'gzip';
    return 'image/png';
  }

  /* ---- باز کردن MBTiles ---- */
  async function open(blob) {
    const db = new SQLiteRO(blob); await db.open();
    const meta = {}, mt = db.schema.find(x => x.type === 'table' && x.name === 'metadata');
    if (mt) await db.scanTable(mt.root, r => { if (typeof r[0] === 'string') meta[r[0]] = typeof r[1] === 'string' ? r[1] : r[1] == null ? '' : String(r[1]); });
    const tiles = db.schema.find(x => x.name === 'tiles');
    let plan = null;
    if (tiles && tiles.type === 'table') {
      const cols = colNames(tiles.sql), di = cols.indexOf('tile_data');
      if (/without\s+rowid/i.test(tiles.sql || '')) plan = { kind: 'norowid', root: tiles.root, di: di < 0 ? 3 : di, ix: { root: tiles.root, n: 3 } };
      else { const ix = findIndex(db, 'tiles', ['zoom_level', 'tile_column', 'tile_row']); if (ix) plan = { kind: 'table', root: tiles.root, di: di < 0 ? 3 : di, ix }; }
    } else if (tiles && tiles.type === 'view') {
      const mp = db.schema.find(x => x.type === 'table' && x.name === 'map'), im = db.schema.find(x => x.type === 'table' && x.name === 'images');
      if (mp && im) {
        const ix = findIndex(db, 'map', ['zoom_level', 'tile_column', 'tile_row']), ix2 = findIndex(db, 'images', ['tile_id']);
        const ti = colNames(mp.sql).indexOf('tile_id'), di = colNames(im.sql).indexOf('tile_data');
        if (ix && ix2) plan = { kind: 'mapimg', mroot: mp.root, ti: ti < 0 ? 3 : ti, ix, iroot: im.root, ix2, di: di < 0 ? 1 : di };
      }
    }
    if (!plan) throw new Error(tiles ? 'جدول tiles ایندکس (zoom_level, tile_column, tile_row) ندارد؛ فایل را با GDAL/QGIS دوباره بسازید تا ایندکس داشته باشد' : 'جدول tiles در فایل نیست؛ این فایل MBTiles رستری نیست (شاید برداری pbf یا فایل دیگر)');
    const fmt = (meta.format || '').toLowerCase();
    if (fmt === 'pbf' || fmt === 'mvt') throw new Error('این MBTiles برداری (pbf) است؛ فقط MBTiles رستری (png/jpg/webp) پشتیبانی می‌شود');
    /* بازه‌ی زوم */
    let minz = parseInt(meta.minzoom, 10), maxz = parseInt(meta.maxzoom, 10);
    if (!(minz >= 0) || !(maxz >= 0)) {
      try {
        const r0 = plan.kind === 'mapimg' ? plan.ix : plan.ix;
        const a = await db.edgeKey(r0.root, false, 1), b = await db.edgeKey(r0.root, true, 1);
        if (a && !(minz >= 0)) minz = a[0]; if (b && !(maxz >= 0)) maxz = b[0];
      } catch (e) { }
    }
    if (!(minz >= 0)) minz = 0; if (!(maxz >= 0)) maxz = 18;
    let bounds = null;
    if (meta.bounds) { const p = meta.bounds.split(',').map(Number); if (p.length === 4 && p.every(isFinite) && p[0] < p[2] && p[1] < p[3]) bounds = p; }
    let center = null;
    if (meta.center) { const p = meta.center.split(',').map(Number); if (p.length >= 2 && p.every(isFinite)) center = p; }
    const mb = { db, meta, plan, name: meta.name || '', format: fmt, minzoom: minz, maxzoom: maxz, bounds, center, scheme: (meta.scheme || 'tms').toLowerCase(), size: blob.size, tileReads: 0 };
    mb.getTile = async function (z, x, row) {
      const key = [z, x, row];
      let data = null;
      try {
        if (plan.kind === 'table') {
          const h = await db.indexFind(plan.ix.root, key); if (!h) return null;
          const rowid = h.rec.length > 3 ? h.rec[plan.ix.n] : null;
          const full = parseRec(await db.fullPayload(h.pg, h.ci), 0, 1 << 30, plan.ix.n + 1), rid = full[plan.ix.n];
          const r = await db.tableFind(plan.root, rid); if (!r) return null;
          data = await db.col(r, plan.di);
        } else if (plan.kind === 'norowid') {
          const h = await db.indexFind(plan.root, key); if (!h) return null;
          const pl = await db.fullPayload(h.pg, h.ci); data = parseRec(pl, 0, pl.length, plan.di + 1)[plan.di];
        } else {
          const h = await db.indexFind(plan.ix.root, key); if (!h) return null;
          const full = parseRec(await db.fullPayload(h.pg, h.ci), 0, 1 << 30, plan.ix.n + 1), rid = full[plan.ix.n];
          const mr = await db.tableFind(plan.mroot, rid); if (!mr) return null;
          const tid = await db.col(mr, plan.ti); if (tid == null) return null;
          const h2 = await db.indexFind(plan.ix2.root, [tid]); if (!h2) return null;
          const full2 = parseRec(await db.fullPayload(h2.pg, h2.ci), 0, 1 << 30, plan.ix2.n + 1), rid2 = full2[plan.ix2.n];
          const ir = await db.tableFind(plan.iroot, rid2); if (!ir) return null;
          data = await db.col(ir, plan.di);
        }
      } catch (e) { mb.lastError = e; return null; }
      if (!data || !data.length) return null;
      mb.tileReads++;
      return data;
    };
    return mb;
  }

  /* ---- لایه‌ی Leaflet ---- */
  function makeLayer(mb, opt) {
    opt = opt || {};
    const Cls = g.L.GridLayer.extend({
      createTile(c, done) {
        const img = document.createElement('img'); img.alt = ''; img.draggable = false;
        const n = Math.pow(2, c.z);
        if (c.x < 0 || c.x >= n || c.y < 0 || c.y >= n) { setTimeout(() => done(null, img)); return img; }
        const row = this.options.flip ? c.y : n - 1 - c.y;
        mb.getTile(c.z, c.x, row).then(u => {
          if (!u) return done(null, img);
          let t = sniff(u); if (t === 'gzip') return done(null, img);
          const url = URL.createObjectURL(new Blob([u], { type: t }));
          const fin = () => { URL.revokeObjectURL(url); done(null, img); };
          img.onload = fin; img.onerror = fin; img.src = url;
        }).catch(() => done(null, img));
        return img;
      }
    });
    return new Cls({
      tileSize: 256, minZoom: Math.max(0, mb.minzoom - 1), minNativeZoom: mb.minzoom, maxNativeZoom: mb.maxzoom,
      maxZoom: Math.max(22, mb.maxzoom), opacity: opt.opacity == null ? 1 : opt.opacity, zIndex: 1,
      flip: !!opt.flip, keepBuffer: 1, updateWhenIdle: true, updateWhenZooming: false,
      attribution: mb.meta.attribution || ''
    });
  }
  g.MBT = { open, makeLayer, SQLiteRO, parseRec };
  if (typeof module !== 'undefined') module.exports = g.MBT;
})(typeof window !== 'undefined' ? window : globalThis);
