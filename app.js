const $=s=>document.querySelector(s);
const state={items:[],filtered:[],page:0,pageSize:60,current:0,config:null};

function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.add("show");clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.remove("show"),2800)}
function cfg(){return state.config||JSON.parse(sessionStorage.getItem("albumConfig")||"null")}
function saveCfg(c){state.config=c;sessionStorage.setItem("albumConfig",JSON.stringify(c))}
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
  const q=$("#searchInput").value.trim().toLowerCase(),d=$("#dateInput").value;
  state.filtered=state.items.filter(x=>(!d||x.date===d)&&(!q||x.name.toLowerCase().includes(q)||x.date.includes(q)||niceDate(x.date).toLowerCase().includes(q)));
  state.page=1;renderGallery();
}
function render(){
  $("#totalCount").textContent=state.items.length;
  apply();buildTimeline();
}
function buildTimeline(){
  const groups=[...new Set(state.items.map(x=>x.date.slice(0,7)))];
  $("#timelineNav").innerHTML=groups.map(m=>`<button data-month="${m}">${new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(m+"-01T12:00:00"))}</button>`).join("");
  $("#timelineNav").querySelectorAll("button").forEach(b=>b.onclick=()=>{$("#searchInput").value="";$("#dateInput").value="";state.filtered=state.items.filter(x=>x.date.startsWith(b.dataset.month));state.page=1;renderGallery()});
}
function renderGallery(){
  const shown=state.filtered.slice(0,state.page*state.pageSize);
  $("#gallery").innerHTML="";
  if(!shown.length){$("#empty").classList.remove("hidden");$("#loadMore").classList.add("hidden");return}
  $("#empty").classList.add("hidden");
  let last="";
  shown.forEach((x,i)=>{
    if(x.date!==last){const d=document.createElement("div");d.className="day";d.innerHTML=`<h3>${niceDate(x.date)}</h3><small>${state.filtered.filter(y=>y.date===x.date).length} item(ns)</small>`;$("#gallery").appendChild(d);last=x.date}
    const card=document.createElement("article");card.className="card";
    const media=x.type.startsWith("video")?`<video src="${rawUrl(x.path)}" muted preload="metadata" playsinline></video>`:`<img src="${rawUrl(x.path)}" loading="lazy" alt="">`;
    card.innerHTML=media+`<span class="type">${x.type.startsWith("video")?"▶ Vídeo":"▣ Foto"}</span><div class="name">${escapeHtml(x.name)}</div>`;
    card.onclick=()=>openViewer(shown.indexOf(x),shown);$("#gallery").appendChild(card);
  });
  $("#loadMore").classList.toggle("hidden",shown.length>=state.filtered.length);
}
function openViewer(i,list){state.viewerList=list;state.current=i;$("#viewer").classList.remove("hidden");showViewer()}
function showViewer(){
  const x=state.viewerList[state.current],u=rawUrl(x.path);
  $("#viewerContent").innerHTML=x.type.startsWith("video")?`<video src="${u}" controls autoplay playsinline></video>`:`<img src="${u}" alt="">`;
  $("#viewerCaption").textContent=`${x.name} • ${niceDate(x.date)}`;
}
function move(n){state.current=(state.current+n+state.viewerList.length)%state.viewerList.length;showViewer()}

async function readConfig(){
  try{state.config=JSON.parse(sessionStorage.getItem("albumConfig")||"null")}catch{}
  if(state.config)await loadGallery();else $("#settings").classList.remove("hidden");
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
  const path=`media/${date.slice(0,4)}/${date.slice(5,7)}/${date}/${Date.now()}-${clean}`;
  const r=await file.arrayBuffer(),encoded=b64(r);
  const res=await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,{method:"PUT",body:JSON.stringify({message:`album: adicionar ${clean}`,content:encoded,branch:c.branch})});
  if(!res.ok)throw Error(`${file.name}: ${(await res.json()).message||"falha no upload"}`);
  state.items.push({name:file.name,path,date,type:file.type,bytes:file.size,uploadedAt:new Date().toISOString()});
  state.items.sort((a,b)=>b.date.localeCompare(a.date)||b.uploadedAt.localeCompare(a.uploadedAt));
}
async function uploadFiles(files){
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

$("#settingsBtn").onclick=()=>{$("#settings").classList.remove("hidden");const c=cfg();if(c){$("#owner").value=c.owner;$("#repo").value=c.repo;$("#branch").value=c.branch}}
$("#settingsClose").onclick=()=>$("#settings").classList.add("hidden");
$("#saveSettings").onclick=async()=>{
  const c={owner:$("#owner").value.trim(),repo:$("#repo").value.trim(),branch:$("#branch").value.trim()||"main",token:$("#token").value.trim()};
  if(!c.owner||!c.repo||!c.token)return toast("Preencha usuário, repositório e token.");
  saveCfg(c);$("#settings").classList.add("hidden");await loadGallery();
};
$("#uploadBtn").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=e=>uploadFiles(e.target.files);
$("#searchInput").oninput=apply;
$("#dateInput").onchange=apply;
$("#clearBtn").onclick=()=>{$("#searchInput").value="";$("#dateInput").value="";apply()};
$("#todayBtn").onclick=()=>{$("#dateInput").value=new Date().toISOString().slice(0,10);apply()};
$("#loadMore").onclick=()=>{state.page++;renderGallery()};
$("#viewerClose").onclick=()=>{$("#viewer").classList.add("hidden");$("#viewerContent").innerHTML=""};
$("#prevBtn").onclick=()=>move(-1);$("#nextBtn").onclick=()=>move(1);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("#viewer").classList.add("hidden");$("#settings").classList.add("hidden")}if(!$("#viewer").classList.contains("hidden")){if(e.key==="ArrowLeft")move(-1);if(e.key==="ArrowRight")move(1)}});

readConfig();
