const APP='webgis-app-v9',LIB='webgis-lib-v1',TILE='webgis-tiles-v1',MAXT=600;
const CORE=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
const B='https://cdnjs.cloudflare.com/ajax/libs/';
const CDN=[B+'leaflet/1.9.4/leaflet.min.css',B+'leaflet/1.9.4/leaflet.min.js',B+'leaflet/1.9.4/images/layers.png',B+'leaflet/1.9.4/images/layers-2x.png',B+'Turf.js/6.5.0/turf.min.js',B+'jszip/3.10.1/jszip.min.js',B+'jsQR/1.4.0/jsQR.min.js','https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil((async()=>{
 const a=await caches.open(APP);
 await Promise.all(CORE.map(u=>fetch(u,{cache:'reload'}).then(r=>{if(!r.ok)throw new Error(u);return a.put(u,r)})));
 const l=await caches.open(LIB);
 await Promise.all(CDN.map(async u=>{
  if(await l.match(u))return;
  try{let r=await caches.match(u);if(r){await l.put(u,r.clone());return}
   r=await fetch(u);if(r.ok)await l.put(u,r)}catch(_){}}))})())});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>![APP,LIB,TILE].includes(k)).map(k=>caches.delete(k)))).then(()=>clients.claim())));
async function trim(k){const ks=await k.keys();for(const x of ks.slice(0,Math.max(0,ks.length-MAXT)))await k.delete(x)}
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;
 const u=new URL(r.url);
 if(u.origin===location.origin){
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(c=>{
   const n=fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(APP).then(k=>k.put(r,y))}return x}).catch(()=>c);
   return c||n}));return}
 if(u.hostname==='cdnjs.cloudflare.com'||u.hostname==='cdn.jsdelivr.net'){
  e.respondWith(caches.match(r.url).then(c=>c||fetch(r.url).then(x=>{if(x.ok){const y=x.clone();caches.open(LIB).then(k=>k.put(r.url,y))}return x})));return}
 if(/openstreetmap\.org|arcgisonline\.com|opentopomap\.org/.test(u.hostname)){
  e.respondWith(caches.open(TILE).then(async k=>{
   const c=await k.match(r.url);if(c)return c;
   try{const x=await fetch(r.url,{mode:'cors'});if(x.ok){k.put(r.url,x.clone());trim(k)}return x}
   catch(_){try{return await fetch(r)}catch(__){return Response.error()}}}))}
});
