(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
  const time = value => {
    const seconds=Math.max(0,Math.floor(Number(value)||0));
    return Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");
  };

  function ensurePanel() {
    if ($("#clips-workspace")) return;
    const panel=document.createElement("section");
    panel.id="clips-workspace";
    panel.className="clips-workspace hidden";
    panel.innerHTML='<div class="clips-toolbar"><div><strong id="clips-total">0 candidates</strong><p>AI-ranked moments from your source videos. Nothing is rendered or published yet.</p></div><button type="button" class="text-button" id="refresh-clips-btn">Refresh</button></div><div id="clips-list" class="clips-list"></div>';
    $(".page-heading").after(panel);
    $("#refresh-clips-btn").addEventListener("click",load);
  }

  async function load() {
    const list=$("#clips-list");
    if(!list)return;
    list.innerHTML='<div class="sources-empty"><b>Loading clip candidates…</b></div>';
    try {
      const response=await fetch("/api/clips",{headers:{accept:"application/json"}});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||"Could not load clip candidates.");
      const clips=Array.isArray(data.clips)?data.clips:[];
      $("#clips-total").textContent=clips.length+" candidate"+(clips.length===1?"":"s");
      if(!clips.length) {
        list.innerHTML='<div class="sources-empty"><b>No clip candidates yet</b><p>Upload an MP4 source and queue analysis. After transcription, ShortsFlow will automatically identify and rank potential clips here.</p></div>';
        return;
      }
      list.innerHTML=clips.map((clip,index)=>{
        const score=Math.max(0,Math.min(100,Math.round(Number(clip.score)||0)));
        return '<article class="clip-candidate"><div class="clip-rank">#'+(index+1)+'</div><div class="clip-main"><div class="clip-title-row"><div><strong>'+esc(clip.title||"Untitled moment")+'</strong><small>'+esc(clip.sourceTitle||"Source video")+'</small></div><span class="clip-score">'+score+'<small>/100</small></span></div><p class="clip-hook">'+esc(clip.hook||"")+'</p><p class="clip-transcript">'+esc(clip.transcript||"")+'</p><div class="clip-meta"><span>'+time(clip.startSeconds)+' – '+time(clip.endSeconds)+'</span><span>'+Math.round(Number(clip.durationSeconds)||0)+' sec</span><span>'+esc(clip.status||"discovered")+'</span></div>'+(clip.caption?'<p class="clip-caption">'+esc(clip.caption)+'</p>':'')+(clip.hashtags?'<small class="clip-hashtags">'+esc(clip.hashtags)+'</small>':'')+'</div></article>';
      }).join("");
    } catch(error) {
      list.innerHTML='<div class="sources-empty error"><b>Could not load clip candidates</b><p>'+esc(error.message)+'</p></div>';
    }
  }

  document.addEventListener("DOMContentLoaded",()=>{
    ensurePanel();
    document.addEventListener("shortsflow:view",event=>{
      if(event.detail?.view!=="clips")return;
      ensurePanel();
      $("#clips-workspace").classList.remove("hidden");
      load();
    });
    window.setInterval(()=>{
      const panel=$("#clips-workspace");
      if(panel&&!panel.classList.contains("hidden"))load();
    },20000);
  });
})();
