/* =========================================================
   Álbum Jurandir & Mayanne — app.js (v12)
   ========================================================= */
(function(){
"use strict";

const VERSION = "12";
document.title = "Meu Álbum";

/* ---------- segurança de carregamento ---------- */
window.addEventListener("error", e => {
  console.error("[album] erro global:", e.error || e.message);
  try{
    const t = document.getElementById("toast");
    if(t){
      t.textContent = "Erro: " + (e.message || "desconhecido");
      t.classList.add("show");
      clearTimeout(window.__t);
      window.__t = setTimeout(() => t.classList.remove("show"), 5000);
    }
  }catch{}
});

const $ = s => {
  const el = document.querySelector(s);
  if(!el) console.warn("[album] elemento ausente:", s);
  return el;
};

function on(sel, ev, fn){
  const el = typeof sel === "string" ? document.querySelector(sel) : sel;
  if(!el){ console.warn("[album] listener ignorado, elemento não existe:", sel); return null; }
  el.addEventListener(ev, fn);
  return el;
}

function ready(fn){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
}

console.log("[album] app.js v" + VERSION + " carregando...");

/* ---------- estado ---------- */
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
window.__album = state;

const DEFAULT_OWNER  = "JUURANDIR";
const DEFAULT_REPO   = "-lbum";
const DEFAULT_BRANCH = "main";

/* ---------- login ---------- */
const USERS = {Jurandir: "Jurandir", Mayanne: "Mayanne"};

function currentUser(){ return state.user || sessionStorage.getItem("albumUser"); }

function doLogin(pass){
  const found = Object.keys(USERS).find(name => USERS[name] === pass);
  if(!found){
    const err = $("#loginError");
    if(err) err.classList.remove("hidden");
    return false;
  }
  state.user = found;
  try{ sessionStorage.setItem("albumUser", found); }catch{}
  $("#login")?.classList.add("hidden");
  $("#loginError")?.classList.add("hidden");
  const badge = $("#userBadge");
  if(badge){ badge.textContent = "Olá, " + found; badge.classList.remove("hidden"); }
  $("#logoutBtn")?.classList.remove("hidden");
  document.body.classList.add("logged-in");   // <-- esconde marca + hero
  return true;
}

function requireLogin(){
  let u;
  try{ u = currentUser(); }catch{ u = null; }
  if(!u){
    $("#login")?.classList.remove("hidden");
    return false;
  }
  state.user = u;
  const badge = $("#userBadge");
  if(badge){ badge.textContent = "Olá, " + u; badge.classList.remove("hidden"); }
  $("#logoutBtn")?.classList.remove("hidden");
  document.body.classList.add("logged-in");   // <-- esconde marca + hero
  return true;
}

/* ---------- criptografia ---------- */
const ENC_PASSPHRASE = "jurandir-e-mayanne-album-secreto-v1";
let cryptoKeyPromise = null;

function getKey(){
  if(!cryptoKeyPromise){
    cryptoKeyPromise = crypto.subtle.digest("SHA-256", new TextEncoder().encode(ENC_PASSPHRASE))
      .then(hash => crypto.subtle.importKey("raw", hash, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]));
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
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4"
  };
  return map[ext] || "application/octet-stream";
}

/* ---------- helpers ---------- */
function b64(buf){
  let s = "";
  const a = new Uint8Array(buf);
  for(let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
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
function saveCfg(c){
  state.config = c;
  try{ localStorage.setItem("albumConfig", JSON.stringify(c)); }catch{}
}

function toast(msg){
  const e = document.getElementById("toast");
  if(!e) return;
  e.textContent = msg;
  e.classList.add("show");
  clearTimeout(window.__t);
  window.__t = setTimeout(() => e.classList.remove("show"), 3200);
}

/* ---------- API ---------- */
function api(path, opt){
  opt = opt || {};
  const c = cfg();
  if(!c || !c.token) throw Error("Configure o GitHub primeiro.");
  return fetch("https://api.github.com" + path, {
    method: opt.method || "GET",
    body: opt.body,
    cache: "no-store",
    headers: Object.assign({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + c.token,
      "X-GitHub-Api-Version": "2022-11-28"
    }, opt.headers || {})
  });
}

function apiUpload(path, bodyString, onProgress){
  return new Promise((resolve, reject) => {
    const c = cfg();
    if(!c || !c.token){ reject(Error("Configure o GitHub primeiro.")); return; }
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
    xhr.send(bodyString);
  });
}

function enc(s){ return encodeURIComponent(s); }

function rawUrl(path){
  const c = cfg();
  return "https://raw.githubusercontent.com/" + enc(c.owner) + "/" + enc(c.repo) + "/" + enc(c.branch) + "/" +
    String(path).split("/").map(enc).join("/");
}

function contentsPath(extra){
  const c = cfg();
  return "/repos/" + enc(c.owner) + "/" + enc(c.repo) + "/contents/" + extra;
}

/* ---------- mídia ---------- */
const urlCache = new Map();
const pendingMap = new Map();

async function fetchEncryptedBuffer(item){
  try{
    const r = await fetch(rawUrl(item.path));
    if(r.ok) return await r.arrayBuffer();
  }catch{}
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
      throw Error("Não foi possível ler gallery.json (HTTP " + r.status + ": " + (detail.message || "erro") + ").");
    }
    state.items.sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""))
    );
    render();
  }catch(e){ toast(e.message); render(); }
}

function apply(){
  const inp = document.getElementById("searchInput");
  const dt = document.getElementById("dateInput");
  const q = inp ? inp.value.trim().toLowerCase() : "";
  const d = dt ? dt.value : "";
  const who = state.uploaderWho;
  state.filtered = state.items.filter(x => {
    if(d && x.date !== d) return false;
    if(who && x.uploadedBy !== who) return false;
    if(q){
      const name = String(x.name || "").toLowerCase();
      const date = String(x.date || "");
      const human = niceDate(x.date).toLowerCase();
      if(name.indexOf(q) < 0 && date.indexOf(q) < 0 && human.indexOf(q) < 0) return false;
    }
    return true;
  });
  state.page = 1;
  renderGallery();
}

function render(){
  const tc = document.getElementById("totalCount");
  if(tc) tc.textContent = state.items.length;
  apply();
  buildTimeline();
}

function buildTimeline(){
  const nav = document.getElementById("timelineNav");
  if(!nav) return;
  const groups = Array.from(new Set(state.items.map(x => String(x.date || "").slice(0, 7)).filter(Boolean)));
  let html = "";
  groups.forEach(m => {
    let label = m;
    try{ label = new Intl.DateTimeFormat("pt-BR", {month: "long", year: "numeric"}).format(new Date(m + "-01T12:00:00")); }catch{}
    html += '<button type="button" data-month="' + m + '">' + label + '</button>';
  });
  nav.innerHTML = html;
  nav.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      const si = document.getElementById("searchInput");
      const di = document.getElementById("dateInput");
      if(si) si.value = "";
      if(di) di.value = "";
      state.filtered = state.items.filter(x =>
        String(x.date || "").indexOf(b.dataset.month) === 0 &&
        (!state.uploaderWho || x.uploadedBy === state.uploaderWho)
      );
      state.page = 1;
      renderGallery();
    });
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
    const isVideo = String(item.type || "").indexOf("video") === 0;
    wrap.innerHTML = "";
    if(isVideo){
      const v = document.createElement("video");
      v.src = url;
      v.muted = true;
      v.preload = "metadata";
      v.setAttribute("playsinline", "");
      wrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.alt = "";
      img.onerror = () => {
        wrap.textContent = "Formato não suportado";
        card.dataset.loaded = "";
      };
      img.src = url;
      wrap.appendChild(img);
    }
    card.dataset.loaded = "1";
  }catch(e){
    console.warn("[album] falha card:", e);
    card.dataset.loaded = "";
    card.dataset.failed = "1";
    if(wrap.isConnected) wrap.textContent = "Erro — toque para tentar";
  }
}

function renderGallery(){
  const gallery = document.getElementById("gallery");
  if(!gallery) return;
  const shown = state.filtered.slice(0, state.page * state.pageSize);
  gallery.innerHTML = "";
  const emptyEl = document.getElementById("empty");
  const moreEl = document.getElementById("loadMore");
  if(!shown.length){
    if(emptyEl) emptyEl.classList.remove("hidden");
    if(moreEl) moreEl.classList.add("hidden");
    return;
  }
  if(emptyEl) emptyEl.classList.add("hidden");

  let lastDate = "";
  shown.forEach((x, i) => {
    if(x.date !== lastDate){
      const d = document.createElement("div");
      d.className = "day";
      const count = state.filtered.filter(y => y.date === x.date).length;
      d.innerHTML = "<h3>" + niceDate(x.date) + "</h3><small>" + count + " item(ns)</small>";
      gallery.appendChild(d);
      lastDate = x.date;
    }
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.idx = i;
    const isVideo = String(x.type || "").indexOf("video") === 0;
    card.innerHTML =
      '<div class="media-wrap"><span class="skeleton"></span></div>' +
      '<span class="type">' + (isVideo ? "▶ Vídeo" : "▣ Foto") + '</span>' +
      '<span class="uploader-tag">' + escapeHtml(x.uploadedBy || "?") + '</span>' +
      '<div class="name" title="' + escapeHtml(x.name) + '">' + escapeHtml(x.name) + '</div>';
    card.addEventListener("click", () => {
      if(card.dataset.failed === "1"){
        delete card.dataset.failed;
        delete card.dataset.loaded;
        const w = card.querySelector(".media-wrap");
        if(w) w.innerHTML = '<span class="skeleton"></span>';
        loadCardMedia(card);
        return;
      }
      openViewer(i, state.filtered);
    });
    gallery.appendChild(card);
  });

  if(moreEl) moreEl.classList.toggle("hidden", shown.length >= state.filtered.length);

  const cards = gallery.querySelectorAll(".card");
  for(let i = 0; i < cards.length; i++){
    loadCardMedia(cards[i]);
  }
}

/* ---------- viewer ---------- */
async function openViewer(i, list){
  if(!list || !list.length) return;
  state.viewerList = list.slice();
  state.current = i;
  const v = document.getElementById("viewer");
  if(v) v.classList.remove("hidden");
  await showViewer();
}

async function showViewer(){
  const content = document.getElementById("viewerContent");
  const cap = document.getElementById("viewerCaption");
  const x = state.viewerList[state.current];
  if(!x){ closeViewer(); return; }
  if(content) content.innerHTML = "Carregando…";
  try{
    const url = await getImageUrl(x);
    if(content){
      if(String(x.type || "").indexOf("video") === 0){
        content.innerHTML = '<video src="' + url + '" controls autoplay playsinline></video>';
      } else {
        content.innerHTML = '<img src="' + url + '" alt="">';
      }
    }
  }catch(e){
    if(content) content.innerHTML = "Erro ao carregar o arquivo.";
  }
  if(cap) cap.textContent = x.name + " • " + niceDate(x.date) + " • enviado por " + (x.uploadedBy || "?");
}

function closeViewer(){
  const v = document.getElementById("viewer");
  const c = document.getElementById("viewerContent");
  if(v) v.classList.add("hidden");
  if(c) c.innerHTML = "";
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

/* ---------- fila ---------- */
let mutex = Promise.resolve();
function serialize(fn){
  const next = mutex.then(fn, fn);
  mutex = next.catch(() => {});
  return next;
}

/* ---------- excluir ---------- */
function deleteItem(item){
  if(!item) return Promise.resolve();
  if(!confirm('Excluir "' + item.name + '" para sempre?')) return Promise.resolve();
  return serialize(async () => {
    const c = cfg();
    const apiPath = String(item.path).split("/").map(enc).join("/");
    try{
      let sha = item.sha || null;
      const r = await api(contentsPath(apiPath) + "?ref=" + enc(c.branch));
      if(r.ok) sha = (await r.json()).sha;
      else if(r.status !== 404) throw Error("Não foi possível obter o arquivo para excluir.");

      if(sha){
        const res = await api(contentsPath(apiPath), {
          method: "DELETE",
          body: JSON.stringify({message: "album: remover " + item.name, sha, branch: c.branch})
        });
        if(!res.ok && res.status !== 404){
          const err = await res.json().catch(() => ({}));
          throw Error(err.message || ("Falha ao excluir arquivo (HTTP " + res.status + ")."));
        }
      }

      const nextItems = state.items.filter(x => x.path !== item.path);
      await putJson(nextItems);
      state.items = nextItems;

      revokeImage(item.path);
      closeViewer();
      toast("Excluído.");
      render();
    }catch(e){
      console.error("[album] delete:", e);
      toast(e.message || "Erro ao excluir.");
    }
  });
}

/* ---------- putJson ---------- */
async function putJson(items){
  const c = cfg();
  const content = JSON.stringify(items, null, 2);
  const encoded = b64(new TextEncoder().encode(content));
  let lastErr = null;
  for(let attempt = 0; attempt < 3; attempt++){
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
  throw Error((lastErr && lastErr.message) || "Falha ao salvar catálogo.");
}

/* ---------- config ---------- */
async function readConfigFile(){
  try{
    const r = await fetch("config.json?t=" + Date.now(), {cache: "no-store"});
    if(!r.ok) return null;
    const c = await r.json();
    if(!c.owner || !c.repo || !c.tokenEnc) return null;
    const token = await decryptText(c.tokenEnc.data, c.tokenEnc.iv);
    if(!token || token.indexOf("cole_aqui") === 0) return null;
    return {owner: c.owner, repo: c.repo, branch: c.branch || "main", token: token};
  }catch{ return null; }
}

async function writeConfigFile(c){
  const tokenEnc = await encryptText(c.token);
  const content = b64(new TextEncoder().encode(JSON.stringify({owner: c.owner, repo: c.repo, branch: c.branch, tokenEnc: tokenEnc}, null, 2)));
  let sha;
  try{
    const r = await api(contentsPath("config.json") + "?ref=" + enc(c.branch));
    if(r.ok) sha = (await r.json()).sha;
  }catch{}
  const body = {message: "album: salvar configuração", content: content, branch: c.branch};
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
  const s = document.getElementById("settings");
  if(s) s.classList.remove("hidden");
}

/* ---------- progresso ---------- */
function showProgress(frac, label){
  const el = document.getElementById("uploadProgress");
  if(!el) return;
  el.classList.remove("hidden");
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  const bar = document.getElementById("uploadProgressBar");
  const lbl = document.getElementById("uploadProgressLabel");
  if(bar) bar.style.width = pct + "%";
  if(lbl) lbl.textContent = label || (pct + "%");
}
function hideProgress(){
  const el = document.getElementById("uploadProgress");
  if(el) el.classList.add("hidden");
}

/* ---------- upload ---------- */
function sanitizeName(name){
  return String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-")
    || ("arquivo-" + Date.now());
}

async function uploadFile(file, onProgress){
  const c = cfg();
  const now = new Date();
  const di = document.getElementById("dateInput");
  const date = (di && di.value) || now.toISOString().slice(0, 10);
  if(file.size > 100 * 1024 * 1024) throw Error(file.name + ": acima de 100 MB.");
  const clean = sanitizeName(file.name);
  const path = "media/" + date.slice(0, 4) + "/" + date.slice(5, 7) + "/" + date + "/" + Date.now() + "-" + clean + ".enc";
  const raw = await file.arrayBuffer();
  const encd = await encryptBuffer(raw);
  const encoded = b64(encd.cipher);
  const bodyStr = JSON.stringify({
    message: "album: adicionar " + clean,
    content: encoded,
    branch: c.branch
  });
  const res = await apiUpload(contentsPath(String(path).split("/").map(enc).join("/")), bodyStr, onProgress);
  if(!res.ok) throw Error(file.name + ": " + ((res.data && res.data.message) || "falha no upload"));
  state.items.push({
    name: file.name,
    path: path,
    date: date,
    type: file.type,
    bytes: file.size,
    iv: encd.iv,
    sha: res.data.content.sha,
    uploadedAt: new Date().toISOString(),
    uploadedBy: currentUser()
  });
  state.items.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""))
  );
}

function uploadFiles(files){
  if(!requireLogin()) return Promise.resolve();
  if(!cfg()){
    toast("Configure o GitHub primeiro.");
    const s = document.getElementById("settings");
    if(s) s.classList.remove("hidden");
    return Promise.resolve();
  }
  const arr = Array.prototype.slice.call(files || []).filter(f => f && f.size > 0);
  if(!arr.length) return Promise.resolve();

  return serialize(async () => {
    const totalBytes = arr.reduce((s, f) => s + f.size, 0);
    let bytesDone = 0;
    const btn = document.getElementById("uploadBtn");
    const fi = document.getElementById("fileInput");
    if(btn) btn.disabled = true;
    showProgress(0, "Preparando...");
    try{
      for(let i = 0; i < arr.length; i++){
        const file = arr[i];
        showProgress(bytesDone / totalBytes, "Preparando " + (i + 1) + "/" + arr.length + "...");
        await uploadFile(file, frac => {
          const done = bytesDone + file.size * frac;
          const pct = Math.round((done / totalBytes) * 100);
          showProgress(done / totalBytes, "Enviando " + (i + 1) + "/" + arr.length + " — " + pct + "%");
        });
        bytesDone += file.size;
        const pct2 = Math.round((bytesDone / totalBytes) * 100);
        showProgress(bytesDone / totalBytes, "Enviando " + (i + 1) + "/" + arr.length + " — " + pct2 + "%");
      }
      showProgress(1, "Salvando catálogo...");
      await putJson(state.items);
      showProgress(1, "Concluído!");
      toast("Upload concluído.");
      state.page = 1;
      render();
      setTimeout(hideProgress, 1200);
    }catch(e){
      toast(e.message);
      hideProgress();
    }finally{
      if(btn) btn.disabled = false;
      if(fi) fi.value = "";
    }
  });
}

/* =========================================================
   LISTENERS + INIT
   ========================================================= */
ready(() => {
  console.log("[album] DOM pronto, registrando listeners v" + VERSION);

  on("#loginBtn", "click", () => {
    const p = document.getElementById("loginPassword");
    if(p && doLogin(p.value)) readConfig();
  });

  on("#loginPassword", "keydown", e => {
    if(e.key === "Enter"){
      const p = document.getElementById("loginPassword");
      if(p && doLogin(p.value)) readConfig();
    }
  });

  on("#logoutBtn", "click", e => {
    e.stopPropagation();
    const d = document.getElementById("menuDropdown");
    if(d) d.classList.add("hidden");
    try{ sessionStorage.removeItem("albumUser"); }catch{}
    state.user = null;
    document.body.classList.remove("logged-in");
    location.reload();
  });

  on("#menuBtn", "click", e => {
    e.stopPropagation();
    const d = document.getElementById("menuDropdown");
    if(d) d.classList.toggle("hidden");
  });

  document.addEventListener("click", e => {
    if(e.target && e.target.closest && !e.target.closest(".menu-wrap")){
      const d = document.getElementById("menuDropdown");
      if(d) d.classList.add("hidden");
    }
  });

  on("#settingsBtn", "click", e => {
    e.stopPropagation();
    const d = document.getElementById("menuDropdown");
    if(d) d.classList.add("hidden");
    const s = document.getElementById("settings");
    if(s) s.classList.remove("hidden");
  });

  on("#settingsClose", "click", () => {
    const s = document.getElementById("settings");
    if(s) s.classList.add("hidden");
  });

  on("#saveSettings", "click", async () => {
    const t = document.getElementById("token");
    const token = t ? t.value.trim() : "";
    if(!token){ toast("Cole o token."); return; }
    const c = {owner: DEFAULT_OWNER, repo: DEFAULT_REPO, branch: DEFAULT_BRANCH, token: token};
    state.config = c;
    try{
      await writeConfigFile(c);
      saveCfg(c);
      const s = document.getElementById("settings");
      if(s) s.classList.add("hidden");
      toast("Configuração salva.");
      await loadGallery();
    }catch(e){ toast(e.message); }
  });

  on("#uploadBtn", "click", () => {
    if(!requireLogin()) return;
    const fi = document.getElementById("fileInput");
    if(fi) fi.click();
  });

  on("#fileInput", "change", e => { uploadFiles(e.target.files); });

  on("#searchInput", "input", apply);
  on("#dateInput", "change", apply);

  on("#clearBtn", "click", () => {
    const si = document.getElementById("searchInput");
    const di = document.getElementById("dateInput");
    if(si) si.value = "";
    if(di) di.value = "";
    apply();
  });

  on("#todayBtn", "click", () => {
    const di = document.getElementById("dateInput");
    if(di) di.value = new Date().toISOString().slice(0, 10);
    apply();
  });

  on("#loadMore", "click", () => { state.page++; renderGallery(); });

  on("#viewerClose", "click", closeViewer);
  on("#viewerDownload", "click", () => downloadItem(state.viewerList[state.current]));
  on("#viewerDelete", "click", () => deleteItem(state.viewerList[state.current]));
  on("#prevBtn", "click", () => move(-1));
  on("#nextBtn", "click", () => move(1));

  const uf = document.getElementById("uploaderFilter");
  if(uf){
    uf.querySelectorAll(".filter-btn").forEach(b => {
      b.addEventListener("click", () => {
        uf.querySelectorAll(".filter-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        state.uploaderWho = b.dataset.who || "";
        apply();
      });
    });
  }

  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){
      closeViewer();
      const s = document.getElementById("settings");
      if(s) s.classList.add("hidden");
    }
    const v = document.getElementById("viewer");
    if(v && !v.classList.contains("hidden")){
      if(e.key === "ArrowLeft") move(-1);
      if(e.key === "ArrowRight") move(1);
    }
  });

  console.log("[album] listeners ok, versão", VERSION);

  try{
    if(!requireLogin()){
      console.log("[album] aguardando login");
    } else {
      readConfig();
    }
  }catch(e){
    console.error("[album] erro no init:", e);
    toast("Erro ao iniciar: " + e.message);
  }
});

})();