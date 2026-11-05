(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
  const time = value => {
    const seconds=Math.max(0,Math.floor(Number(value)||0));
    return Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");
  };
  let activeClip=null;
  let clipStart=0;
  let clipEnd=0;
  let stopAtEnd=true;

  function ensurePanel() {
    if ($("#clips-workspace")) return;
    const panel=document.createElement("section");
    panel.id="clips-workspace";
    panel.className="clips-workspace hidden";
    panel.innerHTML='<div class="clips-toolbar"><div><strong id="clips-total">0 candidates</strong><p>AI-ranked moments from your source videos. Preview and fine-tune a cut before rendering.</p></div><button type="button" class="text-button" id="refresh-clips-btn">Refresh</button></div><div id="clips-list" class="clips-list"></div><dialog id="clip-preview-dialog" class="clip-preview-dialog"><div class="source-preview-head"><div><strong id="clip-preview-title">Clip preview</strong><small id="clip-preview-source">Private source preview</small></div><button type="button" class="text-button" id="clip-preview-close">Close ✕</button></div><video id="clip-preview-video" controls playsinline preload="metadata"></video><div class="clip-trim-controls"><label>Start (seconds)<input id="clip-start" type="number" min="0" step="0.1"></label><label>End (seconds)<input id="clip-end" type="number" min="0.1" step="0.1"></label><button type="button" class="primary-button" id="clip-play-btn">▶ Play cut</button></div><p id="clip-preview-message" role="status">Loading private source video…</p><small class="clip-preview-note">Preview adjustments are temporary. Rendering and saving edited cuts are not available yet.</small></dialog>';
    $(".page-heading").after(panel);
    $("#refresh-clips-btn").addEventListener("click",load);
    $("#clip-preview-close").addEventListener("click",closePreview);
    $("#clip-preview-dialog").addEventListener("click",event=>{if(event.target.id==="clip-preview-dialog")closePreview();});
    $("#clip-play-btn").addEventListener("click",playCut);
    $("#clip-start").addEventListener("change",updateTrim);
    $("#clip-end").addEventListener("change",updateTrim);
    $("#clip-preview-video").addEventListener("timeupdate",()=>{
      const video=$("#clip-preview-video");
      if(stopAtEnd&&activeClip&&video.currentTime>=clipEnd){video.pause();video.currentTime=clipEnd;}
    });
    $("#clip-preview-video").addEventListener("loadedmetadata",()=>{
      if(!activeClip)return;
      clipStart=Math.max(0,Math.min(clipStart,Math.max(0,$("#clip-preview-video").duration-0.1)));
      clipEnd=Math.min(clipEnd,$("#clip-preview-video").duration);
      if(clipEnd<=clipStart)clipEnd=Math.min($("#clip-preview-video").duration,clipStart+1);
      syncTrimInputs();
      $("#clip-preview-message").textContent="Ready · "+time(clipStart)+" to "+time(clipEnd)+" · "+(clipEnd-clipStart).toFixed(1)+" seconds";
    });
    $("#clip-preview-video").addEventListener("error",()=>{
      $("#clip-preview-message").textContent="Could not play this source. Check that the original video codec is supported by your browser.";
      $("#clip-preview-message").classList.add("error-text");
    });
  }

  function syncTrimInputs(){
    $("#clip-start").value=clipStart.toFixed(1);
    $("#clip-end").value=clipEnd.toFixed(1);
    $("#clip-start").max=Math.max(0,clipEnd-0.1).toFixed(1);
    $("#clip-end").min=(clipStart+0.1).toFixed(1);
  }
  function updateTrim(){
    const video=$("#clip-preview-video");
    const duration=Number(video.duration)||Number(activeClip?.sourceDuration)||Infinity;
    const nextStart=Number($("#clip-start").value);
    const nextEnd=Number($("#clip-end").value);
    if(!Number.isFinite(nextStart)||!Number.isFinite(nextEnd)||nextStart<0||nextEnd<=nextStart||nextEnd>duration){
      $("#clip-preview-message").textContent="Enter a valid start and end within the source video.";
      syncTrimInputs();
      return;
    }
    clipStart=nextStart;clipEnd=nextEnd;video.pause();video.currentTime=clipStart;syncTrimInputs();
    $("#clip-preview-message").textContent="Preview cut updated · "+(clipEnd-clipStart).toFixed(1)+" seconds · not saved";
  }
  function playCut(){
    const video=$("#clip-preview-video");
    if(!activeClip)return;
    stopAtEnd=true;video.currentTime=clipStart;
    const promise=video.play();
    if(promise?.catch)promise.catch(()=>{$("#clip-preview-message").textContent="Press play on the video to start preview.";});
  }
  function closePreview(){
    const dialog=$("#clip-preview-dialog"),video=$("#clip-preview-video");
    video.pause();video.removeAttribute("src");video.load();activeClip=null;
    if(dialog?.close)dialog.close();else dialog?.removeAttribute("open");
  }
  function openClipPreview(clip){
    activeClip=clip;clipStart=Number(clip.startSeconds)||0;clipEnd=Number(clip.endSeconds)||clipStart+1;stopAtEnd=true;
    const video=$("#clip-preview-video"),message=$("#clip-preview-message");
    video.pause();video.removeAttribute("src");video.load();
    $("#clip-preview-title").textContent=clip.title||"Clip preview";
    $("#clip-preview-source").textContent=(clip.sourceTitle||"Source video")+" · AI score "+Math.round(Number(clip.score)||0)+"/100";
    message.classList.remove("error-text");message.textContent="Loading private source video…";
    syncTrimInputs();
    video.src="/api/sources/"+encodeURIComponent(clip.sourceId);
    const dialog=$("#clip-preview-dialog");
    if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
    video.load();
    video.addEventListener("loadedmetadata",function seekStart(){video.removeEventListener("loadedmetadata",seekStart);if(activeClip)video.currentTime=clipStart;},{once:true});
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
        return '<article class="clip-candidate"><div class="clip-rank">#'+(index+1)+'</div><div class="clip-main"><div class="clip-title-row"><div><strong>'+esc(clip.title||"Untitled moment")+'</strong><small>'+esc(clip.sourceTitle||"Source video")+'</small></div><span class="clip-score">'+score+'<small>/100</small></span></div><p class="clip-hook">'+esc(clip.hook||"")+'</p><p class="clip-transcript">'+esc(clip.transcript||"")+'</p><div class="clip-meta"><span>'+time(clip.startSeconds)+' – '+time(clip.endSeconds)+'</span><span>'+Math.round(Number(clip.durationSeconds)||0)+' sec</span><span>'+esc(clip.status||"discovered")+'</span></div>'+(clip.caption?'<p class="clip-caption">'+esc(clip.caption)+'</p>':'')+(clip.hashtags?'<small class="clip-hashtags">'+esc(clip.hashtags)+'</small>':'')+'<div class="clip-actions"><button type="button" class="text-button clip-preview-btn" data-clip-id="'+esc(clip.id)+'">▶ Preview cut</button></div></div></article>';
      }).join("");
      const byId=new Map(clips.map(clip=>[String(clip.id),clip]));
      list.querySelectorAll(".clip-preview-btn").forEach(button=>button.addEventListener("click",()=>{const clip=byId.get(button.dataset.clipId);if(clip)openClipPreview(clip);}));
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
