(() => {
  const $ = (s) => document.querySelector(s);
  const allowed = new Set(["video/mp4","video/quicktime","video/webm","video/x-matroska","video/ogg"]);
  const esc = (v) => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const bytes = (n) => { if (!n) return "—"; const u=["B","KB","MB","GB"]; const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3); return (n/1024**i).toFixed(i?1:0)+" "+u[i]; };
  function ensurePanel() {
    if ($("#sources-workspace")) return;
    const panel=document.createElement("section");
    panel.id="sources-workspace"; panel.className="sources-workspace hidden";
    panel.innerHTML='<div class="source-upload-panel"><div class="upload-symbol">↑</div><div class="upload-copy"><h2>Add a source video</h2><p>Upload an MP4, MOV, WebM or MKV file. Your original is stored privately in your ShortsFlow R2 bucket.</p><small>Current upload limit: 90 MB per file</small></div><button class="primary-button" id="choose-source-btn">Choose video</button></div><div class="upload-progress hidden" id="upload-progress"><div class="progress-heading"><strong id="upload-filename">Uploading video</strong><span id="upload-percent">0%</span></div><div class="progress-track"><i id="upload-progress-bar"></i></div><p id="upload-status">Preparing secure upload…</p></div><div class="sources-list-panel"><div class="panel-heading"><div><h3>Your source videos</h3><p>Private originals saved to your workspace.</p></div><button class="text-button" id="refresh-sources-btn">Refresh</button></div><div id="sources-list" class="sources-list"></div></div>';
    $(".page-heading").after(panel);
    $("#choose-source-btn").addEventListener("click",()=>$("#source-file").click());
    $("#refresh-sources-btn").addEventListener("click",load);
  }
  async function load() {
    const list=$("#sources-list"); if(!list) return;
    list.innerHTML='<div class="sources-empty"><b>Loading source videos…</b></div>';
    try {
      const r=await fetch("/api/sources",{headers:{accept:"application/json"}});
      const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||"Could not load sources.");
      if(!d.sources.length){list.innerHTML='<div class="sources-empty"><b>No source videos yet</b><p>Upload your first video to start building your Shorts library.</p></div>';return;}
      list.innerHTML=d.sources.map(s=>'<article class="source-row"><div class="source-file-icon">▶</div><div class="source-file-info"><strong>'+esc(s.title)+'</strong><small>'+bytes(s.sizeBytes)+' · '+esc(s.mimeType||"video")+' · '+esc(new Date(s.createdAt).toLocaleString())+'</small></div><span class="source-status">'+esc(s.status)+'</span></article>').join("");
    } catch(e){list.innerHTML='<div class="sources-empty error"><b>Could not load sources</b><p>'+esc(e.message)+'</p></div>';}
  }
  function upload(file) {
    if(!allowed.has(file.type)){alert("Unsupported format. Use MP4, MOV, WebM, MKV or OGG.");return;}
    if(file.size>90*1024*1024){alert("This upload currently supports files up to 90 MB.");return;}
    const box=$("#upload-progress"),bar=$("#upload-progress-bar"),pct=$("#upload-percent"),status=$("#upload-status");
    box.classList.remove("hidden");$("#upload-filename").textContent=file.name;bar.style.width="0%";pct.textContent="0%";status.textContent="Uploading securely to private R2 storage…";status.classList.remove("error-text");
    const xhr=new XMLHttpRequest();xhr.open("POST","/api/sources/upload");xhr.setRequestHeader("Content-Type",file.type);xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name));
    xhr.upload.onprogress=e=>{if(!e.lengthComputable)return;const p=Math.round(e.loaded/e.total*100);bar.style.width=p+"%";pct.textContent=p+"%";status.textContent=p===100?"Saving video record…":"Uploading · "+bytes(e.loaded)+" of "+bytes(e.total);};
    xhr.onload=async()=>{let d={};try{d=JSON.parse(xhr.responseText);}catch{}if(xhr.status<200||xhr.status>=300||!d.ok){status.textContent=d.error||"Upload failed.";status.classList.add("error-text");return;}bar.style.width="100%";pct.textContent="100%";status.textContent="Saved to private storage.";await load();fetch("/api/workspace/summary").then(r=>r.json()).then(d=>{if(d.ok&&d.stats)$("#stat-sources").textContent=d.stats.sources;}).catch(()=>{});};
    xhr.onerror=()=>{status.textContent="Network error. Upload status is unknown; refresh the source list before retrying.";status.classList.add("error-text");};xhr.send(file);
  }
  document.addEventListener("DOMContentLoaded",()=>{
    ensurePanel();
    const input=$("#source-file");
    input.addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];if(f)upload(f);e.target.value="";});
    document.querySelectorAll('[data-view="sources"]').forEach(b=>b.addEventListener("click",()=>{ensurePanel();$("#sources-workspace").classList.remove("hidden");$(".welcome-panel").classList.add("hidden");$(".section-head").classList.add("hidden");$(".stats-grid").classList.add("hidden");$(".lower-grid").classList.add("hidden");load();}));
    ["#add-source-btn","#start-workflow"].forEach(sel=>$(sel)?.addEventListener("click",()=>{ensurePanel();$("#sources-workspace").classList.remove("hidden");$(".welcome-panel").classList.add("hidden");$(".section-head").classList.add("hidden");$(".stats-grid").classList.add("hidden");$(".lower-grid").classList.add("hidden");load();}));
  });
})();