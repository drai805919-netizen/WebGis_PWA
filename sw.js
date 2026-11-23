const V='webgis-v14',TILE='webgis-tiles-v1',INT='webgis-int-v1',WMS='webgis-wms-v1',OFF='webgis-offline-v1';
const KEEP=[V,TILE,INT,WMS,OFF];            // OFF (نقشه‌های ذخیره‌شده برای آفلاین) هرگز پاک نمی‌شود
const LOCAL=['./lib/leaflet.min.js','./lib/leaflet.min.css','./lib/images/layers.png','./lib/images/layers-2x.png','./lib/images/marker-icon.png','./lib/images/marker-icon-2x.png','./lib/images/marker-shadow.png','./lib/turf.min.js','./lib/jszip.min.js','./lib/jsQR.min.js','./lib/zxing.min.js'];
const CORE=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./maps.json'];
const B='https://cdnjs.cloudflare.com/ajax/libs/';
const CDN={'./lib/leaflet.min.js':B+'leaflet/1.9.4/leaflet.min.js','./lib/leaflet.min.css':B+'leaflet/1.9.4/leaflet.min.css','./lib/images/layers.png':B+'leaflet/1.9.4/images/layers.png','./lib/images/layers-2x.png':B+'leaflet/1.9.4/images/layers-2x.png','./lib/turf.min.js':B+'Turf.js/6.5.0/turf.min.js','./lib/jszip.min.js':B+'jszip/3.10.1/jszip.min.js','./lib/jsQR.min.js':B+'jsQR/1.4.0/jsQR.min.js','./lib/zxing.min.js':'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'};
const PUBTILE=/openstreetmap\.org|arcgisonline\.com|opentopomap\.org/;
const get=(u,o)=>fetch(u,o).then(r=>{if(!r.ok)throw 0;return r});
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(V).then(async c=>{
 await Promise.all(CORE.map(u=>get(u,{cache:'reload'}).then(r=>c.put(u,r)).catch(()=>{})));
 await Promise.all(LOCAL.map(u=>get(u,{cache:'reload'}).then(r=>c.put(u,r)).catch(()=>CDN[u]&&get(CDN[u]).then(r=>c.put(u,r)).catch(()=>{}))))}))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>!KEEP.includes(k)).map(k=>caches.delete(k)))).then(()=>clients.claim())));
async function trim(name,max){const k=await caches.open(name),ks=await k.keys();for(const x of ks.slice(0,Math.max(0,ks.length-max)))await k.delete(x)}
const off=async u=>(await caches.open(OFF)).match(u);
const timeout=(r,ms)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return fetch(r,{signal:c.signal}).finally(()=>clearTimeout(t))};
/* تایل‌های همین سرور (/tiles/...): اول بسته آفلاین، بعد کش، بعد شبکه */
async function tileInt(r){
 const h=await off(r.url);if(h)return h;
 const k=await caches.open(INT),c=await k.match(r.url);if(c)return c;
 try{const x=await fetch(r);if(x.ok){k.put(r.url,x.clone());trim(INT,8000)}return x}catch(_){return Response.error()}}
/* WMS (/wms?...): اول شبکه (داده تازه)، در نبود شبکه بسته آفلاین یا آخرین کش */
async function wmsNet(r){
 try{const x=await timeout(r,12000);
  if(x.ok&&/^image\//i.test(x.headers.get('content-type')||'')){const k=await caches.open(WMS);k.put(r.url,x.clone());trim(WMS,1500)}
  return x}
 catch(_){const h=await off(r.url);if(h)return h;const c=await (await caches.open(WMS)).match(r.url);return c||Response.error()}}
/* تایل‌های عمومی (OSM/Esri/OpenTopo) */
async function tileExt(r){
 const h=await off(r.url);if(h)return h;
 const k=await caches.open(TILE),c=await k.match(r.url);if(c)return c;
 try{const x=await fetch(r.url,{mode:'cors'});if(x.ok){k.put(r.url,x.clone());trim(TILE,600)}return x}
 catch(_){try{return await fetch(r)}catch(__){return Response.error()}}}
async function netFirst(r){
 try{const x=await timeout(r,6000);if(x.ok)(await caches.open(V)).put(r,x.clone());return x}
 catch(_){return (await caches.match(r,{ignoreSearch:true}))||Response.error()}}
async function shell(r){
 const c=await caches.match(r,{ignoreSearch:true});
 const n=fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(V).then(k=>k.put(r,y))}return x}).catch(()=>c||(r.mode==='navigate'?caches.match('./index.html'):Response.error()));
 return c||n}
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;
 const u=new URL(r.url),p=u.pathname;
 if(u.origin===location.origin){
  if(/\/tiles\/\d+\//.test(p))return e.respondWith(tileInt(r));
  if(/\/wms$/.test(p))return e.respondWith(wmsNet(r));
  if(/\/health$/.test(p))return;
  if(/\/maps\.json$/.test(p))return e.respondWith(netFirst(r));
  return e.respondWith(shell(r))}
 if(u.hostname==='cdnjs.cloudflare.com'||u.hostname==='cdn.jsdelivr.net'){
  return e.respondWith(caches.match(r.url).then(c=>c||fetch(r.url).then(x=>{if(x.ok){const y=x.clone();caches.open(V).then(k=>k.put(r.url,y))}return x})))}
 if(PUBTILE.test(u.hostname))return e.respondWith(tileExt(r));
 if(r.destination==='image')return e.respondWith(off(r.url).then(h=>h||fetch(r)))});
