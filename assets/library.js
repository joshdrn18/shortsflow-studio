(() => {
  const $ = selector => document.querySelector(selector);
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
        <div><span class="library-kicker">YOUR CONTENT FACTORY</span><h2>Finished videos,<br><em>ready to publish.</em></h2><p>Every finished Short is saved with its title, description, hashtags, tags and source references. Preview, download or copy the complete post package—nothing uploads automatically.</p></div>
        <div class="library-hero-stat"><strong id="library-count">0</strong><span>FINISHED VIDEOS</span><small>Stored privately in your workspace</small></div>
      </section>
      <div class="library-toolbar"><div><span class="library-kicker">CONTENT LIBRARY</span><h3>Videos & publish packages</h3><p id="library-summary">Your finished AI content will appear here.</p></div><button class="text-button" id="library-refresh">↻ Refresh</button></div>
      <div class="library-filters" role="group" aria-label="Filter rendered videos"><button class="library-filter active" data-filter="all">All videos</button><button class="library-filter" data-filter="current">Current version</button><button class="library-filter" data-filter="outdated">Previous versions</button></div>
      <div id="library-grid" class="library-grid"><div class="library-empty"><div class="empty-icon">▧</div><b>Loading your content…</b><p>Checking your private content library.</p></div></div>`;
    $(".page-content")?.append(panel);
    $("#library-refresh")?.addEventListener("click",()=>load(true));
    panel.querySelectorAll("[data-filter]").forEach(btn=>btn.addEventListener("click",()=>{
      panel.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("active",b===btn));
      render(btn.dataset.filter);
    }));
    panel.addEventListener("click",async event=>{
      const button=event.target.closest("[data-copy-kind]");
      if(!button)return;
      const item=assets.find(asset=>asset.id===button.dataset.asset);
      if(!item)return;
      const kind=button.dataset.copyKind;
      const refs=(item.sourceReferences||[]).map(source=>(source.publisher?source.publisher+": ":"")+(source.url||"")).filter(Boolean);
      const value=kind==="title"?item.title:
        kind==="hook"?item.hook:
        kind==="script"?item.spokenScript:
        kind==="description"?item.platformDescription:
        kind==="tags"?(item.platformTags||[]).join(", "):
        kind==="hashtags"?item.hashtags:
        ["HOOK",item.hook||"","", "VOICE SCRIPT",item.spokenScript||"","", "TITLE",item.title,"","DESCRIPTION",item.platformDescription,"","TAGS",(item.platformTags||[]).join(", "),"","HASHTAGS",item.hashtags||"","", "SOURCES",refs.join("\n")].join("\n");
      if(!value){button.textContent="Nothing to copy";return;}
      try{
        if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
        else{
          const area=document.createElement("textarea");area.value=value;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();
          const ok=document.execCommand("copy");area.remove();if(!ok)throw new Error("Clipboard access is unavailable.");
        }
        const original=button.textContent;button.textContent="Copied ✓";button.classList.add("is-copied");
        window.setTimeout(()=>{button.textContent=original;button.classList.remove("is-copied");},1500);
      }catch(error){button.textContent="Copy unavailable";window.setTimeout(()=>{button.textContent="Copy";},1800);}
    });
  }
  function render(filter="all"){
    const grid=$("#library-grid");if(!grid)return;
    const list=assets.filter(a=>filter==="all"||(filter==="current"&&a.isCurrent)||(filter==="outdated"&&!a.isCurrent));
    $("#library-count").textContent=String(assets.length);
    $("#library-summary").textContent=assets.length?assets.length+" saved video"+(assets.length===1?"":"s")+" · "+assets.filter(a=>a.isCurrent).length+" current · "+assets.filter(a=>a.isPublishReady).length+" publish-ready packages":"No finished videos yet";
    if(!list.length){
      const title=assets.length?"Nothing in this filter":"Your content factory is ready";
      const desc=assets.length?"Try another version filter.":"When the AI finishes a Short, the MP4 and its publish metadata will appear here. No YouTube upload is started.";
      grid.innerHTML=`<div class="library-empty"><div class="empty-icon">▧</div><b>${title}</b><p>${desc}</p></div>`;
      return;
    }
    grid.innerHTML=list.map(a=>{
      const refs=(a.sourceReferences||[]).filter(source=>/^https?:\/\//i.test(source.url||""));
      const tags=Array.isArray(a.platformTags)?a.platformTags:[];
      const packageHtml=a.isPublishReady?`
        <section class="library-package">
          <div class="library-package-head"><div><span class="library-kicker">POST PACKAGE</span><b>Ready to publish</b><small>Voice: ${esc(String(a.voiceLanguage||"en").toUpperCase())} · Subtitles: ${esc(String(a.subtitleConfig?.subtitleLanguage||"id").toUpperCase())}</small></div><button class="secondary-button" data-copy-kind="all" data-asset="${esc(a.id)}">Copy all content & metadata</button></div>
          ${a.hook?`<div class="library-package-field"><div><b>Opening hook</b><button class="library-copy-button" data-copy-kind="hook" data-asset="${esc(a.id)}">Copy</button></div><p>${esc(a.hook)}</p></div>`:""}
          ${a.spokenScript?`<div class="library-package-field"><div><b>Voice script</b><button class="library-copy-button" data-copy-kind="script" data-asset="${esc(a.id)}">Copy</button></div><p class="library-package-prewrap">${esc(a.spokenScript)}</p></div>`:""}
          <div class="library-package-field"><div><b>YouTube title</b><button class="library-copy-button" data-copy-kind="title" data-asset="${esc(a.id)}">Copy</button></div><p>${esc(a.title)}</p></div>
          <div class="library-package-field"><div><b>Description</b><button class="library-copy-button" data-copy-kind="description" data-asset="${esc(a.id)}">Copy</button></div><p class="library-package-prewrap">${esc(a.platformDescription)}</p></div>
          <div class="library-package-field"><div><b>Tags</b><button class="library-copy-button" data-copy-kind="tags" data-asset="${esc(a.id)}">Copy</button></div><p>${esc(tags.join(", ")||"No tags generated")}</p></div>
          <div class="library-package-field"><div><b>Hashtags</b><button class="library-copy-button" data-copy-kind="hashtags" data-asset="${esc(a.id)}">Copy</button></div><p>${esc(a.hashtags||"No hashtags generated")}</p></div>
          ${refs.length?`<div class="library-package-sources"><b>Research sources</b>${refs.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.publisher||source.title||"Open source")} ↗</a>`).join("")}</div>`:""}
        </section>`:"";
      return `
      <article class="library-card">
        <div class="library-video-wrap">
          <video class="library-video" controls preload="none" playsinline src="${esc(a.previewUrl)}"></video>
          <span class="library-format">${String(a.mimeType||"").includes("mp4")?"MP4":"WEBM"} · 9:16</span>
          <span class="library-state ${a.isPublishReady?"is-ready":a.isCurrent?"is-current":"is-old"}">${a.isPublishReady?"READY TO PUBLISH":a.isCurrent?"CURRENT":"PREVIOUS VERSION"}</span>
        </div>
        <div class="library-card-body">
          <div class="library-card-top"><span class="library-version">RENDER V${a.version}</span><span class="library-size">${fmtBytes(a.sizeBytes)}</span></div>
          <h4>${esc(a.title)}</h4><p class="library-source">${esc(a.sourceTitle)} · ${time(a.startSeconds)}–${time(a.endSeconds)} · ${Math.round(a.durationSeconds)} sec</p>
          <div class="library-card-meta"><span>Saved ${esc(fmtDate(a.createdAt))}</span><span>Settings v${a.metadataVersion}</span></div>
          ${!a.isCurrent?'<p class="library-outdated-note">This export uses an older edit. It remains available in your history.</p>':""}
          ${packageHtml}
          <div class="library-actions"><a class="secondary-button" href="${esc(a.previewUrl)}" target="_blank" rel="noopener">Open video ↗</a><a class="primary-button library-download" href="${esc(a.downloadUrl)}">↓ Download MP4</a></div>
        </div>
      </article>`;
    }).join("");
  }
  async function load(force=false){
    ensurePanel();if(loading)return;loading=true;
    const grid=$("#library-grid");
    if(!loaded||force)grid.innerHTML='<div class="library-empty"><div class="empty-icon">◌</div><b>Refreshing library…</b><p>Loading your private content archive.</p></div>';
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