(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtBytes = value => { const n=Number(value)||0; return n>=1024*1024?(n/1024/1024).toFixed(1)+" MB":(n/1024).toFixed(0)+" KB"; };
  const fmtDate = value => { const d=new Date(value); return Number.isNaN(d.getTime())?"—":d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"}); };
  const time = value => { const n=Math.max(0,Math.floor(Number(value)||0)); return Math.floor(n/60)+":"+String(n%60).padStart(2,"0"); };
  let loaded=false, loading=false, assets=[];
  function ensurePanel(){
    if($("#library-workspace"))return;
    const panel=document.createElement("section");
    panel.id="library-workspace";panel.className="library-workspace hidden";
    panel.innerHTML=`
      <section class="library-hero">
        <div><span class="library-kicker">YOUR RENDER ARCHIVE</span><h2>Every finished cut,<br><em>in one place.</em></h2><p>Preview, download and revisit previous render versions. Editing a clip never deletes its earlier exports.</p></div>
        <div class="library-hero-stat"><strong id="library-count">0</strong><span>RENDERED FILES</span><small>Stored privately in your workspace</small></div>
      </section>
      <div class="library-toolbar"><div><span class="library-kicker">CONTENT LIBRARY</span><h3>Rendered videos</h3><p id="library-summary">Your saved video exports will appear here.</p></div><button class="text-button" id="library-refresh">↻ Refresh</button></div>
      <div class="library-filters" role="group" aria-label="Filter rendered videos"><button class="library-filter active" data-filter="all">All renders</button><button class="library-filter" data-filter="current">Current version</button><button class="library-filter" data-filter="outdated">Previous versions</button></div>
      <div id="library-grid" class="library-grid"><div class="library-empty"><div class="empty-icon">▧</div><b>Loading your library…</b><p>Checking your saved renders.</p></div></div>`;
    $(".page-content")?.append(panel);
    $("#library-refresh")?.addEventListener("click",()=>load(true));
    panel.querySelectorAll("[data-filter]").forEach(btn=>btn.addEventListener("click",()=>{
      panel.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("active",b===btn));
      render(btn.dataset.filter);
    }));
  }
  function render(filter="all"){
    const grid=$("#library-grid");if(!grid)return;
    const list=assets.filter(a=>filter==="all"||(filter==="current"&&a.isCurrent)||(filter==="outdated"&&!a.isCurrent));
    $("#library-count").textContent=String(assets.length);
    $("#library-summary").textContent=assets.length?assets.length+" saved render"+(assets.length===1?"":"s")+" · "+assets.filter(a=>a.isCurrent).length+" current":"No rendered videos yet";
    if(!list.length){
      const title=assets.length?"Nothing in this filter":"Your library is ready for its first render";
      const desc=assets.length?"Try another version filter.":"Render a clip from Clip Discovery to see the finished video here. Your files are stored privately.";
      grid.innerHTML=`<div class="library-empty"><div class="empty-icon">▧</div><b>${title}</b><p>${desc}</p><button class="secondary-button" id="library-go-clips">Go to Clip Discovery <span>→</span></button></div>`;
      $("#library-go-clips")?.addEventListener("click",()=>document.querySelector('.nav-item[data-view="clips"]')?.click());
      return;
    }
    grid.innerHTML=list.map(a=>`
      <article class="library-card">
        <div class="library-video-wrap">
          <video class="library-video" controls preload="none" playsinline src="${esc(a.previewUrl)}"></video>
          <span class="library-format">WEBM · 9:16</span>
          <span class="library-state ${a.isCurrent?"is-current":"is-old"}">${a.isCurrent?"CURRENT":"PREVIOUS VERSION"}</span>
        </div>
        <div class="library-card-body">
          <div class="library-card-top"><span class="library-version">RENDER V${a.version}</span><span class="library-size">${fmtBytes(a.sizeBytes)}</span></div>
          <h4>${esc(a.title)}</h4><p class="library-source">${esc(a.sourceTitle)} · ${time(a.startSeconds)}–${time(a.endSeconds)} · ${Math.round(a.durationSeconds)} sec</p>
          <div class="library-card-meta"><span>Saved ${esc(fmtDate(a.createdAt))}</span><span>Settings v${a.metadataVersion}</span></div>
          ${!a.isCurrent?'<p class="library-outdated-note">This export uses an older edit. It remains available in your history.</p>':""}
          <div class="library-actions"><a class="secondary-button" href="${esc(a.previewUrl)}" target="_blank" rel="noopener">Open video ↗</a><a class="primary-button library-download" href="${esc(a.downloadUrl)}">↓ Download</a></div>
        </div>
      </article>`).join("");
  }
  async function load(force=false){
    ensurePanel();if(loading)return;loading=true;
    const grid=$("#library-grid");
    if(!loaded||force)grid.innerHTML='<div class="library-empty"><div class="empty-icon">◌</div><b>Refreshing library…</b><p>Loading your private render archive.</p></div>';
    try{
      const response=await fetch("/api/library",{headers:{accept:"application/json"}});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||"Could not load the content library.");
      assets=Array.isArray(data.assets)?data.assets:[];
      loaded=true;
      const active=document.querySelector(".library-filter.active")?.dataset.filter||"all";
      render(active);
    }catch(error){
      grid.innerHTML=`<div class="library-empty"><div class="empty-icon">!</div><b>Library couldn't load</b><p>${esc(error.message||"Please try again.")}</p><button class="secondary-button" id="library-retry">Try again</button></div>`;
      $("#library-retry")?.addEventListener("click",()=>load(true));
    }finally{loading=false;}
  }
  document.addEventListener("shortsflow:view",event=>{
    if(event.detail?.view==="library"){ensurePanel();$("#library-workspace").classList.remove("hidden");load();}
    else $("#library-workspace")?.classList.add("hidden");
  });
  ensurePanel();
})();