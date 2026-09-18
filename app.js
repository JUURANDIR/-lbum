const $=s=>document.querySelector(s);
const state={items:[],filtered:[],page:0,pageSize:60,current:0,config:null,user:null,
  uploaderWho:"",catFilter:"",dateMode:"date",locOnly:false,
  categories:[],categoriesSha:null,gallerySha:null,
  selectMode:false,selected:new Set(),pendingFiles:null,
  categoryModalMode:"single",categoryModalTarget:null,captionTarget:null,shareTarget:null,
  deferredInstall:null};
const DEFAULT_OWNER="JUURANDIR",DEFAULT_REPO="albumjuemay",DEFAULT_BRANCH="main";

/* ---------- login ---------- */
const USERS={Jurandir:"Jurandir",Mayanne:"Mayanne"};
function currentUser(){return state.user||sessionStorage.getItem("albumUser")}
function doLogin(pass){
  const found=Object.keys(USERS).find(name=>USERS[name]===pass);
  if(!found){$("#loginError").classList.remove("hidden");return false}
  state.user=found;sessionStorage.setItem("albumUser",found);
  $("#login").classList.add("hidden");$("#loginError").classList.add("hidden");
  $("#userBadge").textContent="Olá, "+found;$("#userBadge").classList.remove("hidden");
  logEvent("login",found,"entrou no álbum");
  return true;
}
function requireLogin(){
  const u=currentUser();
  if(!u){$("#login").classList.remove("hidden");return false}
  state.user=u;$("#userBadge").textContent="Olá, "+u;$("#userBadge").classList.remove("hidden");
  return true;
}

/* ---------- criptografia ---------- */
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

/* ---------- utils ---------- */
function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.add("show");clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.remove("show"),3200)}
function cfg(){return state.config}
function saveCfg(c){state.config=c;localStorage.setItem("albumConfig",JSON.stringify(c))}
function api(path,opt={}){const c=cfg();if(!c?.token)throw Error("Configure o GitHub primeiro.");return fetch("https://api.github.com"+path,{...opt,headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+c.token,"X-GitHub-Api-Version":"2026-03-10",...(opt.headers||{})}})}
function b64(buf){let s="";const a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
function niceDate(d){if(!d)return"";return new Intl.DateTimeFormat("pt-BR",{dateStyle:"full"}).format(new Date(d+"T12:00:00"))}
function niceDateTime(iso){try{return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(iso))}catch{return iso}}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function fmtBytes(n){if(!n)return"—";const u=["B","KB","MB","GB"];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return n.toFixed(1)+" "+u[i]}

/* ---------- leitura/escrita genérica de arquivos JSON no repositório ---------- */
async function readJsonFile(path){
  const c=cfg();
  const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
  if(r.ok){const x=await r.json();const bytes=Uint8Array.from(atob(x.content.replace(/\n/g,"")),ch=>ch.charCodeAt(0));return{data:JSON.parse(new TextDecoder().decode(bytes)),sha:x.sha}}
  if(r.status===404)return{data:null,sha:null};
  const detail=await r.json().catch(()=>({}));
  throw Error(`Falha ao ler ${path} (HTTP ${r.status}: ${detail.message||"erro desconhecido"}).`);
}
async function writeJsonFile(path,data,sha,message){
  const c=cfg();
  const content=b64(new TextEncoder().encode(JSON.stringify(data,null,2)));
  const body={message,content,branch:c.branch};
  if(sha)body.sha=sha;
  const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`,{method:"PUT",body:JSON.stringify(body)});
  if(!res.ok){
    if(res.status===409){const fresh=await readJsonFile(path);return writeJsonFile(path,data,fresh.sha,message)}
    throw Error((await res.json().catch(()=>({}))).message||`Falha ao salvar ${path}.`);
  }
  return(await res.json()).content.sha;
}
async function putGallery(){state.gallerySha=await writeJsonFile("gallery.json",state.items,state.gallerySha,"album: atualizar catálogo")}
async function putCategories(){state.categoriesSha=await writeJsonFile("categories.json",state.categories,state.categoriesSha,"album: atualizar categorias")}

/* ---------- histórico ---------- */
async function logEvent(action,who,details){
  if(!cfg())return;
  try{
    const {data,sha}=await readJsonFile("history.json");
    const list=data||[];
    list.unshift({ts:new Date().toISOString(),who:who||currentUser()||"?",action,details:details||""});
    while(list.length>500)list.pop();
    await writeJsonFile("history.json",list,sha,"album: histórico");
  }catch{/* histórico é best-effort, nunca trava a ação principal */}
}
async function loadHistory(){
  $("#historyList").innerHTML="Carregando…";
  try{
    const {data}=await readJsonFile("history.json");
    const list=data||[];
    if(!list.length){$("#historyList").innerHTML='<p class="muted-sm">Nada por aqui ainda.</p>';return}
    $("#historyList").innerHTML=list.map(h=>`<div class="history-item"><span class="who">${escapeHtml(h.who)}</span> ${escapeHtml(actionLabel(h.action))} ${escapeHtml(h.details||"")}<span class="when">${niceDateTime(h.ts)}</span></div>`).join("");
  }catch(e){$("#historyList").innerHTML=`<p class="muted-sm">${escapeHtml(e.message)}</p>`}
}
function actionLabel(a){return({login:"entrou",upload:"enviou",delete:"excluiu",caption:"editou a legenda de",category:"categorizou",share_create:"compartilhou",share_revoke:"revogou o link de"}[a]||a)}

/* ---------- EXIF (best-effort, só JPEG) ---------- */
function parseExif(buf){
  try{
    const view=new DataView(buf);
    if(view.getUint16(0)!==0xFFD8)return null;
    let offset=2;
    while(offset<view.byteLength){
      if(view.getUint16(offset)!==0xFFE1){
        const size=view.getUint16(offset+2);
        if(view.getUint16(offset)===0xFFDA||size<2)break;
        offset+=2+size;continue;
      }
      const start=offset+4;
      if(view.getUint32(start)!==0x45786966)return null; // "Exif"
      const tiff=start+6;
      const little=view.getUint16(tiff)===0x4949;
      const g16=o=>view.getUint16(o,little),g32=o=>view.getUint32(o,little);
      const ifd0=tiff+g32(tiff+4);
      const entries={};
      function readIFD(ifdOffset){
        const n=g16(ifdOffset);
        const out={};
        for(let i=0;i<n;i++){
          const e=ifdOffset+2+i*12;
          const tag=g16(e),type=g16(e+2),count=g32(e+4);
          const size=({1:1,2:1,3:2,4:4,5:8,9:4,10:8})[type]||4;
          const totalSize=size*count;
          const valOffset=totalSize>4?tiff+g32(e+8):e+8;
          out[tag]={type,count,valOffset,entryOffset:e+8};
        }
        return out;
      }
      const ifd0Entries=readIFD(ifd0);
      let takenAt=null,lat=null,lon=null;
      if(ifd0Entries[0x8769]){
        const expOffset=tiff+g32(ifd0Entries[0x8769].entryOffset);
        const exif=readIFD(expOffset);
        const dt=exif[0x9003]||exif[0x9004];
        if(dt){
          let s="";for(let i=0;i<19;i++)s+=String.fromCharCode(view.getUint8(dt.valOffset+i));
          const m=s.match(/(\d{4}):(\d{2}):(\d{2})/);
          if(m)takenAt=`${m[1]}-${m[2]}-${m[3]}`;
        }
      }
      if(ifd0Entries[0x8825]){
        const gpsOffset=tiff+g32(ifd0Entries[0x8825].entryOffset);
        const gps=readIFD(gpsOffset);
        function rational3(o){
          const vals=[];
          for(let i=0;i<3;i++){const num=g32(o+i*8),den=g32(o+i*8+4);vals.push(den?num/den:0)}
          return vals[0]+vals[1]/60+vals[2]/3600;
        }
        if(gps[2]&&gps[4]){
          const latOff=tiff+g32(gps[2].entryOffset),lonOff=tiff+g32(gps[4].entryOffset);
          lat=rational3(latOff);lon=rational3(lonOff);
          const latRefByte=gps[1]?view.getUint8(gps[1].entryOffset):78;
          const lonRefByte=gps[3]?view.getUint8(gps[3].entryOffset):69;
          if(String.fromCharCode(latRefByte)==="S")lat=-lat;
          if(String.fromCharCode(lonRefByte)==="W")lon=-lon;
        }
      }
      return{takenAt,lat,lon};
    }
    return null;
  }catch{return null}
}

/* ---------- arquivo criptografado (blob via API, evita CORS do raw) ---------- */
async function getFileSha(item){
  if(item.sha)return item.sha;
  const c=cfg();
  const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(c.branch)}`);
  if(!r.ok)throw Error(`Arquivo não encontrado no repositório (HTTP ${r.status}).`);
  const meta=await r.json();item.sha=meta.sha;return meta.sha;
}
async function getDecryptedUrl(item){
  if(blobUrlCache.has(item.path))return blobUrlCache.get(item.path);
  const c=cfg();
  const sha=await getFileSha(item);
  const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/blobs/${sha}`);
  if(!r.ok)throw Error(`Falha ao baixar arquivo (HTTP ${r.status}).`);
  const blob=await r.json();
  const cipherBuf=Uint8Array.from(atob(blob.content.replace(/\n/g,"")),ch=>ch.charCodeAt(0)).buffer;
  const plainBuf=await decryptBuffer(cipherBuf,item.iv);
  const url=URL.createObjectURL(new Blob([plainBuf],{type:guessMime(item.name,item.type)}));
  blobUrlCache.set(item.path,url);
  return url;
}

/* ---------- carregar dados ---------- */
async function loadGallery(){
  const c=cfg();
  if(!c){render();return}
  try{
    const {data,sha}=await readJsonFile("gallery.json");
    state.items=data||[];state.gallerySha=sha;
    state.items.sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.uploadedAt||"").localeCompare(a.uploadedAt||""));
    const cats=await readJsonFile("categories.json");
    state.categories=cats.data||[];state.categoriesSha=cats.sha;
    fillCategorySelect();
    render();
  }catch(e){toast(e.message);render()}
}
function fillCategorySelect(){
  $("#categorySelect").innerHTML='<option value="">Todas</option>'+state.categories.map(cat=>`<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");
}

/* ---------- filtro/render ---------- */
function apply(){
  const q=$("#searchInput").value.trim().toLowerCase(),d=$("#dateInput").value,who=state.uploaderWho;
  const dateField=state.dateMode;
  state.filtered=state.items.filter(x=>{
    if(state.catFilter&&!(x.categories||[]).includes(state.catFilter))return false;
    if(who&&x.uploadedBy!==who)return false;
    if(state.locOnly&&!(x.lat&&x.lon))return false;
    if(d){const val=dateField==="uploadedAt"?(x.uploadedAt||"").slice(0,10):(x.date||"");if(val!==d)return false}
    if(q){
      const hay=[x.name,x.date,x.caption,...(x.categories||[])].filter(Boolean).join(" ").toLowerCase();
      if(!hay.includes(q)&&!niceDate(x.date).toLowerCase().includes(q))return false;
    }
    return true;
  });
  state.page=1;renderGallery();updateFilterSummary();
}
function updateFilterSummary(){
  const parts=[];
  if(state.uploaderWho)parts.push(state.uploaderWho);
  if(state.catFilter)parts.push(state.catFilter);
  if(state.locOnly)parts.push("com localização");
  if($("#dateInput").value)parts.push(niceDate($("#dateInput").value));
  $("#filterSummary").textContent=parts.length?parts.join(" · "):"tudo";
}
function render(){
  $("#totalCount").textContent=state.items.length;
  apply();buildTimeline();
}
function buildTimeline(){
  const groups=[...new Set(state.items.map(x=>(x.date||"").slice(0,7)).filter(Boolean))];
  $("#timelineNav").innerHTML=groups.map(m=>`<button type="button" data-month="${m}">${new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(m+"-01T12:00:00"))}</button>`).join("");
  $("#timelineNav").querySelectorAll("button").forEach(b=>b.onclick=()=>{
    $("#searchInput").value="";$("#dateInput").value="";
    state.filtered=state.items.filter(x=>(x.date||"").startsWith(b.dataset.month)&&(!state.uploaderWho||x.uploadedBy===state.uploaderWho)&&(!state.catFilter||(x.categories||[]).includes(state.catFilter)));
    state.page=1;renderGallery();
  });
}
const mediaObserver=new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{if(!entry.isIntersecting)return;mediaObserver.unobserve(entry.target);fillCardMedia(entry.target)});
},{rootMargin:"250px"});
async function fillCardMedia(card){
  const item=state.filtered[+card.dataset.idx];
  if(!item)return;
  try{
    const url=await getDecryptedUrl(item);
    const isVideo=item.type.startsWith("video");
    card.querySelector(".media-wrap").innerHTML=isVideo?`<video src="${url}" muted preload="metadata" playsinline></video>`:`<img src="${url}" alt="">`;
  }catch(e){card.querySelector(".media-wrap").textContent="Erro"}
}
function renderGallery(){
  const shown=state.filtered.slice(0,state.page*state.pageSize);
  $("#gallery").innerHTML="";
  if(!shown.length){$("#empty").classList.remove("hidden");$("#loadMore").classList.add("hidden");return}
  $("#empty").classList.add("hidden");
  let last="";
  shown.forEach((x)=>{
    if(x.date!==last){const d=document.createElement("div");d.className="day";d.innerHTML=`<h3>${niceDate(x.date)}</h3><small>${state.filtered.filter(y=>y.date===x.date).length} item(ns)</small>`;$("#gallery").appendChild(d);last=x.date}
    const idx=state.filtered.indexOf(x);
    const card=document.createElement("article");card.className="card"+(state.selected.has(x.path)?" selected":"");
    card.dataset.idx=idx;
    card.innerHTML=`<div class="media-wrap">Carregando…</div><span class="type">${x.type.startsWith("video")?"▶":"▣"}</span><span class="uploader-tag">${escapeHtml(x.uploadedBy||"?")}</span>${x.caption?'<span class="cap-dot">✎</span>':""}${state.selectMode?'<span class="select-check">'+(state.selected.has(x.path)?"✓":"")+'</span>':""}`;
    card.onclick=()=>{
      if(state.selectMode){toggleSelect(x.path);return}
      openViewer(idx,state.filtered);
    };
    $("#gallery").appendChild(card);
    mediaObserver.observe(card);
  });
  $("#loadMore").classList.toggle("hidden",shown.length>=state.filtered.length);
}
function toggleSelect(path){
  if(state.selected.has(path))state.selected.delete(path);else state.selected.add(path);
  renderGallery();updateSelectionBar();
}
function updateSelectionBar(){
  const n=state.selected.size;
  $("#selectionBar").classList.toggle("hidden",!state.selectMode||n===0);
  $("#selectionCount").textContent=`${n} selecionado(s)`;
}

/* ---------- viewer ---------- */
async function openViewer(i,list){state.viewerList=list;state.current=i;$("#viewer").classList.remove("hidden");await showViewer()}
async function showViewer(){
  const x=state.viewerList[state.current];
  $("#viewerContent").innerHTML="Carregando…";
  try{
    const url=await getDecryptedUrl(x);
    $("#viewerContent").innerHTML=x.type.startsWith("video")?`<video src="${url}" controls autoplay playsinline></video>`:`<img src="${url}" alt="">`;
  }catch(e){$("#viewerContent").innerHTML="Erro ao carregar o arquivo."}
  $("#viewerCaption").textContent=x.caption?x.caption:`${x.name} • ${niceDate(x.date)} • enviado por ${x.uploadedBy||"?"}`;
  $("#viewerTags").innerHTML=(x.categories||[]).map(c=>`<span class="tag-chip">${escapeHtml(c)}</span>`).join("");
}
function move(n){state.current=(state.current+n+state.viewerList.length)%state.viewerList.length;showViewer()}
function curItem(){return state.viewerList?state.viewerList[state.current]:null}

/* ---------- download / delete ---------- */
async function downloadItem(item){
  try{const url=await getDecryptedUrl(item);const a=document.createElement("a");a.href=url;a.download=item.name;document.body.appendChild(a);a.click();a.remove()}
  catch(e){toast("Falha ao baixar: "+e.message)}
}
async function deleteFile(item){
  const c=cfg();
  let sha=item.sha;
  try{if(!sha)sha=await getFileSha(item)}catch{sha=null}
  if(sha){
    const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}`,{method:"DELETE",body:JSON.stringify({message:`album: remover ${item.name}`,sha,branch:c.branch})});
    if(!res.ok&&res.status!==404){throw Error((await res.json().catch(()=>({}))).message||"Falha ao excluir arquivo.")}
  }
  state.items=state.items.filter(x=>x.path!==item.path);
  if(blobUrlCache.has(item.path)){URL.revokeObjectURL(blobUrlCache.get(item.path));blobUrlCache.delete(item.path)}
}
async function deleteItem(item){
  if(!confirm(`Excluir "${item.name}" para sempre?`))return;
  try{
    await deleteFile(item);
    await putGallery();
    logEvent("delete",currentUser(),item.name);
    $("#viewer").classList.add("hidden");$("#viewerContent").innerHTML="";
    toast("Excluído.");render();
  }catch(e){toast(e.message)}
}
async function bulkDelete(){
  if(!confirm(`Excluir ${state.selected.size} item(ns) para sempre?`))return;
  const paths=[...state.selected];
  toast(`Excluindo 0/${paths.length}...`);
  let ok=0;
  for(let i=0;i<paths.length;i++){
    const item=state.items.find(x=>x.path===paths[i]);
    if(!item)continue;
    try{await deleteFile(item);ok++;toast(`Excluindo ${i+1}/${paths.length}...`)}catch{}
  }
  await putGallery();
  logEvent("delete",currentUser(),`${ok} item(ns) em lote`);
  state.selected.clear();exitSelectMode();
  toast(`${ok} excluído(s).`);render();
}

/* ---------- legenda ---------- */
function openCaptionModal(item){
  state.captionTarget=item;
  $("#captionInput").value=item.caption||"";
  $("#captionModal").classList.remove("hidden");
}
async function saveCaption(){
  const item=state.captionTarget;if(!item)return;
  item.caption=$("#captionInput").value.trim();
  try{await putGallery();logEvent("caption",currentUser(),item.name);$("#captionModal").classList.add("hidden");toast("Legenda salva.");if(!$("#viewer").classList.contains("hidden"))showViewer();renderGallery()}
  catch(e){toast(e.message)}
}

/* ---------- categorias ---------- */
function openCategoryModal(mode,target){
  state.categoryModalMode=mode;state.categoryModalTarget=target;
  $("#categoryModalTitle").textContent=mode==="upload"?"Categorizar envio":(mode==="bulk"?`Categorizar ${state.selected.size} item(ns)`:"Categorias");
  renderCategoryChips();
  $("#categoryModal").classList.remove("hidden");
}
function renderCategoryChips(){
  const current=state.categoryModalMode==="single"?(state.categoryModalTarget.categories||[]):[];
  $("#categoryChips").innerHTML=state.categories.map(cat=>`<button type="button" class="chip${current.includes(cat)?" on":""}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("")||'<span class="muted-sm">Nenhuma categoria ainda. Crie uma abaixo.</span>';
  $("#categoryChips").querySelectorAll(".chip").forEach(ch=>ch.onclick=()=>ch.classList.toggle("on"));
}
async function addNewCategory(){
  const name=$("#newCategoryInput").value.trim();
  if(!name)return;
  if(!state.categories.includes(name)){state.categories.push(name);try{await putCategories()}catch(e){toast(e.message);return}fillCategorySelect()}
  $("#newCategoryInput").value="";
  renderCategoryChips();
  const chip=[...$("#categoryChips").querySelectorAll(".chip")].find(c=>c.dataset.cat===name);
  if(chip)chip.classList.add("on");
}
async function applyCategoryModal(){
  const chosen=[...$("#categoryChips").querySelectorAll(".chip.on")].map(c=>c.dataset.cat);
  if(state.categoryModalMode==="upload"){
    $("#categoryModal").classList.add("hidden");
    await doUpload(state.pendingFiles,chosen);
    return;
  }
  try{
    if(state.categoryModalMode==="bulk"){
      state.items.forEach(x=>{if(state.selected.has(x.path))x.categories=chosen});
      await putGallery();
      logEvent("category",currentUser(),`${state.selected.size} item(ns) → ${chosen.join(", ")||"(nenhuma)"}`);
      state.selected.clear();exitSelectMode();
    }else{
      state.categoryModalTarget.categories=chosen;
      await putGallery();
      logEvent("category",currentUser(),`${state.categoryModalTarget.name} → ${chosen.join(", ")||"(nenhuma)"}`);
      if(!$("#viewer").classList.contains("hidden"))showViewer();
    }
    $("#categoryModal").classList.add("hidden");
    toast("Categorias atualizadas.");render();
  }catch(e){toast(e.message)}
}

/* ---------- compartilhar ---------- */
function shareUrl(id){return location.origin+location.pathname+"?s="+id}
function openShareModal(item){
  state.shareTarget=item;
  $("#shareModal").classList.remove("hidden");
  renderShareLinks();
}
async function renderShareLinks(){
  $("#shareLinksList").innerHTML="Carregando…";
  try{
    const {data}=await readJsonFile("shares.json");
    const list=(data||[]).filter(s=>s.path===state.shareTarget.path&&s.expiresAt>Date.now());
    $("#shareLinksList").innerHTML=list.length?list.map(s=>`<div class="share-link-row"><code>${shareUrl(s.id)}</code><button type="button" data-copy="${shareUrl(s.id)}">Copiar</button><button type="button" data-revoke="${s.id}">Revogar</button></div>`).join(""):'<p class="muted-sm">Nenhum link ativo.</p>';
    $("#shareLinksList").querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(b.dataset.copy);toast("Link copiado.")});
    $("#shareLinksList").querySelectorAll("[data-revoke]").forEach(b=>b.onclick=()=>revokeShare(b.dataset.revoke));
  }catch(e){$("#shareLinksList").innerHTML=`<p class="muted-sm">${escapeHtml(e.message)}</p>`}
}
async function createShare(){
  const item=state.shareTarget;if(!item)return;
  try{
    const sha=await getFileSha(item);
    const {data,sha:fsha}=await readJsonFile("shares.json");
    const list=data||[];
    const id=(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()).replace(/-/g,"").slice(0,16);
    const dur=+$("#shareDuration").value;
    list.push({id,path:item.path,sha,iv:item.iv,type:item.type,name:item.name,caption:item.caption||"",createdBy:currentUser(),createdAt:Date.now(),expiresAt:Date.now()+dur});
    await writeJsonFile("shares.json",list,fsha,"album: novo link de compartilhamento");
    logEvent("share_create",currentUser(),item.name);
    toast("Link gerado.");
    renderShareLinks();
  }catch(e){toast(e.message)}
}
async function revokeShare(id){
  try{
    const {data,sha}=await readJsonFile("shares.json");
    const list=(data||[]).filter(s=>s.id!==id);
    await writeJsonFile("shares.json",list,sha,"album: revogar link");
    logEvent("share_revoke",currentUser(),id);
    toast("Link revogado.");renderShareLinks();
  }catch(e){toast(e.message)}
}

/* ---------- informações ---------- */
function openInfoModal(item){
  const rows=[
    ["Nome",item.name],["Enviado por",item.uploadedBy||"?"],["Enviado em",niceDateTime(item.uploadedAt)],
    ["Data da foto",item.takenAt?niceDate(item.takenAt):(item.date?niceDate(item.date):"—")],
    ["Tamanho",fmtBytes(item.bytes)],["Categorias",(item.categories||[]).join(", ")||"—"],
  ];
  if(item.lat&&item.lon)rows.push(["Local",`<a href="https://maps.google.com/?q=${item.lat},${item.lon}" target="_blank" rel="noopener">ver no mapa</a>`]);
  $("#infoBody").innerHTML=rows.map(([k,v])=>`<div><span>${k}</span><span>${v}</span></div>`).join("");
  $("#infoModal").classList.remove("hidden");
}

/* ---------- config ---------- */
async function readConfigFile(){
  try{
    const r=await fetch("config.json?t="+Date.now(),{cache:"no-store"});
    if(!r.ok)return null;
    const c=await r.json();
    if(!c.owner||!c.repo||!c.tokenEnc)return null;
    const token=await decryptText(c.tokenEnc.data,c.tokenEnc.iv);
    if(!token||token.startsWith("cole_aqui"))return null;
    return{owner:c.owner,repo:c.repo,branch:c.branch||"main",token};
  }catch{return null}
}
async function writeConfigFile(c){
  const tokenEnc=await encryptText(c.token);
  const content=b64(new TextEncoder().encode(JSON.stringify({owner:c.owner,repo:c.repo,branch:c.branch,tokenEnc},null,2)));
  let sha;
  try{const r=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/config.json?ref=${encodeURIComponent(c.branch)}`);if(r.ok)sha=(await r.json()).sha}catch{}
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

/* ---------- upload ---------- */
async function uploadOneFile(file,categories){
  const c=cfg(),now=new Date(),date=$("#dateInput").value||now.toISOString().slice(0,10);
  if(file.size>100*1024*1024)throw Error(`${file.name}: acima de 100 MB. GitHub bloqueia arquivos maiores no Git normal.`);
  const clean=file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w.\- ]+/g,"").trim().replace(/\s+/g,"-")||`arquivo-${Date.now()}`;
  const path=`media/${date.slice(0,4)}/${date.slice(5,7)}/${date}/${Date.now()}-${clean}.enc`;
  const raw=await file.arrayBuffer();
  let exif=null;
  if(file.type==="image/jpeg")exif=parseExif(raw);
  const {cipher,iv}=await encryptBuffer(raw);
  const encoded=b64(cipher);
  const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,{method:"PUT",body:JSON.stringify({message:`album: adicionar ${clean}`,content:encoded,branch:c.branch})});
  if(!res.ok)throw Error(`${file.name}: ${(await res.json()).message||"falha no upload"}`);
  const resJson=await res.json();
  state.items.push({name:file.name,path,date:(exif&&exif.takenAt)||date,takenAt:exif&&exif.takenAt||null,
    lat:exif&&exif.lat||null,lon:exif&&exif.lon||null,type:file.type,bytes:file.size,iv,sha:resJson.content.sha,
    uploadedAt:new Date().toISOString(),uploadedBy:currentUser(),categories:categories||[],caption:""});
  state.items.sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.uploadedAt||"").localeCompare(a.uploadedAt||""));
}
async function doUpload(files,categories){
  const arr=[...files];if(!arr.length)return;
  $("#uploadProgress").classList.remove("hidden");
  try{
    for(let i=0;i<arr.length;i++){
      const pct=Math.round((i/arr.length)*100);
      $("#uploadProgressBar").style.width=pct+"%";
      $("#uploadProgressLabel").textContent=`Enviando ${i+1}/${arr.length}: ${arr[i].name}`;
      await uploadOneFile(arr[i],categories);
    }
    $("#uploadProgressBar").style.width="100%";
    await putGallery();
    logEvent("upload",currentUser(),`${arr.length} arquivo(s)${categories&&categories.length?" em "+categories.join(", "):""}`);
    toast("Upload concluído.");
    render();
  }catch(e){toast(e.message)}
  finally{$("#uploadProgress").classList.add("hidden");$("#uploadProgressBar").style.width="0%";$("#fileInput").value="";state.pendingFiles=null}
}
function uploadFiles(files){
  if(!requireLogin())return;
  if(!cfg()){toast("Configure o GitHub primeiro.");$("#settings").classList.remove("hidden");return}
  const arr=[...files];if(!arr.length)return;
  state.pendingFiles=arr;
  openCategoryModal("upload",null);
}

/* ---------- modo seleção ---------- */
function enterSelectMode(){state.selectMode=true;state.selected.clear();$("#selectModeBtn").classList.add("active");renderGallery();updateSelectionBar()}
function exitSelectMode(){state.selectMode=false;state.selected.clear();$("#selectModeBtn").classList.remove("active");renderGallery();updateSelectionBar()}

/* ---------- PWA ---------- */
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))}
window.addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();state.deferredInstall=e;$("#installBtn").classList.remove("hidden")});
$("#installBtn").onclick=async()=>{if(!state.deferredInstall)return;state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;$("#installBtn").classList.add("hidden")};

/* ---------- link público de compartilhamento (?s=id) ---------- */
async function tryShareView(){
  const id=new URLSearchParams(location.search).get("s");
  if(!id)return false;
  document.body.innerHTML="";
  document.body.appendChild(Object.assign(document.createElement("div"),{className:"bg"}));
  const modal=document.createElement("div");modal.className="modal";modal.id="shareView";
  modal.innerHTML=`<div class="viewer-content" id="shareViewContent">Carregando…</div><div class="viewer-caption" id="shareViewCaption"></div>`;
  document.body.appendChild(modal);
  const toastEl=document.createElement("div");toastEl.className="toast";toastEl.id="toast";document.body.appendChild(toastEl);
  try{
    const listUrl=`https://api.github.com/repos/${DEFAULT_OWNER}/${DEFAULT_REPO}/contents/shares.json?ref=${DEFAULT_BRANCH}`;
    const lr=await fetch(listUrl);
    if(!lr.ok)throw Error("não foi possível carregar.");
    const lx=await lr.json();
    const list=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(lx.content.replace(/\n/g,"")),ch=>ch.charCodeAt(0))));
    const entry=list.find(s=>s.id===id);
    if(!entry||entry.expiresAt<Date.now()){$("#shareViewContent").textContent="Este link expirou ou não existe mais.";return true}
    const br=await fetch(`https://api.github.com/repos/${DEFAULT_OWNER}/${DEFAULT_REPO}/git/blobs/${entry.sha}`);
    if(!br.ok)throw Error("falha ao baixar.");
    const blob=await br.json();
    const cipherBuf=Uint8Array.from(atob(blob.content.replace(/\n/g,"")),ch=>ch.charCodeAt(0)).buffer;
    const plainBuf=await decryptBuffer(cipherBuf,entry.iv);
    const url=URL.createObjectURL(new Blob([plainBuf],{type:guessMime(entry.name,entry.type)}));
    $("#shareViewContent").innerHTML=entry.type.startsWith("video")?`<video src="${url}" controls autoplay playsinline></video>`:`<img src="${url}" alt="">`;
    $("#shareViewCaption").textContent=entry.caption||entry.name;
  }catch(e){$("#shareViewContent").textContent="Não foi possível abrir este link."}
  return true;
}

/* ---------- eventos ---------- */
async function init(){
  if(await tryShareView())return;

  $("#loginBtn").onclick=()=>{if(doLogin($("#loginPassword").value))readConfig()};
  $("#loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter"&&doLogin($("#loginPassword").value))readConfig()});

  $("#menuBtn").onclick=(e)=>{e.stopPropagation();$("#menuDropdown").classList.toggle("hidden")};
  $("#settingsBtn").onclick=(e)=>{e.stopPropagation();$("#menuDropdown").classList.add("hidden");$("#settings").classList.remove("hidden")};
  $("#settingsClose").onclick=()=>$("#settings").classList.add("hidden");
  $("#logoutBtn").onclick=(e)=>{e.stopPropagation();$("#menuDropdown").classList.add("hidden");sessionStorage.removeItem("albumUser");state.user=null;location.reload()};
  document.addEventListener("click",(e)=>{if(!e.target.closest(".menu-wrap")){$("#menuDropdown").classList.add("hidden");$("#viewerMenuDropdown")?.classList.add("hidden")}});

  $("#saveSettings").onclick=async()=>{
    const token=$("#token").value.trim();
    if(!token)return toast("Cole o token.");
    const c={owner:DEFAULT_OWNER,repo:DEFAULT_REPO,branch:DEFAULT_BRANCH,token};
    state.config=c;
    try{await writeConfigFile(c);saveCfg(c);$("#settings").classList.add("hidden");toast("Configuração salva. Não vai pedir de novo.");await loadGallery()}
    catch(e){toast(e.message)}
  };

  $("#uploadBtn").onclick=()=>{if(!requireLogin())return;$("#fileInput").click()};
  $("#fileInput").onchange=e=>uploadFiles(e.target.files);

  $("#searchInput").oninput=apply;
  $("#dateInput").onchange=apply;
  $("#dateMode").onchange=()=>{state.dateMode=$("#dateMode").value;apply()};
  $("#categorySelect").onchange=()=>{state.catFilter=$("#categorySelect").value;apply()};
  $("#locOnlyChk").onchange=()=>{state.locOnly=$("#locOnlyChk").checked;apply()};
  $("#clearBtn").onclick=()=>{$("#searchInput").value="";$("#dateInput").value="";$("#categorySelect").value="";$("#locOnlyChk").checked=false;state.catFilter="";state.locOnly=false;state.uploaderWho="";$("#uploaderFilter").querySelectorAll(".filter-btn").forEach((b,i)=>b.classList.toggle("active",i===0));apply()};
  $("#todayBtn").onclick=()=>{$("#dateInput").value=new Date().toISOString().slice(0,10);apply()};
  $("#filtersBtn").onclick=()=>$("#filtersPanel").classList.toggle("hidden");
  $("#loadMore").onclick=()=>{state.page++;renderGallery()};
  $("#uploaderFilter").querySelectorAll(".filter-btn").forEach(b=>b.onclick=()=>{
    $("#uploaderFilter").querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");state.uploaderWho=b.dataset.who;apply();
  });

  $("#selectModeBtn").onclick=()=>{if(!requireLogin())return;state.selectMode?exitSelectMode():enterSelectMode()};
  $("#selCancel").onclick=exitSelectMode;
  $("#selDelete").onclick=bulkDelete;
  $("#selCategorize").onclick=()=>openCategoryModal("bulk",null);

  $("#viewerClose").onclick=()=>{$("#viewer").classList.add("hidden");$("#viewerContent").innerHTML=""};
  $("#prevBtn").onclick=()=>move(-1);$("#nextBtn").onclick=()=>move(1);
  $("#viewerMenuBtn").onclick=(e)=>{e.stopPropagation();$("#viewerMenuDropdown").classList.toggle("hidden")};
  $("#viewerDownload").onclick=()=>{$("#viewerMenuDropdown").classList.add("hidden");downloadItem(curItem())};
  $("#viewerDelete").onclick=()=>{$("#viewerMenuDropdown").classList.add("hidden");deleteItem(curItem())};
  $("#viewerCaptionBtn").onclick=()=>{$("#viewerMenuDropdown").classList.add("hidden");openCaptionModal(curItem())};
  $("#viewerCategoryBtn").onclick=()=>{$("#viewerMenuDropdown").classList.add("hidden");openCategoryModal("single",curItem())};
  $("#viewerShareBtn").onclick=()=>{$("#viewerMenuDropdown").classList.add("hidden");openShareModal(curItem())};
  $("#viewerInfoBtn").onclick=()=>{$("#viewerMenuDropdown").classList.add("hidden");openInfoModal(curItem())};

  $("#captionClose").onclick=()=>$("#captionModal").classList.add("hidden");
  $("#captionSave").onclick=saveCaption;

  $("#categoryClose").onclick=()=>{$("#categoryModal").classList.add("hidden");if(state.categoryModalMode==="upload")doUpload(state.pendingFiles,[])};
  $("#newCategoryAdd").onclick=addNewCategory;
  $("#categorySave").onclick=applyCategoryModal;

  $("#shareClose").onclick=()=>$("#shareModal").classList.add("hidden");
  $("#shareCreate").onclick=createShare;

  $("#infoClose").onclick=()=>$("#infoModal").classList.add("hidden");

  document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const view=btn.dataset.view;
    $("#mainView").classList.toggle("hidden",view!=="mainView");
    $("#historyView").classList.toggle("hidden",view!=="historyView");
    $("#uploadBtn").classList.toggle("hidden",view!=="mainView");
    if(view==="historyView")loadHistory();
  });

  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){$("#viewer").classList.add("hidden");$("#settings").classList.add("hidden")}
    if(!$("#viewer").classList.contains("hidden")){if(e.key==="ArrowLeft")move(-1);if(e.key==="ArrowRight")move(1)}
  });

  if(requireLogin())await readConfig();
}
init();
