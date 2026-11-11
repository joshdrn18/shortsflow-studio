(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const time = value => { const seconds=Math.max(0,Math.floor(Number(value)||0)); return Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0"); };
  const clock = value => { const seconds=Math.max(0,Number(value)||0),whole=Math.floor(seconds);return Math.floor(whole/60)+":"+String(whole%60).padStart(2,"0")+"."+Math.floor((seconds-whole)*10); };
  const dateTime = value => { if(!value)return "—";const date=new Date(value);if(!Number.isFinite(date.getTime()))return "—";return new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(date); };
  let activeClip=null, clipStart=0, clipEnd=0, busy=false;
  const selectedClipIds = new Set();

  function ensurePanel() {
    if ($("#clips-workspace")) return;
    const panel=document.createElement("section");
    panel.id="clips-workspace";panel.className="clips-workspace hidden";
    panel.innerHTML='<section class="discovery-hero"><div class="discovery-hero-copy"><span class="discovery-kicker">AI CLIP DISCOVERY</span><h2>Find the moments<br>worth <em>sharing.</em></h2><p>ShortsFlow scans your transcript, scores the strongest moments and turns them into editable clip candidates.</p><div class="discovery-hero-meta"><span><i></i> Transcript-powered</span><span>15–60 sec candidates</span><span>Up to 15 per source</span></div></div><div class="discovery-hero-art"><div class="discovery-orbit orbit-a"></div><div class="discovery-orbit orbit-b"></div><div class="discovery-scan-card"><span>AI DISCOVERY</span><strong>01<span> / 15</span></strong><small>Finding your next hook</small><div class="discovery-scan-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div></section><section class="discovery-results"><div class="clips-toolbar"><div><span class="discovery-kicker">RESULTS</span><strong id="clips-total">0 candidates</strong><p>Review each moment, fine-tune the cut and save a new draft version.</p></div><div class="clip-bulk-actions"><label><input type="checkbox" id="clips-select-all"> Select all</label><button type="button" class="text-button" id="clips-delete-selected" disabled>Delete selected (0)</button><button type="button" class="text-button" id="refresh-clips-btn">↻ Refresh</button></div></div><div id="clips-list" class="clips-list"></div><dialog id="clip-preview-dialog" class="clip-preview-dialog"><div class="source-preview-head"><div><strong id="clip-preview-title">Clip editor</strong><small id="clip-preview-source">Private source preview</small></div><button type="button" class="text-button" id="clip-preview-close">Close ✕</button></div><video id="clip-preview-video" playsinline preload="metadata"></video><div class="clip-preview-timeline"><span id="clip-preview-current">00:12</span><input id="clip-preview-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Seek within selected clip"><span id="clip-preview-duration">00:44</span></div><div class="clip-trim-controls"><label>Start (seconds)<input id="clip-start" type="number" min="0" step="0.1"></label><label>End (seconds)<input id="clip-end" type="number" min="0.1" step="0.1"></label><button type="button" class="primary-button" id="clip-play-btn">▶ Play cut</button></div><div class="clip-metadata-editor"><label>Clip title<input id="clip-edit-title" maxlength="120" placeholder="A clear, engaging title"></label><label>Caption<textarea id="clip-edit-caption" maxlength="2200" rows="3" placeholder="Short description for the post"></textarea></label><label>Hashtags<input id="clip-edit-hashtags" maxlength="500" placeholder="#shorts #topic"></label><label>Language<input id="clip-edit-language" maxlength="20" placeholder="en, id, ..."></label></div><div class="clip-editor-footer"><p id="clip-preview-message" role="status">Loading private source video…</p><button type="button" class="primary-button" id="clip-save-btn">Save edits</button><button type="button" class="primary-button" id="clip-render-btn">Render in background</button></div><p id="clip-render-message" class="clip-render-message" role="status">Save your edits and subtitle style before rendering. FFmpeg renders your 9:16 MP4 in the background and saves it privately to your workspace.</p><small class="clip-preview-note">Rendering continues on the background runner if you switch tabs or close your browser. Your source stays unchanged; nothing is published without Review Center approval.</small></dialog>';
    $(".page-heading").after(panel);
    $("#refresh-clips-btn").addEventListener("click",load);
    $("#clips-select-all").addEventListener("change", event => {(window.__shortsflowClipCache||[]).forEach(clip=>event.target.checked?selectedClipIds.add(String(clip.id)):selectedClipIds.delete(String(clip.id)));syncClipSelection();});
    $("#clips-delete-selected").addEventListener("click",()=>deleteClips([...selectedClipIds]));
    $("#clip-preview-close").addEventListener("click",closePreview);
    $("#clip-preview-dialog").addEventListener("click",event=>{if(event.target.id==="clip-preview-dialog")closePreview();});
    $("#clip-play-btn").addEventListener("click",playCut);
    $("#clip-save-btn").addEventListener("click",saveEdits);
    $("#clip-start").addEventListener("change",updateTrim);
    $("#clip-end").addEventListener("change",updateTrim);
    $("#clip-preview-video").addEventListener("timeupdate",()=>{
      const video=$("#clip-preview-video");if(!activeClip)return;
      if(video.currentTime>=clipEnd){video.pause();video.currentTime=clipEnd;}
      const elapsed=Math.max(0,Math.min(clipEnd-clipStart,video.currentTime-clipStart));
      $("#clip-preview-current").textContent=clock(elapsed);
      $("#clip-preview-seek").value=elapsed.toFixed(1);
    });
    $("#clip-preview-seek").addEventListener("input",event=>{
      if(!activeClip)return;const video=$("#clip-preview-video"),elapsed=Math.max(0,Math.min(clipEnd-clipStart,Number(event.target.value)||0));
      video.currentTime=clipStart+elapsed;$("#clip-preview-current").textContent=clock(elapsed);
    });
    $("#clip-preview-video").addEventListener("loadedmetadata",()=>{
      if(!activeClip)return;
      const duration=$("#clip-preview-video").duration;
      clipStart=Math.max(0,Math.min(clipStart,Math.max(0,duration-0.1)));
      clipEnd=Math.min(clipEnd,duration);if(clipEnd<=clipStart)clipEnd=Math.min(duration,clipStart+1);
      syncTrimInputs();$("#clip-preview-seek").max=(clipEnd-clipStart).toFixed(1);$("#clip-preview-seek").value="0";$("#clip-preview-current").textContent=clock(0);$("#clip-preview-duration").textContent=clock(clipEnd-clipStart);$("#clip-preview-message").textContent="Clip preview · source "+time(clipStart)+" to "+time(clipEnd)+" · "+(clipEnd-clipStart).toFixed(1)+" seconds. Timeline shows time within this clip.";
    });
    $("#clip-preview-video").addEventListener("error",()=>{$("#clip-preview-message").textContent="Could not play this source. Check browser codec support.";});
  }
  function syncTrimInputs(){
    $("#clip-start").value=clipStart.toFixed(1);$("#clip-end").value=clipEnd.toFixed(1);
    $("#clip-start").max=Math.max(0,clipEnd-0.1).toFixed(1);$("#clip-end").min=(clipStart+0.1).toFixed(1);
  }
  function updateTrim(){
    const duration=Number($("#clip-preview-video").duration)||Number(activeClip?.sourceDuration)||Infinity;
    const start=Number($("#clip-start").value),end=Number($("#clip-end").value);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration||end-start<1||end-start>180){
      $("#clip-preview-message").textContent="Cut must be 1–180 seconds and stay within the source video.";syncTrimInputs();return;
    }
    clipStart=start;clipEnd=end;window.__shortsflowClipStart=clipStart;window.__shortsflowClipEnd=clipEnd;const video=$("#clip-preview-video");video.pause();video.currentTime=clipStart;syncTrimInputs();$("#clip-preview-seek").max=(clipEnd-clipStart).toFixed(1);$("#clip-preview-seek").value="0";$("#clip-preview-current").textContent=clock(0);$("#clip-preview-duration").textContent=clock(clipEnd-clipStart);
    $("#clip-preview-message").textContent="Cut adjusted · "+(clipEnd-clipStart).toFixed(1)+" sec · unsaved";
  }
  function playCut(){
    if(!activeClip)return;const video=$("#clip-preview-video");video.currentTime=clipStart;
    video.playbackRate=1;video.currentTime=clipStart;const promise=video.play();if(promise?.catch)promise.catch(()=>{$("#clip-preview-message").textContent="Press play on the video to start preview.";});
  }
  function closePreview(){
    const dialog=$("#clip-preview-dialog"),video=$("#clip-preview-video");video.pause();video.removeAttribute("src");video.load();activeClip=null;window.__shortsflowActiveClip=null;
    if(dialog?.close)dialog.close();else dialog?.removeAttribute("open");
  }
  window.__shortsflowOpenClipPreview=clip=>new Promise((resolve,reject)=>{
    try{openClipPreview(clip);const video=$("#clip-preview-video");if(video.readyState>=1){resolve(true);return;}const timer=setTimeout(()=>{video.removeEventListener("loadedmetadata",ready);reject(new Error("Clip preview could not load in time."));},30000);const ready=()=>{clearTimeout(timer);video.removeEventListener("loadedmetadata",ready);resolve(true);};video.addEventListener("loadedmetadata",ready,{once:true});video.addEventListener("error",()=>{clearTimeout(timer);reject(new Error("Source preview could not be decoded."));},{once:true});}catch(error){reject(error);}
  });
  function openClipPreview(clip){
    activeClip=clip;clipStart=Number(clip.startSeconds)||0;clipEnd=Number(clip.endSeconds)||clipStart+1;window.__shortsflowActiveClip=clip;window.__shortsflowClipStart=clipStart;window.__shortsflowClipEnd=clipEnd;
    const video=$("#clip-preview-video");video.pause();video.removeAttribute("src");video.load();
    $("#clip-preview-title").textContent="Edit clip";
    $("#clip-preview-source").textContent=(clip.sourceTitle||"Source video")+" · AI score "+Math.round(Number(clip.score)||0)+"/100 · metadata v"+(clip.metadataVersion||0);
    $("#clip-edit-title").value=clip.title||"";$("#clip-edit-caption").value=clip.caption||"";
    $("#clip-edit-hashtags").value=clip.hashtags||"";$("#clip-edit-language").value=clip.language||"";
    $("#clip-preview-message").textContent="Loading private source video…";$("#clip-save-btn").disabled=false;
    syncTrimInputs();$("#clip-preview-seek").max=(clipEnd-clipStart).toFixed(1);$("#clip-preview-seek").value="0";$("#clip-preview-current").textContent=clock(0);$("#clip-preview-duration").textContent=clock(clipEnd-clipStart);video.playbackRate=1;video.defaultPlaybackRate=1;video.src="/api/sources/"+encodeURIComponent(clip.sourceId);
    const dialog=$("#clip-preview-dialog");if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
    video.load();video.addEventListener("loadedmetadata",function seekStart(){video.removeEventListener("loadedmetadata",seekStart);if(activeClip)video.currentTime=clipStart;},{once:true});
  }
  async function saveEdits(){
    if(!activeClip||busy)return;
    const title=$("#clip-edit-title").value.trim(),caption=$("#clip-edit-caption").value.trim();
    const hashtags=$("#clip-edit-hashtags").value.trim(),language=$("#clip-edit-language").value.trim();
    if(!title){$("#clip-preview-message").textContent="Clip title is required.";return;}
    busy=true;const button=$("#clip-save-btn");button.disabled=true;button.textContent="Saving…";
    try{
      const response=await fetch("/api/clips",{method:"PATCH",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({clipId:activeClip.id,startSeconds:clipStart,endSeconds:clipEnd,title,caption,hashtags,language})});
      const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not save edits.");
      $("#clip-preview-message").textContent="Saved successfully · metadata v"+data.clip.metadataVersion+" · "+(clipEnd-clipStart).toFixed(1)+" sec";
      await load();
      const updated=(window.__shortsflowClipCache||[]).find(item=>item.id===activeClip?.id);
      if(updated){activeClip=updated;window.__shortsflowActiveClip=updated;}window.__shortsflowClipStart=clipStart;window.__shortsflowClipEnd=clipEnd;
    }catch(error){$("#clip-preview-message").textContent=error.message;}
    finally{busy=false;button.disabled=false;button.textContent="Save edits";}
  }
  function syncClipSelection(){const clips=window.__shortsflowClipCache||[],count=selectedClipIds.size,button=$("#clips-delete-selected"),all=$("#clips-select-all");if(button){button.disabled=count===0;button.textContent="Delete selected ("+count+")";}if(all){all.checked=clips.length>0&&clips.every(c=>selectedClipIds.has(String(c.id)));all.indeterminate=count>0&&!all.checked;}document.querySelectorAll(".clip-select-one").forEach(input=>input.checked=selectedClipIds.has(input.dataset.clipId));}
  async function deleteClips(ids){const clipIds=[...new Set(ids.map(String))];if(!clipIds.length||busy)return;if(!window.confirm("Delete "+clipIds.length+" selected clip candidate(s)? Rendered files and review records will also be removed. Original source videos stay safe."))return;busy=true;const button=$("#clips-delete-selected");if(button){button.disabled=true;button.textContent="Deleting…";}try{const response=await fetch("/api/clips",{method:"DELETE",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({clipIds})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not delete clips.");clipIds.forEach(id=>selectedClipIds.delete(id));if(activeClip&&clipIds.includes(String(activeClip.id)))closePreview();await load();}catch(error){window.alert(error.message||"Could not delete selected clips.");}finally{busy=false;syncClipSelection();}}
  async function load(){
    const list=$("#clips-list");if(!list)return;list.innerHTML='<div class="sources-empty"><b>Loading clip candidates…</b></div>';
    try{
      const response=await fetch("/api/clips",{headers:{accept:"application/json"}}),data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||"Could not load clip candidates.");
      const clips=Array.isArray(data.clips)?data.clips:[];window.__shortsflowClipCache=clips;const liveIds=new Set(clips.map(clip=>String(clip.id)));for(const id of selectedClipIds)if(!liveIds.has(id))selectedClipIds.delete(id);
      $("#clips-total").textContent=clips.length+" candidate"+(clips.length===1?"":"s");
      if(!clips.length){list.innerHTML='<div class="discovery-empty"><div class="discovery-empty-symbol">✳</div><span class="discovery-kicker">READY WHEN YOU ARE</span><b>Your next standout clip starts here</b><p>Upload a supported MP4 from Source Library and run AI analysis. Once the transcript is ready, candidate moments will appear here automatically.</p><button type="button" class="text-button" id="discovery-go-sources">Go to Source Library ↗</button></div>';$("#discovery-go-sources").addEventListener("click",()=>document.querySelector('[data-view="sources"],[data-nav="sources"]')?.click());return;}
      list.innerHTML=clips.map((clip,index)=>{
        const score=Math.max(0,Math.min(100,Math.round(Number(clip.score)||0)));
        return '<article class="clip-candidate"><div class="clip-rank">0'+(index+1)+'</div><div class="clip-main"><div class="clip-title-row"><div><span class="clip-source-label">FROM '+esc(clip.sourceTitle||"SOURCE VIDEO")+'</span><strong>'+esc(clip.title||"Untitled moment")+'</strong><small>'+esc(clip.hook||"")+'</small></div><div class="clip-score-wrap"><span class="clip-score-label">AI SCORE</span><span class="clip-score">'+score+'<small>/100</small></span></div></div><div class="clip-transcript-box"><span>TRANSCRIPT EXCERPT</span><p class="clip-transcript">'+esc(clip.transcript||"No transcript excerpt available.")+'</p></div><div class="clip-meta"><span>◷ '+time(clip.startSeconds)+' – '+time(clip.endSeconds)+'</span><span>▣ '+Math.round(Number(clip.durationSeconds)||0)+' sec</span><span>● '+esc(clip.status||"discovered")+'</span><span class="clip-date-created">Created · '+esc(dateTime(clip.createdAt))+'</span>'+(clip.lastEditedAt?'<span class="clip-date-edited">Edited · '+esc(dateTime(clip.lastEditedAt))+'</span>':'')+'</div>'+(clip.caption?'<p class="clip-caption">'+esc(clip.caption)+'</p>':'')+(clip.hashtags?'<small class="clip-hashtags">'+esc(clip.hashtags)+'</small>':'')+'<div class="clip-actions"><label><input type="checkbox" class="clip-select-one" data-clip-id="'+esc(clip.id)+'"> Select</label><button type="button" class="clip-preview-btn" data-clip-id="'+esc(clip.id)+'">▶ Preview & edit <span>↗</span></button></div></div></article>';
      }).join("");
      const byId=new Map(clips.map(clip=>[String(clip.id),clip]));
      list.querySelectorAll(".clip-preview-btn").forEach(button=>button.addEventListener("click",()=>{const clip=byId.get(button.dataset.clipId);if(clip)openClipPreview(clip);}));
      list.querySelectorAll(".clip-select-one").forEach(input=>input.addEventListener("change",()=>{input.checked?selectedClipIds.add(input.dataset.clipId):selectedClipIds.delete(input.dataset.clipId);syncClipSelection();}));syncClipSelection();
    }catch(error){list.innerHTML='<div class="sources-empty error"><b>Could not load clip candidates</b><p>'+esc(error.message)+'</p></div>';}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    ensurePanel();
    document.addEventListener("shortsflow:view",event=>{if(event.detail?.view!=="clips")return;ensurePanel();$("#clips-workspace").classList.remove("hidden");load();});
    window.setInterval(()=>{const panel=$("#clips-workspace");if(panel&&!panel.classList.contains("hidden")&&!$("#clip-preview-dialog")?.open)load();},20000);
  });
})();
