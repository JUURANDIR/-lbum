const CACHE="album-shell-v1";
const SHELL=["./index.html","./style.css?v=15","./app.js?v=15","./manifest.json","./icon.svg"];
self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
// Só cacheia a casca do app (html/css/js). Fotos, vídeos e chamadas à API do
// GitHub sempre vão direto pra rede — nunca ficam guardadas no cache do navegador.
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(url.origin!==location.origin||url.pathname.includes("config.json"))return;
  if(!SHELL.some(s=>url.pathname.endsWith(s.replace("./","").split("?")[0])))return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
