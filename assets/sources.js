(() => {
  const $ = (s) => document.querySelector(s);
  const allowed = new Set(["video/mp4","video/quicktime","video/webm","video/x-matroska","video/ogg"]);
  const esc = (v) => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const bytes = (n) => { if (!n) return "—"; const u=["B","KB","MB","GB"]; const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3); return (n/1024**i).toFixed(i?1:0)+" "+u[i]; };
  function formatDuration(value) { const n=Number(value); if(!Number.isFinite(n)||n<=0)return 'duration unavailable'; const s=Math.floor(n); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  function readVideoDuration(file) { return new Promise(resolve=>{ const video=document.createElement('video'); const url=URL.createObjectURL(file); let done=false; const finish=value=>{if(done)return;done=true;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);resolve(value);}; video.preload='metadata'; video.onloadedmetadata=()=>finish(Number.isFinite(video.duration)&&video.duration>0?video.duration:null); video.onerror=()=>finish(null); video.src=url; video.load(); setTimeout(()=>finish(null),10000); }); }
  function ensurePanel() {
    if ($("#sources-workspace")) return;
    const panel=document.createElement("section");
    panel.id="sources-workspace"; panel.className="sources-workspace hidden";
    panel.innerHTML='<section class="source-intake"><div class="source-intake-copy"><span class="source-kicker">SOURCE LIBRARY</span><h2>Bring your footage in.</h2><p>Upload original videos to your private workspace. ShortsFlow will transcribe and discover the strongest moments.</p><div class="source-specs"><span> <i></i> Private R2 storage</span><span>Up to 90 MB</span><span>MP4 analysis · 10 min max</span></div></div><div class="source-dropzone" id="source-dropzone" tabindex="0" role="button" aria-label="Choose a video to upload"><div class="source-upload-glyph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><strong>Drop a video here</strong><span>or choose a file from your device</span><button class="primary-button" type="button" id="choose-source-btn">Browse videos <span>↗</span></button><small>MP4, MOV, WebM or MKV · 90 MB maximum</small></div></section><div class="upload-progress hidden" id="upload-progress"><div class="progress-heading"><strong id="upload-filename">Uploading video</strong><span id="upload-percent">0%</span></div><div class="progress-track"><i id="upload-progress-bar"></i></div><p id="upload-status">Preparing secure upload…</p></div><section class="source-queue-section"><div class="source-section-heading"><div><span class="source-kicker">BACKGROUND WORK</span><h3>Processing queue</h3><p>Track transcription and AI clip discovery jobs.</p></div><button class="text-button" id="refresh-jobs-btn">↻ Refresh</button></div><div id="jobs-list" class="jobs-list"></div></section><section class="source-library-section"><div class="source-section-heading"><div><span class="source-kicker">YOUR ASSETS</span><h3>Source videos <span id="source-count" class="source-count">0</span></h3><p>Original files stored privately in your workspace.</p></div><button class="text-button" id="refresh-sources-btn">↻ Refresh</button></div><div id="sources-list" class="sources-list"></div></section><dialog id="source-preview-dialog" class="source-preview-dialog"><div class="source-preview-head"><div><strong id="source-preview-title">Video preview</strong><small>Private workspace preview</small></div><button type="button" id="source-preview-close" class="text-button">Close ✕</button></div><video id="source-preview-video" controls playsinline preload="metadata"></video><p id="source-preview-message" role="status">Loading preview…</p></dialog>';
    panel.insertAdjacentHTML("beforeend", '<dialog id="source-transcript-dialog" class="source-preview-dialog"><div class="source-preview-head"><div><strong id="source-transcript-title">Transcript</strong><small id="source-transcript-meta">AI-generated transcript</small></div><div class="source-row-actions"><button type="button" id="source-transcript-vtt" class="text-button">Download VTT</button><button type="button" id="source-transcript-close" class="text-button">Close ✕</button></div></div><pre id="source-transcript-text" class="source-transcript-text"></pre></dialog>');
    $(".page-heading").after(panel);
    $("#choose-source-btn").addEventListener("click",()=>$("#source-file").click());
    const dropzone=$("#source-dropzone");
    dropzone.addEventListener("click",event=>{if(event.target.closest("button"))return;$("#source-file").click();});
    dropzone.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();$("#source-file").click();}});
    ["dragenter","dragover"].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.add("is-dragging");}));
    ["dragleave","drop"].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.remove("is-dragging");}));
    dropzone.addEventListener("drop",event=>{const file=event.dataTransfer?.files?.[0];if(file)upload(file);});
    $("#refresh-sources-btn").addEventListener("click",load); $("#refresh-jobs-btn").addEventListener("click",loadJobs);
  }
  async function load() {
    const list=$("#sources-list"); if(!list) return;
    list.innerHTML='<div class="sources-empty"><b>Loading source videos…</b></div>';
    try {
      const r=await fetch("/api/sources",{headers:{accept:"application/json"}});
      const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||"Could not load sources.");
      $("#source-count").textContent=d.sources.length;
      if(!d.sources.length){list.innerHTML='<div class="source-empty-state"><div class="source-empty-icon">▤</div><b>Your library is ready</b><p>Upload your first video to create a searchable library and discover clips with AI.</p><button type="button" class="text-button" id="empty-upload-btn">＋ Add your first video</button></div>';$("#empty-upload-btn").addEventListener("click",()=>$("#source-file").click());return;}
      list.innerHTML=d.sources.map(s=>'<article class="source-card"><div class="source-card-visual"><span class="source-card-play">▶</span><span class="source-card-duration">'+esc(formatDuration(s.durationSeconds))+'</span><span class="source-card-format">'+esc((s.mimeType||"video").replace("video/","").toUpperCase())+'</span></div><div class="source-card-body"><div class="source-card-title"><strong title="'+esc(s.title)+'">'+esc(s.title)+'</strong><span class="source-status source-status-'+esc(s.status)+'">'+esc(s.status)+'</span></div><div class="source-card-details"><span>'+bytes(s.sizeBytes)+'</span><i></i><span>'+esc(new Date(s.createdAt).toLocaleDateString())+'</span></div><div class="source-card-actions"><button type="button" class="source-action-main preview-source-btn" data-source-id="'+esc(s.id)+'" data-source-title="'+esc(s.title)+'">Preview video</button><button type="button" class="source-action-icon queue-source-btn" title="Queue AI analysis" aria-label="Queue AI analysis" data-source-id="'+esc(s.id)+'">✳</button><button type="button" class="source-action-icon view-transcript-btn" title="View transcript" aria-label="View transcript" data-source-id="'+esc(s.id)+'" '+(s.transcriptStatus==="completed"?"":"disabled")+'>CC</button></div></div></article>').join("");
      list.querySelectorAll(".queue-source-btn").forEach(btn=>btn.addEventListener("click",()=>queueSource(btn.dataset.sourceId,btn)));
      list.querySelectorAll(".preview-source-btn").forEach(btn=>btn.addEventListener("click",()=>openPreview(btn.dataset.sourceId,btn.dataset.sourceTitle)));
      list.querySelectorAll(".view-transcript-btn").forEach(btn=>btn.addEventListener("click",()=>openTranscript(btn.dataset.sourceId,btn.closest(".source-row")?.querySelector(".source-file-info strong")?.textContent)));
      await loadJobs();
    } catch(e){list.innerHTML='<div class="sources-empty error"><b>Could not load sources</b><p>'+esc(e.message)+'</p></div>';}
  }
  function openPreview(sourceId, title) {
    const dialog=$("#source-preview-dialog");
    const video=$("#source-preview-video");
    const message=$("#source-preview-message");
    if(!dialog || !video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    $("#source-preview-title").textContent=title || "Video preview";
    message.textContent="Loading private video preview…";
    message.classList.remove("error-text");
    video.src="/api/sources/"+encodeURIComponent(sourceId);
    video.onerror=()=>{message.textContent="This video format or codec may not be supported by your browser.";message.classList.add("error-text");};
    video.onloadedmetadata=()=>{message.textContent=video.duration ? "Duration: "+Math.floor(video.duration/60)+":"+String(Math.floor(video.duration%60)).padStart(2,"0") : "Preview ready.";};
    if(typeof dialog.showModal==="function") dialog.showModal();
    else dialog.setAttribute("open","");
  }
  function buildTranscriptVtt(words) {
    const valid=(Array.isArray(words)?words:[]).filter(w=>w.word&&Number.isFinite(Number(w.start))&&Number.isFinite(Number(w.end)));
    const cues=[];let group=[];
    for(const word of valid){group.push(word);if(group.length>=7||Number(word.end)-Number(group[0].start)>=3.5){cues.push(group);group=[];}}
    if(group.length)cues.push(group);
    const stamp=value=>{const ms=Math.max(0,Math.round(Number(value)*1000));const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),r=ms%1000;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+"."+String(r).padStart(3,"0");};
    return ["WEBVTT","",...cues.map((cue,i)=>(i+1)+"\n"+stamp(cue[0].start)+" --> "+stamp(cue[cue.length-1].end)+"\n"+cue.map(w=>w.word).join(" ").trim()),""].join("\n");
  }
  let activeTranscriptVtt="";
  async function openTranscript(sourceId,title) {
    const dialog=$("#source-transcript-dialog"),text=$("#source-transcript-text"),meta=$("#source-transcript-meta");
    text.textContent="Loading transcript…";meta.textContent="Fetching private transcript";$("#source-transcript-title").textContent=title||"Transcript";
    try {
      const r=await fetch("/api/sources/"+encodeURIComponent(sourceId)+"/transcript",{headers:{accept:"application/json"}});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not load transcript.");
      const t=d.transcript;text.textContent=t.text||"No speech detected.";
      meta.textContent="Version "+t.version+" · "+Number(t.wordCount||0).toLocaleString()+" timestamped words · "+(t.model||"Whisper");
      activeTranscriptVtt=buildTranscriptVtt(t.words);
      dialog.showModal();
    } catch(e){text.textContent=e.message;meta.textContent="Transcript unavailable";activeTranscriptVtt="";dialog.showModal();}
  }
  async function loadJobs() {
    const list=$("#jobs-list"); if(!list) return;
    try {
      const r=await fetch("/api/jobs",{headers:{accept:"application/json"}});
      const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||"Could not load queue.");
      if(!d.jobs.length){list.innerHTML='<div class="sources-empty"><b>No processing jobs yet</b><p>Queue analysis from a source video when ready.</p></div>';return;}
      list.innerHTML=d.jobs.map(j=>'<article class="job-row"><div class="job-file-icon">✳</div><div class="source-file-info"><strong>'+esc(j.source_title)+'</strong><small>'+esc(j.job_type.replaceAll("_"," "))+' · '+esc(new Date(j.created_at).toLocaleString())+' · '+Number(j.attempts)+'/'+Number(j.max_attempts)+' attempts</small>'+(j.last_error?'<small class="error-text">'+esc(j.last_error)+'</small>':'')+'</div><span class="source-status job-'+esc(j.status)+'">'+esc(j.status)+'</span><div class="job-row-actions">'+(j.status==="queued"?'<button type="button" class="text-button job-action-btn" data-job-id="'+esc(j.id)+'" data-action="cancel">Cancel</button>':j.status==="failed"?'<button type="button" class="text-button job-action-btn" data-job-id="'+esc(j.id)+'" data-action="retry">Retry</button>':'')+'</div></article>').join("");
      list.querySelectorAll(".job-action-btn").forEach(btn=>btn.addEventListener("click",()=>updateJob(btn.dataset.jobId,btn.dataset.action,btn)));
    } catch(e){list.innerHTML='<div class="sources-empty error"><b>Queue unavailable</b><p>'+esc(e.message)+'</p></div>';}
  }
  async function updateJob(jobId,action,button) {
    const label=action==="cancel"?"Cancel":"Retry";
    if(action==="cancel"&&!confirm("Cancel this queued job?")) return;
    button.disabled=true;button.textContent=action==="cancel"?"Cancelling…":"Retrying…";
    try {
      const r=await fetch("/api/jobs/"+encodeURIComponent(jobId),{method:"PATCH",headers:{"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({action})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not update job.");
      await loadJobs();
    } catch(e){button.disabled=false;button.textContent=label;alert(e.message);}
  }
  async function queueSource(sourceId,button) {
    button.disabled=true;button.textContent="Queueing…";
    try {
      const r=await fetch("/api/jobs",{method:"POST",headers:{"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({sourceId,jobType:"analyze_source"})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not queue analysis.");
      button.textContent=d.reused?"Already queued":"Queued"; await loadJobs();
    } catch(e){button.disabled=false;button.textContent="Queue analysis";alert(e.message);}
  }
  async function upload(file) {
    if(!allowed.has(file.type)){alert("Unsupported format. Use MP4, MOV, WebM, MKV or OGG.");return;}
    if(file.size>90*1024*1024){alert("This upload currently supports files up to 90 MB.");return;}
    const box=$("#upload-progress"),bar=$("#upload-progress-bar"),pct=$("#upload-percent"),status=$("#upload-status");
    box.classList.remove("hidden");$("#upload-filename").textContent=file.name;bar.style.width="0%";pct.textContent="0%";status.textContent="Reading video metadata…";status.classList.remove("error-text");
    const durationSeconds=await readVideoDuration(file);
    status.textContent="Uploading securely to private R2 storage…";
    const xhr=new XMLHttpRequest();xhr.open("POST","/api/sources/upload");xhr.setRequestHeader("Content-Type",file.type);xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name));if(durationSeconds)xhr.setRequestHeader("X-Video-Duration",String(durationSeconds));
    xhr.upload.onprogress=e=>{if(!e.lengthComputable)return;const p=Math.round(e.loaded/e.total*100);bar.style.width=p+"%";pct.textContent=p+"%";status.textContent=p===100?"Saving video record…":"Uploading · "+bytes(e.loaded)+" of "+bytes(e.total);};
    xhr.onload=async()=>{let d={};try{d=JSON.parse(xhr.responseText);}catch{}if(xhr.status<200||xhr.status>=300||!d.ok){status.textContent=d.error||"Upload failed.";status.classList.add("error-text");return;}bar.style.width="100%";pct.textContent="100%";status.textContent="Saved to private storage.";await load();fetch("/api/workspace/summary").then(r=>r.json()).then(d=>{if(d.ok&&d.stats)$("#stat-sources").textContent=d.stats.sources;}).catch(()=>{});};
    xhr.onerror=()=>{status.textContent="Network error. Upload status is unknown; refresh the source list before retrying.";status.classList.add("error-text");};xhr.send(file);
  }
  document.addEventListener("DOMContentLoaded",()=>{
    ensurePanel();
    const input=$("#source-file"); loadJobs();
    setInterval(()=>{const panel=$("#sources-workspace");if(panel&&!panel.classList.contains("hidden"))loadJobs();},15000);
    $("#source-preview-close").addEventListener("click",()=>{const dialog=$("#source-preview-dialog");$("#source-preview-video").pause();$("#source-preview-video").removeAttribute("src");$("#source-preview-video").load();if(dialog.close)dialog.close();else dialog.removeAttribute("open");});
    $("#source-preview-dialog").addEventListener("click",event=>{if(event.target.id==="source-preview-dialog")$("#source-preview-close").click();});
    $("#source-transcript-close").addEventListener("click",()=>$("#source-transcript-dialog").close());
    $("#source-transcript-vtt").addEventListener("click",()=>{if(!activeTranscriptVtt)return;const blob=new Blob([activeTranscriptVtt],{type:"text/vtt;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="shortsflow-transcript.vtt";a.click();URL.revokeObjectURL(url);});

    input.addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];if(f)upload(f);e.target.value="";});
    document.addEventListener("shortsflow:view", event => {
      if (event.detail?.view !== "sources") return;
      ensurePanel();
      $("#sources-workspace").classList.remove("hidden");
      load();
    });
  });
})();