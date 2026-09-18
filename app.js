const $=s=>document.querySelector(s);
const state={items:[],filtered:[],page:0,pageSize:60,current:0,config:null,user:null,uploaderWho:""};
const DEFAULT_OWNER="JUURANDIR",DEFAULT_REPO="-lbum",DEFAULT_BRANCH="main";

/* ---------- login (define quem está usando o álbum) ---------- */
const USERS={Jurandir:"Jurandir",Mayanne:"Mayanne"};
function currentUser(){return state.user||sessionStorage.getItem("albumUser")}
function doLogin(pass){
  const found=Object.keys(USERS).find(name=>USERS[name]===pass);
  if(!found){$("#loginError").classList.remove("hidden");return false}
  state.user=found;sessionStorage.setItem("albumUser",found);
  $("#login").classList.add("hidden");$("#loginError").classList.add("hidden");
  $("#userBadge").textContent="Olá, "+found;$("#userBadge").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  return true;
}
function requireLogin(){
  const u=currentUser();
  if(!u){$("#login").classList.remove("hidden");return false}
  state.user=u;$("#userBadge").textContent="Olá, "+u;$("#userBadge").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  return true;
}

/* ---------- criptografia (AES-GCM) dos arquivos enviados ---------- */
// Chave única compartilhada pelas duas contas: só serve para embaralhar o
// conteúdo dos arquivos guardados no repositório, não é a senha de login.
const ENC_PASSPHRASE="jurandir-e-mayanne-album-secreto-v1";
let cryptoKeyPromise=null;
function getKey(){
  if(!cryptoKeyPromise)cryptoKeyPromise=(async()=>{
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ENC_PASSPHRASE));
    return crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["encrypt","decrypt"]);
  })();
  return cryptoKeyPromise;
}
async function encryptBuffer(buf){
  const key=await getKey(),iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,buf);
  return {cipher,iv:b64(iv.buffer)};
}
async function decryptBuffer(buf,ivB64){
  const key=await getKey(),iv=Uint8Array.from(atob(ivB64),c=>c.charCodeAt(0));
  return crypto.subtle.decrypt({name:"AES-GCM",iv},key,buf);
}
async function encryptText(str){
  const {cipher,iv}=await encryptBuffer(new TextEncoder().encode(str));
  return {data:b64(cipher),iv};
}
async function decryptText(data,iv){
  const cipherBuf=Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer;
  const plainBuf=await decryptBuffer(cipherBuf,iv);
  return new TextDecoder().decode(plainBuf);
}
function guessMime(name,fallback){
  if(fallback)return fallback;
  const ext=(name.split(".").pop()||"").toLowerCase();
  const map={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",heic:"image/heic",mp4:"video/mp4",mov:"video/quicktime",webm:"video/webm",m4v:"video/mp4"};
  return map[ext]||"application/octet-stream";
}
const blobUrlCache=new Map();
async function getDecryptedUrl(item){
  if(blobUrlCache.has(item.path))return blobUrlCache.get(item.path);
  const c=cfg();
  const r=await fetch(rawUrl(item.path),{headers:c?.token?{Authorization:"Bearer "+c.token}:{}});
  if(!r.ok)throw Error("Falha ao baixar arquivo.");
  const cipherBuf=await r.arrayBuffer();
  const plainBuf=await decryptBuffer(cipherBuf,item.iv);
  const url=URL.createObjectURL(new Blob([plainBuf],{type:guessMime(item.name,item.type)}));
  blobUrlCache.set(item.path,url);
  return url;
}

function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.add("show");clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.remove("show"),2800)}
function cfg(){return state.config}
function saveCfg(c){state.config=c;localStorage.setItem("albumConfig",JSON.stringify(c))}
function api(path,opt={}){const c=cfg();if(!c?.token)throw Error("Configure o GitHub primeiro.");return fetch("https://api.github.com"+path,{...opt,headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+c.token,"X-GitHub-Api-Version":"2026-03-10",...(opt.headers||{})}})}
function rawUrl(path){const c=cfg();return `https://raw.githubusercontent.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`}
function b64(buf){let s="";const a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
function niceDate(d){return new Intl.DateTimeFormat("pt-BR",{dateStyle:"full"}).format(new Date(d+"T12:00:00"))}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

async function loadGallery(){
  const c=cfg();
  if(!c){render();return}
  try{
    const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/gallery.json?ref=${encodeURIComponent(c.branch)}`);
    if(r.ok){const x=await r.json();const bytes=Uint8Array.from(atob(x.content.replace(/\n/g,"")),ch=>ch.charCodeAt(0));state.gallerySha=x.sha;state.items=JSON.parse(new TextDecoder().decode(bytes))}
    else if(r.status===404) state.items=[];
    else throw Error("Não foi possível ler gallery.json.");
    state.items.sort((a,b)=>b.date.localeCompare(a.date)||b.uploadedAt.localeCompare(a.uploadedAt));
    render();
  }catch(e){toast(e.message);render()}
}
function apply(){
  const q=$("#searchInput").value.trim().toLowerCase(),d=$("#dateInput").value,who=state.uploaderWho;
  state.filtered=state.items.filter(x=>(!d||x.date===d)&&(!who||x.uploadedBy===who)&&(!q||x.name.toLowerCase().includes(q)||x.date.includes(q)||niceDate(x.date).toLowerCase().includes(q)));
  state.page=1;renderGallery();
}
function render(){
  $("#totalCount").textContent=state.items.length;
  apply();buildTimeline();
}
function buildTimeline(){
  const groups=[...new Set(state.items.map(x=>x.date.slice(0,7)))];
  $("#timelineNav").innerHTML=groups.map(m=>`<button data-month="${m}">${new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(m+"-01T12:00:00"))}</button>`).join("");
  $("#timelineNav").querySelectorAll("button").forEach(b=>b.onclick=()=>{$("#searchInput").value="";$("#dateInput").value="";state.filtered=state.items.filter(x=>x.date.startsWith(b.dataset.month)&&(!state.uploaderWho||x.uploadedBy===state.uploaderWho));state.page=1;renderGallery()});
}
const mediaObserver=new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    mediaObserver.unobserve(entry.target);
    fillCardMedia(entry.target);
  });
},{rootMargin:"250px"});
async function fillCardMedia(card){
  const item=state.filtered[+card.dataset.idx];
  if(!item)return;
  try{
    const url=await getDecryptedUrl(item);
    const isVideo=item.type.startsWith("video");
    card.querySelector(".media-wrap").innerHTML=isVideo?`<video src="${url}" muted preload="metadata" playsinline></video>`:`<img src="${url}" alt="">`;
  }catch(e){card.querySelector(".media-wrap").textContent="Erro ao carregar"}
}
function renderGallery(){
  const shown=state.filtered.slice(0,state.page*state.pageSize);
  $("#gallery").innerHTML="";
  if(!shown.length){$("#empty").classList.remove("hidden");$("#loadMore").classList.add("hidden");return}
  $("#empty").classList.add("hidden");
  let last="";
  shown.forEach((x)=>{
    if(x.date!==last){const d=document.createElement("div");d.className="day";d.innerHTML=`<h3>${niceDate(x.date)}</h3><small>${state.filtered.filter(y=>y.date===x.date).length} item(ns)</small>`;$("#gallery").appendChild(d);last=x.date}
    const card=document.createElement("article");card.className="card";
    card.dataset.idx=state.filtered.indexOf(x);
    card.innerHTML=`<div class="media-wrap">Carregando…</div><span class="type">${x.type.startsWith("video")?"▶ Vídeo":"▣ Foto"}</span><span class="uploader-tag">${escapeHtml(x.uploadedBy||"?")}</span><div class="name">${escapeHtml(x.name)}</div>`;
    card.onclick=()=>openViewer(state.filtered.indexOf(x),state.filtered);
    $("#gallery").appendChild(card);
    mediaObserver.observe(card);
  });
  $("#loadMore").classList.toggle("hidden",shown.length>=state.filtered.length);
}
async function openViewer(i,list){state.viewerList=list;state.current=i;$("#viewer").classList.remove("hidden");await showViewer()}
async function showViewer(){
  const x=state.viewerList[state.current];
  $("#viewerContent").innerHTML="Carregando…";
  try{
    const url=await getDecryptedUrl(x);
    $("#viewerContent").innerHTML=x.type.startsWith("video")?`<video src="${url}" controls autoplay playsinline></video>`:`<img src="${url}" alt="">`;
  }catch(e){$("#viewerContent").innerHTML="Erro ao carregar o arquivo."}
  $("#viewerCaption").textContent=`${x.name} • ${niceDate(x.date)} • enviado por ${x.uploadedBy||"?"}`;
}
async function downloadItem(item){
  try{
    const url=await getDecryptedUrl(item);
    const a=document.createElement("a");a.href=url;a.download=item.name;document.body.appendChild(a);a.click();a.remove();
  }catch(e){toast("Falha ao baixar: "+e.message)}
}
async function deleteItem(item){
  if(!confirm(`Excluir "${item.name}" para sempre?`))return;
  try{
    const c=cfg();
    let sha=item.sha;
    if(!sha){
      const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(c.branch)}`);
      if(r.ok)sha=(await r.json()).sha;
    }
    const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}`,{method:"DELETE",body:JSON.stringify({message:`album: remover ${item.name}`,sha,branch:c.branch})});
    if(!res.ok)throw Error((await res.json()).message||"Falha ao excluir arquivo.");
    state.items=state.items.filter(x=>x.path!==item.path);
    await putJson(state.items,state.gallerySha);
    if(blobUrlCache.has(item.path)){URL.revokeObjectURL(blobUrlCache.get(item.path));blobUrlCache.delete(item.path)}
    $("#viewer").classList.add("hidden");$("#viewerContent").innerHTML="";
    toast("Excluído.");
    render();
  }catch(e){toast(e.message)}
}
function move(n){state.current=(state.current+n+state.viewerList.length)%state.viewerList.length;showViewer()}

async function readConfigFile(){
  // busca config.json direto do próprio site (arquivo que você edita à mão)
  try{
    const r=await fetch("config.json?t="+Date.now(),{cache:"no-store"});
    if(!r.ok)return null;
    const c=await r.json();
    if(!c.owner||!c.repo||!c.token||c.token.startsWith("cole_aqui"))return null;
    return {owner:c.owner,repo:c.repo,branch:c.branch||"main",token:c.token};
  }catch{return null}
}
async function writeConfigFile(c){
  const content=b64(new TextEncoder().encode(JSON.stringify({owner:c.owner,repo:c.repo,branch:c.branch,token:c.token},null,2)));
  let sha;
  try{
    const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/config.json?ref=${encodeURIComponent(c.branch)}`);
    if(r.ok)sha=(await r.json()).sha;
  }catch{}
  const body={message:"album: salvar configuração",content,branch:c.branch};
  if(sha)body.sha=sha;
  const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/config.json`,{method:"PUT",body:JSON.stringify(body)});
  if(!res.ok)throw Error((await res.json()).message||"Falha ao salvar configuração no repositório.");
}
async function readConfig(){
  const fromFile=await readConfigFile();
  if(fromFile){state.config=fromFile;await loadGallery();return}
  try{const local=JSON.parse(localStorage.getItem("albumConfig")||"null");if(local){state.config=local;await loadGallery();return}}catch{}
  $("#settings").classList.remove("hidden");
}
async function putJson(items,sha){
  const c=cfg(),content=JSON.stringify(items,null,2),encoded=b64(new TextEncoder().encode(content));
  const body={message:`album: atualizar catálogo`,content:encoded,branch:c.branch};
  if(sha)body.sha=sha;
  const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/gallery.json`,{method:"PUT",body:JSON.stringify(body)});
  if(!r.ok)throw Error((await r.json()).message||"Falha ao salvar catálogo.");
  state.gallerySha=(await r.json()).content.sha;
}
async function uploadFile(file){
  const c=cfg(),now=new Date(),date=$("#dateInput").value||now.toISOString().slice(0,10);
  if(file.size>100*1024*1024)throw Error(`${file.name}: acima de 100 MB. GitHub bloqueia arquivos maiores no Git normal.`);
  const clean=file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w.\- ]+/g,"").trim().replace(/\s+/g,"-")||`arquivo-${Date.now()}`;
  const path=`media/${date.slice(0,4)}/${date.slice(5,7)}/${date}/${Date.now()}-${clean}.enc`;
  const raw=await file.arrayBuffer();
  const {cipher,iv}=await encryptBuffer(raw);
  const encoded=b64(cipher);
  const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,{method:"PUT",body:JSON.stringify({message:`album: adicionar ${clean}`,content:encoded,branch:c.branch})});
  if(!res.ok)throw Error(`${file.name}: ${(await res.json()).message||"falha no upload"}`);
  const resJson=await res.json();
  state.items.push({name:file.name,path,date,type:file.type,bytes:file.size,iv,sha:resJson.content.sha,uploadedAt:new Date().toISOString(),uploadedBy:currentUser()});
  state.items.sort((a,b)=>b.date.localeCompare(a.date)||b.uploadedAt.localeCompare(a.uploadedAt));
}
async function uploadFiles(files){
  if(!requireLogin())return;
  if(!cfg()){toast("Configure o GitHub primeiro.");$("#settings").classList.remove("hidden");return}
  const arr=[...files];if(!arr.length)return;
  $("#uploadBtn").disabled=true;toast(`Enviando ${arr.length} arquivo(s)...`);
  try{
    for(let i=0;i<arr.length;i++){toast(`Enviando ${i+1}/${arr.length}: ${arr[i].name}`);await uploadFile(arr[i])}
    await putJson(state.items,state.gallerySha);
    toast("Upload concluído.");
    render();
  }catch(e){toast(e.message)}
  finally{$("#uploadBtn").disabled=false;$("#fileInput").value=""}
}

$("#loginBtn").onclick=()=>{if(doLogin($("#loginPassword").value))readConfig()};
$("#loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter"&&doLogin($("#loginPassword").value))readConfig()});
$("#logoutBtn").onclick=()=>{$("#menuDropdown").classList.add("hidden");sessionStorage.removeItem("albumUser");state.user=null;location.reload()};
$("#menuBtn").onclick=(e)=>{e.stopPropagation();$("#menuDropdown").classList.toggle("hidden")};
document.addEventListener("click",(e)=>{if(!e.target.closest(".menu-wrap"))$("#menuDropdown").classList.add("hidden")});

$("#settingsBtn").onclick=()=>{$("#menuDropdown").classList.add("hidden");if(!requireLogin())return;$("#settings").classList.remove("hidden")}
$("#settingsClose").onclick=()=>$("#settings").classList.add("hidden");
$("#saveSettings").onclick=async()=>{
  const token=$("#token").value.trim();
  if(!token)return toast("Cole o token.");
  const c={owner:DEFAULT_OWNER,repo:DEFAULT_REPO,branch:DEFAULT_BRANCH,token};
  state.config=c;
  try{
    await writeConfigFile(c);
    saveCfg(c);
    $("#settings").classList.add("hidden");
    toast("Configuração salva. Não vai pedir de novo.");
    await loadGallery();
  }catch(e){toast(e.message)}
};
$("#uploadBtn").onclick=()=>{if(!requireLogin())return;$("#fileInput").click()};
$("#fileInput").onchange=e=>uploadFiles(e.target.files);
$("#searchInput").oninput=apply;
$("#dateInput").onchange=apply;
$("#clearBtn").onclick=()=>{$("#searchInput").value="";$("#dateInput").value="";apply()};
$("#todayBtn").onclick=()=>{$("#dateInput").value=new Date().toISOString().slice(0,10);apply()};
$("#loadMore").onclick=()=>{state.page++;renderGallery()};
$("#viewerClose").onclick=()=>{$("#viewer").classList.add("hidden");$("#viewerContent").innerHTML=""};
$("#viewerDownload").onclick=()=>downloadItem(state.viewerList[state.current]);
$("#viewerDelete").onclick=()=>deleteItem(state.viewerList[state.current]);
$("#prevBtn").onclick=()=>move(-1);$("#nextBtn").onclick=()=>move(1);
$("#uploaderFilter").querySelectorAll(".filter-btn").forEach(b=>b.onclick=()=>{
  $("#uploaderFilter").querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");state.uploaderWho=b.dataset.who;apply();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("#viewer").classList.add("hidden");$("#settings").classList.add("hidden")}if(!$("#viewer").classList.contains("hidden")){if(e.key==="ArrowLeft")move(-1);if(e.key==="ArrowRight")move(1)}});

if(!requireLogin()){/* aguardando login */}else{readConfig()}
