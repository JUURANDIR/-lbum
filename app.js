/* =========================================================
   Álbum Jurandir & Mayanne — app.js  (v9)
   ========================================================= */
const $ = s => document.querySelector(s);
const enc = encodeURIComponent;

const state = {
  items: [],
  filtered: [],
  page: 0,
  pageSize: 60,
  current: 0,
  config: null,
  user: null,
  uploaderWho: "",
  gallerySha: null,
  viewerList: []
};

const DEFAULT_OWNER  = "JUURANDIR";
const DEFAULT_REPO   = "-lbum";
const DEFAULT_BRANCH = "main";

/* ---------- login ---------- */
const USERS = {Jurandir: "Jurandir", Mayanne: "Mayanne"};

function currentUser(){ return state.user || sessionStorage.getItem("albumUser"); }

function doLogin(pass){
  const found = Object.keys(USERS).find(name => USERS[name] === pass);
  if(!found){ $("#loginError").classList.remove("hidden"); return false; }
  state.user = found;
  sessionStorage.setItem("albumUser", found);
  $("#login").classList.add("hidden");
  $("#loginError").classList.add("hidden");
  $("#userBadge").textContent = "Olá, " + found;
  $("#userBadge").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  return true;
}

function requireLogin(){
  const u = currentUser();
  if(!u){ $("#login").classList.remove("hidden"); return false; }
  state.user = u;
  $("#userBadge").textContent = "Olá, " + u;
  $("#userBadge").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  return true;
}

/* ---------- criptografia ---------- */
const ENC_PASSPHRASE = "jurandir-e-mayanne-album-secreto-v1";
let cryptoKeyPromise = null;

function getKey(){
  if(!cryptoKeyPromise){
    cryptoKeyPromise = (async () => {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ENC_PASSPHRASE));
      return crypto.subtle.importKey("raw", hash, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
    })();
  }
  return cryptoKeyPromise;
}

async function encryptBuffer(buf){
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, buf);
  return {cipher, iv: b64(iv.buffer)};
}

async function decryptBuffer(buf, ivB64){
  const key = await getKey();
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  return crypto.subtle.decrypt({name: "AES-GCM", iv}, key, buf);
}

async function encryptText(str){
  const {cipher, iv} = await encryptBuffer(new TextEncoder().encode(str));
  return {data: b64(cipher), iv};
}

async function decryptText(data, iv){
  const cipherBuf = Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer;
  const plainBuf = await decryptBuffer(cipherBuf, iv);
  return new TextDecoder().decode(plainBuf);
}

function guessMime(name, fallback){
  if(fallback) return fallback;
  const ext = (String(name || "").split(".").pop() || "").toLowerCase();
  const map = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", heic: "image/heic", heif: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4",
    avi: "video/x-msvideo", mkv: "video/x-matroska"
  };
  return map[ext] || "application/octet-stream";
}

/* ---------- helpers ---------- */
function b64(buf){
  let s = "";
  const a = new Uint8Array(buf);
  for(let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

function niceDate(d){
  if(!d) return "";
  const dt = new Date(d + "T12:00:00");
  if(isNaN(dt.getTime())) return String(d);
  try{ return new Intl.DateTimeFormat("pt-BR", {dateStyle: "full"}).format(dt); }
  catch{ return String(d); }
}

function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function cfg(){ return state.config; }
function saveCfg(c){ state.config = c; try{ localStorage.setItem("albumConfig", JSON.stringify(c)); }catch{} }

function toast(msg){
  const e = $("#toast");
  e.textContent = msg;
  e.classList.add("show");
  clearTimeout(window.__t);
  window.__t = setTimeout(() => e.classList.remove("show"), 3200);
}

/* ---------- API ---------- */
function api(path, opt = {}){
  const c = cfg();
  if(!c?.token) throw Error("Configure o GitHub primeiro.");
  return fetch("https://api.github.com" + path, {
    ...opt,
    cache: "no-store",                        // <- corrige 409 "does not match"
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + c.token,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opt.headers || {})
    }
  });
}

/* XHR para permitir progresso real de upload */
function apiUpload(path, bodyString, onProgress){
  return new Promise((resolve, reject) => {
    const c = cfg();
    if(!c?.token){ reject(Error("Configure o GitHub primeiro.")); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "https://api.github.com" + path);
    xhr.setRequestHeader("Accept", "application/vnd.github+json");
    xhr.setRequestHeader("Authorization", "Bearer " + c.token);
    xhr.setRequestHeader("X-GitHub-Api-Version", "2022-11-28");
    xhr.setRequestHeader("Content-Type", "application/json");
    if(xhr.upload && onProgress){
      xhr.upload.onprogress = e => { if(e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => {
      let data = null;
      try{ data = JSON.parse(xhr.responseText); }catch{}
      resolve({ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: data || {}});
    };
    xhr.onerror = () => reject(Error("Falha de rede no upload."));
    xhr.ontimeout = () => reject(Error("Timeout no upload."));
    xhr.send(bodyString);
  });
}

function rawUrl(path){
  const c = cfg();
  return `https://raw.githubusercontent.com/${enc(c.owner)}/${enc(c.repo)}/${enc(c.branch)}/${String(path).split("/").map(enc).join("/")}`;
}

function contentsPath(extra){
  const c = cfg();
  return `/repos/${enc(c.owner)}/${enc(c.repo)}/contents/${extra}`;
}

/* ---------- carregamento de mídia (cache + dedupe) ---------- */
const urlCache = new Map();       // path -> blob URL resolvida
const pendingMap = new Map();     // path -> [{resolve, reject}]

async function fetchEncryptedBuffer(item){
  // 1) CDN público — sem Authorization (evita CORS preflight que causava "Failed to fetch")
  try{
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch(rawUrl(item.path), {signal: ctrl.signal});
    clearTimeout(t);
    if(r.ok) return await r.arrayBuffer();
  }catch{}
  // 2) API autenticada (fallback / repo privado)
  const r = await api(contentsPath(String(item.path).split("/").map(enc).join("/")) + "?ref=" + enc(cfg().branch), {
    headers: {Accept: "application/vnd.github.raw"}
  });
  if(!r.ok) throw Error("Falha ao baixar arquivo (HTTP " + r.status + ").");
  return await r.arrayBuffer();
}

function getImageUrl(item){
  if(urlCache.has(item.path)) return Promise.resolve(urlCache.get(item.path));
  if(pendingMap.has(item.path)){
    return new Promise((resolve, reject) => pendingMap.get(item.path).push({resolve, reject}));
  }
  return new Promise((resolve, reject) => {
    pendingMap.set(item.path, [{resolve, reject}]);
    (async () => {
      try{
        const cipherBuf = await fetchEncryptedBuffer(item);
        const plainBuf = await decryptBuffer(cipherBuf, item.iv);
        const blob = new Blob([plainBuf], {type: guessMime(item.name, item.type)});
        const url = URL.createObjectURL(blob);
        urlCache.set(item.path, url);
        const subs = pendingMap.get(item.path) || [];
        pendingMap.delete(item.path);
        subs.forEach(s => s.resolve(url));
      }catch(e){
        const subs = pendingMap.get(item.path) || [];
        pendingMap.delete(item.path);
        subs.forEach(s => s.reject(e));
      }
    })();
  });
}

function revokeImage(path){
  const u = urlCache.get(path);
  if(u){ try{ URL.revokeObjectURL(u); }catch{} urlCache.delete(path); }
  pendingMap.delete(path);
}

/* ---------- galeria ---------- */
async function loadGallery(){
  const c = cfg();
  if(!c){ render(); return; }
  try{
    const r = await api(contentsPath("gallery.json") + "?ref=" + enc(c.branch));
    if(r.ok){
      const x = await r.json();
      const bytes = Uint8Array.from(atob(String(x.content || "").replace(/\n/g, "")), ch => ch.charCodeAt(0));
      state.gallerySha = x.sha;
      try{ state.items = JSON.parse(new TextDecoder().decode(bytes)); }
      catch{ state.items = []; toast("gallery.json corrompido — reiniciando catálogo."); }
    } else if(r.status === 404){
      state.items = [];
      state.gallerySha = null;
    } else {
      const detail = await r.json().catch(() => ({}));
      throw Error(`Não foi possível ler gallery.json (HTTP ${r.status}: ${detail.message || "erro"}).`);
    }
    state.items.sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""))
    );
    render();
  }catch(e){ toast(e.message); render(); }
}

function apply(){
  const q = $("#searchInput").value.trim().toLowerCase();
  const d = $("#dateInput").value;
  const who = state.uploaderWho;
  state.filtered = state.items.filter(x => {
    if(d && x.date !== d) return false;
    if(who && x.uploadedBy !== who) return false;
    if(q){
      const name = String(x.name || "").toLowerCase();
      const date = String(x.date || "");
      const human = niceDate(x.date).toLowerCase();
      if(!name.includes(q) && !date.includes(q) && !human.includes(q)) return false;
    }
    return true;
  });
  state.page = 1;
  renderGallery();
}

function render(){
  $("#totalCount").textContent = state.items.length;
  apply();
  buildTimeline();
}

function buildTimeline(){
  const groups = [...new Set(state.items.map(x => String(x.date || "").slice(0, 7)).filter(Boolean))];
  $("#timelineNav").innerHTML = groups.map(m =>
    `<button type="button" data-month="${m}">${new Intl.DateTimeFormat("pt-BR", {month: "long", year: "numeric"}).format(new Date(m + "-01T12:00:00"))}</button>`
  ).join("");
  $("#timelineNav").querySelectorAll("button").forEach(b => {
    b.onclick = () => {
      $("#searchInput").value = "";
      $("#dateInput").value = "";
      state.filtered = state.items.filter(x =>
        String(x.date || "").startsWith(b.dataset.month) &&
        (!state.uploaderWho || x.uploadedBy === state.uploaderWho)
      );
      state.page = 1;
      renderGallery();
    };
  });
}

/* ---------- observer ---------- */
const mediaObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if(!entry.isIntersecting) return;
    mediaObserver.unobserve(entry.target);
    loadCardMedia(entry.target);
  });
}, {rootMargin: "600px"});

async function loadCardMedia(card){
  if(!card || card.dataset.loaded === "1" || card.dataset.loaded === "loading") return;
  const idx = +card.dataset.idx;
  const item = state.filtered[idx];
  if(!item) return;
  card.dataset.loaded = "loading";
  const wrap = card.querySelector(".media-wrap");
  if(!wrap) return;
  try{
    const url = await getImageUrl(item);
    if(!card.isConnected || !wrap.isConnected) return;
    const isVideo = String(item.type || "").startsWith("video");
    if(isVideo){
      const v = document.createElement("video");
      v.src = url;
      v.muted = true;
      v.preload = "metadata";
      v.playsInline = true;
      wrap.replaceChildren(v);
    } else {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.alt = "";
      img.onerror = () => {
        wrap.textContent = "Formato não suportado pelo navegador";
        card.dataset.loaded = "";
      };
      img.src = url;
      wrap.replaceChildren(img);
    }
    card.dataset.loaded = "1";
  }catch(e){
    card.dataset.loaded = "";
    card.dataset.failed = "1";
    if(wrap.isConnected) wrap.textContent = "Erro — toque para tentar de novo";
  }
}

function renderGallery(){
  const shown = state.filtered.slice(0, state.page * state.pageSize);
  const gallery = $("#gallery");
  gallery.innerHTML = "";
  if(!shown.length){
    $("#empty").classList.remove("hidden");
    $("#loadMore").classList.add("hidden");
    return;
  }
  $("#empty").classList.add("hidden");

  let lastDate = "";
  shown.forEach((x, i) => {
    if(x.date !== lastDate){
      const d = document.createElement("div");
      d.className = "day";
      const count = state.filtered.filter(y => y.date === x.date).length;
      d.innerHTML = `<h3>${niceDate(x.date)}</h3><small>${count} item(ns)</small>`;
      gallery.appendChild(d);
      lastDate = x.date;
    }
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.idx = i;
    const isVideo = String(x.type || "").startsWith("video");
    card.innerHTML =
      `<div class="media-wrap"><span class="skeleton"></span></div>` +
      `<span class="type">${isVideo ? "▶ Vídeo" : "▣ Foto"}</span>` +
      `<span class="uploader-tag">${escapeHtml(x.uploadedBy || "?")}</span>` +
      `<div class="name" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</div>`;
    card.onclick = () => {
      if(card.dataset.failed === "1"){
        delete card.dataset.failed;
        delete card.dataset.loaded;
        const w = card.querySelector(".media-wrap");
        if(w) w.innerHTML = `<span class="skeleton"></span>`;
        loadCardMedia(card);
        return;
      }
      openViewer(i, state.filtered);
    };
    gallery.appendChild(card);
  });

  $("#loadMore").classList.toggle("hidden", shown.length >= state.filtered.length);

  // carga imediata dos visíveis + observer para o resto
  const vBottom = window.innerHeight + 600;
  gallery.querySelectorAll(".card").forEach(card => {
    const r = card.getBoundingClientRect();
    if(r.top < vBottom && r.bottom > -600){
      loadCardMedia(card);
    } else {
      mediaObserver.observe(card);
    }
  });
}

/* ---------- viewer ---------- */
async function openViewer(i, list){
  if(!list || !list.length) return;
  state.viewerList = list.slice();
  state.current = i;
  $("#viewer").classList.remove("hidden");
  await showViewer();
}

async function showViewer(){
  const x = state.viewerList[state.current];
  if(!x){ closeViewer(); return; }
  $("#viewerContent").innerHTML = "Carregando…";
  try{
    const url = await getImageUrl(x);
    if(String(x.type || "").startsWith("video")){
      $("#viewerContent").innerHTML = `<video src="${url}" controls autoplay playsinline></video>`;
    } else {
      $("#viewerContent").innerHTML = `<img src="${url}" alt="">`;
    }
  }catch(e){
    $("#viewerContent").innerHTML = "Erro ao carregar o arquivo.";
  }
  $("#viewerCaption").textContent =
    `${x.name} • ${niceDate(x.date)} • enviado por ${x.uploadedBy || "?"}`;
}

function closeViewer(){
  $("#viewer").classList.add("hidden");
  $("#viewerContent").innerHTML = "";
  state.viewerList = [];
  state.current = 0;
}

function move(n){
  if(!state.viewerList.length) return;
  state.current = (state.current + n + state.viewerList.length) % state.viewerList.length;
  showViewer();
}

async function downloadItem(item){
  if(!item) return;
  try{
    const url = await getImageUrl(item);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }catch(e){ toast("Falha ao baixar: " + e.message); }
}

/* ---------- fila de mutações (evita 409 entre operações) ---------- */
let mutex = Promise.resolve();
function serialize(fn){
  const next = mutex.then(fn, fn);
  mutex = next.catch(() => {});
  return next;
}

/* ---------- excluir ---------- */
function deleteItem(item){
  if(!item) return;
  if(!confirm(`Excluir "${item.name}" para sempre?`)) return;
  return serialize(async () => {
    const c = cfg();
    const apiPath = String(item.path).split("/").map(enc).join("/");
    try{
      // 1) sha atual
      let sha = item.sha || null;
      const r = await api(contentsPath(apiPath) + "?ref=" + enc(c.branch));
      if(r.ok) sha = (await r.json()).sha;
      else if(r.status !== 404) throw Error("Não foi possível obter o arquivo para excluir.");

      // 2) apaga o arquivo (404 = já não existe, seguimos)
      if(sha){
        const res = await api(contentsPath(apiPath), {
          method: "DELETE",
          body: JSON.stringify({message: `album: remover ${item.name}`, sha, branch: c.branch})
        });
        if(!res.ok && res.status !== 404){
          const err = await res.json().catch(() => ({}));
          throw Error(err.message || `Falha ao excluir arquivo (HTTP ${res.status}).`);
        }
      }

      // 3) atualiza catálogo com retry interno
      const nextItems = state.items.filter(x => x.path !== item.path);
      await putJson(nextItems);
      state.items = nextItems;

      // 4) limpa
      revokeImage(item.path);
      closeViewer();
      toast("Excluído.");
      render();
    }catch(e){
      console.error(e);
      toast(e.message || "Erro ao excluir.");
    }
  });
}

/* ---------- putJson com retry ---------- */
async function putJson(items){
  const c = cfg();
  const content = JSON.stringify(items, null, 2);
  const encoded = b64(new TextEncoder().encode(content));
  let lastErr = null;
  for(let attempt = 0; attempt < 3; attempt++){
    // sempre rebusca sha — corrige de vez o "does not match"
    let sha = null;
    try{
      const r = await api(contentsPath("gallery.json") + "?ref=" + enc(c.branch));
      if(r.ok) sha = (await r.json()).sha;
    }catch{}
    const body = {message: "album: atualizar catálogo", content: encoded, branch: c.branch};
    if(sha) body.sha = sha;
    const res = await api(contentsPath("gallery.json"), {method: "PUT", body: JSON.stringify(body)});
    if(res.ok){
      state.gallerySha = (await res.json()).content.sha;
      return;
    }
    const err = await res.json().catch(() => ({}));
    lastErr = err;
    if(res.status === 409 && attempt < 2){
      await new Promise(rs => setTimeout(rs, 300 * (attempt + 1)));
      continue;
    }
    throw Error(err.message || "Falha ao salvar catálogo.");
  }
  throw Error(lastErr?.message || "Falha ao salvar catálogo após várias tentativas.");
}

/* ---------- config ---------- */
async function readConfigFile(){
  try{
    const r = await fetch("config.json?t=" + Date.now(), {cache: "no-store"});
    if(!r.ok) return null;
    const c = await r.json();
    if(!c.owner || !c.repo || !c.tokenEnc) return null;
    const token = await decryptText(c.tokenEnc.data, c.tokenEnc.iv);
    if(!token || token.startsWith("cole_aqui")) return null;
    return {owner: c.owner, repo: c.repo, branch: c.branch || "main", token};
  }catch{ return null; }
}

async function writeConfigFile(c){
  const tokenEnc = await encryptText(c.token);
  const content = b64(new TextEncoder().encode(JSON.stringify({owner: c.owner, repo: c.repo, branch: c.branch, tokenEnc}, null, 2)));
  let sha;
  try{
    const r = await api(contentsPath("config.json") + "?ref=" + enc(c.branch));
    if(r.ok) sha = (await r.json()).sha;
  }catch{}
  const body = {message: "album: salvar configuração", content, branch: c.branch};
  if(sha) body.sha = sha;
  const res = await api(contentsPath("config.json"), {method: "PUT", body: JSON.stringify(body)});
  if(!res.ok) throw Error((await res.json().catch(() => ({}))).message || "Falha ao salvar configuração.");
}

async function readConfig(){
  const fromFile = await readConfigFile();
  if(fromFile){ state.config = fromFile; await loadGallery(); return; }
  try{
    const local = JSON.parse(localStorage.getItem("albumConfig") || "null");
    if(local){ state.config = local; await loadGallery(); return; }
  }catch{}
  $("#settings").classList.remove("hidden");
}

/* ---------- barra de progresso do upload -------