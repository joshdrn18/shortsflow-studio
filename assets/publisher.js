(() => {
 const $=s=>document.querySelector(s),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 let state={connection:null,jobs:[],eligible:[],loading:false,profiles:[],activeProfileId:null,metrics:null};
 const date=v=>{if(!v)return"Ready for automatic upload";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"});};
 function ensure(){
  if($("#publisher-workspace"))return;
  const panel=document.createElement("section");panel.id="publisher-workspace";panel.className="publisher-workspace hidden";
  panel.innerHTML=`
   <div class="publisher-hero"><div><span class="publisher-kicker">YOUTUBE STUDIO · PUBLISHING</span><h2>Your next Short,<br><em>ready when you are.</em></h2><p>Connect your channel, choose an approved render, prepare its metadata and schedule the upload. Nothing is sent without your explicit action.</p></div><div class="publisher-lock"><span>▶</span><b>Approval protected</b><small>Only approved current renders</small></div></div>
   <section class="publisher-connect panel"><div class="publisher-channel-mark">▶</div><div class="publisher-channel-copy"><span class="publisher-kicker">CHANNEL CONNECTION</span><h3 id="youtube-channel-title">YouTube channel not connected</h3><p id="youtube-channel-detail">Connect your Google account to prepare YouTube uploads.</p></div><a class="primary-button" id="youtube-connect" href="/api/youtube/connect">Connect YouTube <span>↗</span></a></section>
   <div class="publisher-stats"><div><span>Approved & ready</span><strong id="publisher-eligible">—</strong></div><div><span>Queued uploads</span><strong id="publisher-queued">—</strong></div><div><span>Published</span><strong id="publisher-published">—</strong></div></div>
   <section class="publisher-section publisher-performance"><div class="publisher-section-head"><div><span class="publisher-kicker">90-DAY GROWTH TRACKER</span><h3>10M Shorts views target</h3><p>Track views on Shorts published during the last 90 days. Refresh to pull the latest YouTube counts.</p></div><button class="text-button" id="publisher-metrics-sync" type="button">↻ Sync views</button></div><div class="publisher-growth-stats"><div><span>Tracked views</span><strong id="publisher-metric-views">—</strong></div><div><span>Published Shorts</span><strong id="publisher-metric-videos">—</strong></div><div><span>Likes</span><strong id="publisher-metric-likes">—</strong></div><div><span>Comments</span><strong id="publisher-metric-comments">—</strong></div></div><div class="publisher-growth-stats publisher-retention-stats"><div><span>Average viewed</span><strong id="publisher-retention-average">—</strong></div><div><span>Average view duration</span><strong id="publisher-retention-duration">—</strong></div><div><span>Analytics videos</span><strong id="publisher-retention-count">—</strong></div></div><div class="publisher-growth-track"><div class="publisher-growth-track-head"><b id="publisher-metric-progress">0% of 10M</b><span id="publisher-metric-updated">Not synced yet</span></div><div class="publisher-growth-bar"><span id="publisher-metric-bar"></span></div></div><div id="publisher-metric-videos-list" class="publisher-metric-videos"><div class="publisher-empty">Sync your YouTube channel to load performance.</div></div><small class="publisher-metric-note">YouTube Data API provides lifetime view counts for each video. This tracker is not a date-range analytics report and does not represent retention or unique viewers.</small></section>
   <section class="publisher-section"><div class="publisher-section-head"><div><span class="publisher-kicker">UPLOAD PLANNER</span><h3>Prepare a YouTube Short</h3><p>Pick a clip approved in Review Center. Its approval is checked again when you queue it.</p></div></div>
    <form id="publisher-form" class="publisher-form">
     <label>Approved render<select id="publisher-clip" required><option value="">Loading approved renders…</option></select></label>
     <div class="publisher-brand-meta"><div class="publisher-brand-meta-head"><div><b>Brand metadata profile</b><small>Use saved channel-specific title, description and hashtag rules.</small></div><select id="publisher-brand-profile"><option value="">Loading profiles…</option></select></div><div class="publisher-meta-fields"><label>Title template<input id="publisher-title-template" maxlength="100" placeholder="{clip_title} #Shorts"></label><label>Description template<textarea id="publisher-description-template" rows="2" maxlength="4000" placeholder="{clip_title}\n\n{hashtags}"></textarea></label><label>Hashtags<input id="publisher-hashtag-template" maxlength="500" placeholder="#shorts, #gaming"></label><label>Default tags<input id="publisher-tag-template" maxlength="500" placeholder="shorts, gaming, creator"></label></div><div class="publisher-brand-actions"><button type="button" class="text-button" id="publisher-brand-save">Save profile metadata</button><button type="button" class="secondary-button" id="publisher-brand-apply">Apply to selected clip</button></div></div>\n     <label>Video title<input id="publisher-title" maxlength="100" required placeholder="Give your Short a clear title"></label>
     <label>Description<textarea id="publisher-description" rows="4" maxlength="5000" placeholder="Add context, links or credits…"></textarea></label>
     <section class="publisher-metadata-preview" aria-live="polite"><div class="publisher-preview-head"><div><span class="publisher-kicker">FINAL METADATA PREVIEW</span><b>Ready for YouTube</b></div><span class="publisher-preview-count" id="publisher-preview-count">0 / 100</span></div><div class="publisher-preview-body"><strong id="publisher-preview-title">Your video title will appear here</strong><p id="publisher-preview-description">Your description preview will appear here.</p><div id="publisher-preview-tags" class="publisher-preview-tags"><span>No tags added</span></div></div><small>Preview reflects the actual title, description and tags in the upload form. Review before queueing.</small></section>
     <div class="publisher-form-row"><label>Visibility<select id="publisher-privacy"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label>Schedule (optional)<input id="publisher-schedule" type="datetime-local"></label></div>
     <label>Tags <input id="publisher-tags" placeholder="shorts, topic, channel (comma separated)"></label>
     <div class="publisher-form-foot"><p>After you queue an upload, Cloudflare checks the queue every minute and uploads it at its scheduled time. Only the latest approved render can be published. Default visibility is Private.</p><button class="primary-button" type="submit" id="publisher-submit" disabled>Queue upload <span>→</span></button></div>
     <p id="publisher-message" class="publisher-message" role="status"></p>
    </form>
   </section>
   <section class="publisher-section"><div class="publisher-section-head"><div><span class="publisher-kicker">PUBLISHING HISTORY</span><h3>Upload queue</h3><p>Track scheduled and completed YouTube jobs.</p></div><button class="text-button" id="publisher-refresh">↻ Refresh</button></div><div id="publisher-jobs" class="publisher-jobs"><div class="publisher-empty">Loading publishing history…</div></div></section>`;
  $(".page-content")?.append(panel);
  $("#youtube-connect").addEventListener("click",e=>{e.preventDefault();window.location.href="/api/youtube/connect";});
  $("#publisher-refresh").addEventListener("click",load);
  $("#publisher-metrics-sync").addEventListener("click",syncMetrics);
  $("#publisher-clip").addEventListener("change",()=>{const item=state.eligible.find(x=>x.clipId===$("#publisher-clip").value);if(item){$("#publisher-title").value=item.title||"";$("#publisher-description").value=item.caption||"";}});
  $("#publisher-brand-profile").addEventListener("change",loadBrandTemplateFields);
  $("#publisher-brand-save").addEventListener("click",saveBrandTemplate);
  $("#publisher-brand-apply").addEventListener("click",applyBrandTemplate);
  ["#publisher-title","#publisher-description","#publisher-tags"].forEach(selector=>$(selector).addEventListener("input",renderMetadataPreview));
  renderMetadataPreview();
  $("#publisher-form").addEventListener("submit",queue);
 }
 
 function renderBrandProfileOptions(){
  const select=$("#publisher-brand-profile"),current=select.value||state.activeProfileId;
  select.innerHTML='<option value="">Choose Brand Profile…</option>'+state.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
  if(state.profiles.some(p=>p.id===current))select.value=current;
 }
 function selectedBrandProfile(){return state.profiles.find(p=>p.id===$("#publisher-brand-profile").value)||null;}
 function loadBrandTemplateFields(){
  const profile=selectedBrandProfile(),m=profile?.metadata||{};
  $("#publisher-title-template").value=m.titleTemplate||"{clip_title} #Shorts";
  $("#publisher-description-template").value=m.descriptionTemplate||"{clip_title}\n\n{hashtags}";
  $("#publisher-hashtag-template").value=m.hashtags||"#shorts";
  $("#publisher-tag-template").value=m.tags||"shorts";
 }
 async function saveBrandTemplate(){
  const profile=selectedBrandProfile();if(!profile){setMessage("Choose a Brand Profile before saving metadata.",true);return;}
  const button=$("#publisher-brand-save");button.disabled=true;button.textContent="Saving…";
  try{
   const metadata={titleTemplate:$("#publisher-title-template").value.trim(),descriptionTemplate:$("#publisher-description-template").value.trim(),hashtags:$("#publisher-hashtag-template").value.trim(),tags:$("#publisher-tag-template").value.trim()};
   const response=await fetch("/api/workspace/brand-kit",{method:"PUT",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({action:"metadata",profileId:profile.id,metadata})});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not save profile metadata.");
   state.profiles=state.profiles.map(p=>p.id===profile.id?data.profile:p);setMessage("Metadata template saved to "+profile.name+".");
  }catch(e){setMessage(e.message,true);}
  finally{button.disabled=false;button.textContent="Save profile metadata";}
 }
 function applyBrandTemplate(){
  const item=state.eligible.find(x=>x.clipId===$("#publisher-clip").value);
  if(!item){setMessage("Choose an approved render first.",true);return;}
  const replace=value=>String(value||"").replace(/\\{clip_title\\}/gi,item.title||"").replace(/\\{source_title\\}/gi,item.sourceTitle||"").replace(/\\{channel\\}/gi,state.connection?.channelTitle||"").replace(/\\{hashtags\\}/gi,$("#publisher-hashtag-template").value.trim());
  const title=replace($("#publisher-title-template").value).replace(/\\s+/g," ").trim().slice(0,100);
  const description=replace($("#publisher-description-template").value).trim().slice(0,5000);
  const tagsText=replace($("#publisher-tag-template").value);
  const tags=[],seen=new Set();let tagChars=0;
  for(const raw of tagsText.split(",")){
   const tag=raw.trim().replace(/\\s+/g," ");if(!tag)continue;
   const key=tag.toLocaleLowerCase();if(seen.has(key))continue;
   const cost=tag.length+(tags.length?1:0);if(tags.length>=30||tagChars+cost>500)continue;
   seen.add(key);tags.push(tag);tagChars+=cost;
  }
  $("#publisher-title").value=title||item.title||"";
  $("#publisher-description").value=description||item.caption||"";
  $("#publisher-tags").value=tags.join(", ");
  setMessage("Brand metadata applied. Placeholders were resolved and duplicate/over-limit tags were removed. Review everything before queueing.");
  renderMetadataPreview();
 }

 function metricNumber(value){return new Intl.NumberFormat().format(Number(value||0));}
 function durationLabel(value){const seconds=Math.max(0,Math.round(Number(value||0)));return Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");}
 async function loadRetention(){
  try{
   const response=await fetch("/api/youtube/retention",{headers:{accept:"application/json"}}),data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"Retention metrics unavailable.");
   state.retention=data;
   $("#publisher-retention-average").textContent=Number(data.averageViewPercentage||0).toFixed(1)+"%";
   $("#publisher-retention-count").textContent=metricNumber(data.measuredCount);
   const measured=(data.videos||[]).filter(v=>v.average_view_duration!==null&&v.average_view_duration!==undefined);
   const average=measured.length?measured.reduce((sum,v)=>sum+Number(v.average_view_duration||0),0)/measured.length:0;
   $("#publisher-retention-duration").textContent=measured.length?durationLabel(average):"—";
   const note=$(".publisher-metric-note");if(note)note.textContent=data.note||"YouTube Analytics retention metrics.";
  }catch(error){
   $("#publisher-retention-average").textContent="—";$("#publisher-retention-duration").textContent="—";$("#publisher-retention-count").textContent="—";
   const note=$(".publisher-metric-note");if(note)note.textContent=error.message+" Use Reconnect YouTube to grant Analytics access.";
  }
 }
 async function loadMetrics(){
  const views=$("#publisher-metric-videos-list");if(!views)return;
  try{
   const response=await fetch("/api/youtube/analytics",{headers:{accept:"application/json"}});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Metrics unavailable.");
   state.metrics=data;
   $("#publisher-metric-views").textContent=metricNumber(data.totals?.views);
   $("#publisher-metric-videos").textContent=metricNumber(data.videoCount);
   $("#publisher-metric-likes").textContent=metricNumber(data.totals?.likes);
   $("#publisher-metric-comments").textContent=metricNumber(data.totals?.comments);
   $("#publisher-metric-progress").textContent=(Number(data.progressPercent||0).toFixed(2))+"% of 10M";
   $("#publisher-metric-bar").style.width=Math.min(100,Math.max(0,Number(data.progressPercent||0)))+"%";
   $("#publisher-metric-updated").textContent=data.lastSyncedAt?"Synced "+date(data.lastSyncedAt):"Not synced yet";
   const top=(data.videos||[]).filter(v=>v.views!==null&&v.views!==undefined).sort((a,b)=>Number(b.views)-Number(a.views)).slice(0,5);
   views.innerHTML=top.length?top.map((v,i)=>'<article class="publisher-metric-video"><span class="publisher-metric-rank">'+(i+1)+'</span><div><b>'+esc(v.title||v.clip_title||"YouTube Short")+'</b><small>'+esc(v.source_title||"")+'</small></div><strong>'+metricNumber(v.views)+' views</strong>'+(v.platform_url?'<a href="'+esc(v.platform_url)+'" target="_blank" rel="noopener">Watch ↗</a>':"")+'</article>').join(""):'<div class="publisher-empty">No published video metrics yet. Publish a Short, then sync again.</div>';
   const note=$(".publisher-metric-note");if(note)note.textContent=data.note||"Metrics are provided by YouTube Data API.";
  }catch(error){views.innerHTML='<div class="publisher-empty">'+esc(error.message)+"</div>";}
 }
 async function syncMetrics(){
  const button=$("#publisher-metrics-sync");if(!button)return;
  button.disabled=true;button.textContent="Syncing…";
  try{
   const response=await fetch("/api/youtube/analytics",{method:"POST",headers:{accept:"application/json"}}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not sync views.");
   await loadMetrics();
   let retentionMessage="";try{const rr=await fetch("/api/youtube/retention",{method:"POST",headers:{accept:"application/json"}}),rd=await rr.json();if(!rr.ok||!rd.ok)throw new Error(rd.error||"Analytics sync unavailable.");await loadRetention();retentionMessage=" Retention synced for "+rd.synced+" videos ("+rd.startDate+" to "+rd.endDate+").";}catch(e){retentionMessage=" Views synced. "+e.message;}
   setMessage((data.synced?("Synced "+data.synced+" published video view counts."):(data.message||"Views are up to date."))+retentionMessage);
  }
  catch(error){setMessage(error.message,true);}
  finally{button.disabled=false;button.textContent="↻ Sync views";}
 }
 function renderMetadataPreview(){
  const title=$("#publisher-title")?.value.trim()||"";
  const description=$("#publisher-description")?.value.trim()||"";
  const tags=($("#publisher-tags")?.value||"").split(",").map(tag=>tag.trim()).filter(Boolean);
  $("#publisher-preview-title").textContent=title||"Your video title will appear here";
  $("#publisher-preview-description").textContent=description||"Your description preview will appear here.";
  $("#publisher-preview-count").textContent=title.length+" / 100";
  const tagBox=$("#publisher-preview-tags");
  tagBox.replaceChildren();
  if(!tags.length){const empty=document.createElement("span");empty.textContent="No tags added";tagBox.append(empty);}
  else tags.forEach(tag=>{const chip=document.createElement("span");chip.textContent="#"+tag.replace(/^#+/,"");tagBox.append(chip);});
 }
 function setMessage(msg,error=false){const el=$("#publisher-message");el.textContent=msg;el.classList.toggle("error",error);}
 function render(){
  const c=state.connection;
  $("#youtube-channel-title").textContent=c?.connected?c.channelTitle:"YouTube channel not connected";
  $("#youtube-channel-detail").textContent=c?.connected?"Connected · "+date(c.connectedAt):"Connect your Google account to prepare YouTube uploads.";
  $("#youtube-connect").textContent=c?.connected?"Reconnect YouTube ↗":"Connect YouTube ↗";
  $("#youtube-connect").classList.toggle("connected",!!c?.connected);
  $("#publisher-eligible").textContent=state.eligible.length;
  $("#publisher-queued").textContent=state.jobs.filter(j=>["queued","uploading","processing"].includes(j.status)).length;
  $("#publisher-published").textContent=state.jobs.filter(j=>j.status==="published").length;
  const select=$("#publisher-clip"),current=select.value;
  select.innerHTML='<option value="">Choose an approved render…</option>'+state.eligible.map(x=>'<option value="'+esc(x.clipId)+'">'+esc(x.title)+' · '+Math.round(x.durationSeconds)+' sec</option>').join("");
  if(state.eligible.some(x=>x.clipId===current))select.value=current;
  $("#publisher-submit").disabled=!c?.connected||!state.eligible.length;
  const list=$("#publisher-jobs");
  if(!state.jobs.length){list.innerHTML='<div class="publisher-empty">No publishing jobs yet. Approved clips will appear in the planner above.</div>';return;}
  list.innerHTML=state.jobs.map(j=>{const status=String(j.status||"").trim().toLowerCase();return '<article class="publisher-job"><div class="publisher-job-main"><b>'+esc(j.title||j.clip_title||"YouTube Short")+'</b><span>'+esc(date(j.scheduled_at))+'</span>'+(status==="failed"&&j.last_error?'<small class="publisher-error-detail">'+esc(j.last_error)+'</small>':"")+'</div><span class="publisher-status status-'+esc(status)+'">'+esc(status||"unknown")+'</span>'+(j.platform_url?'<a href="'+esc(j.platform_url)+'" target="_blank" rel="noopener">Watch ↗</a>':"")+(status==="queued"?'<button class="text-button" data-cancel="'+esc(j.id)+'">Cancel</button>':"")+(status==="failed"?'<button class="publisher-delete-button" data-delete="'+esc(j.id)+'" aria-label="Delete failed publishing job">Delete failed job</button>':"")+'</article>'}).join("");
  list.querySelectorAll("[data-cancel]").forEach(btn=>btn.addEventListener("click",()=>cancel(btn.dataset.cancel)));
  list.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>removeFailed(btn.dataset.delete)));
 }
 async function load(){
  ensure();if(state.loading)return;state.loading=true;
  try{
   const [pub,review]=await Promise.all([fetch("/api/youtube",{headers:{accept:"application/json"}}),fetch("/api/review",{headers:{accept:"application/json"}})]);
   const p=await pub.json();if(!pub.ok||!p.ok)throw new Error(p.error||"Could not load publisher.");
   const r=await review.json();if(!review.ok||!r.ok)throw new Error(r.error||"Could not load approved renders.");
   let b={profiles:[],activeProfileId:null};
   try{const brands=await fetch("/api/workspace/brand-kit",{headers:{accept:"application/json"}});const data=await brands.json();if(brands.ok&&data.ok)b=data;else setMessage(data.error||"Brand Profiles unavailable. Apply migration 0017 to enable saved metadata templates.",true);}
   catch{setMessage("Brand Profiles unavailable. Publisher queue remains usable; apply migration 0017 to enable saved metadata templates.",true);}
   state.connection=p.connection;state.jobs=p.jobs||[];state.eligible=(r.items||[]).filter(x=>x.decision==="approved");state.profiles=b.profiles||[];state.activeProfileId=b.activeProfileId||null;
   render();renderBrandProfileOptions();loadBrandTemplateFields();
   loadMetrics();loadRetention();
  }catch(e){setMessage(e.message,true);}
  finally{state.loading=false;}
 }
 async function queue(e){
  e.preventDefault();if(!$("#publisher-clip").value)return;
  const btn=$("#publisher-submit");btn.disabled=true;btn.textContent="Queueing…";setMessage("");
  try{
   const scheduled=$("#publisher-schedule").value?new Date($("#publisher-schedule").value).toISOString():null;
   const response=await fetch("/api/youtube",{method:"POST",headers:{"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({clipId:$("#publisher-clip").value,title:$("#publisher-title").value,description:$("#publisher-description").value,privacyStatus:$("#publisher-privacy").value,scheduledAt:scheduled,tags:$("#publisher-tags").value.split(",").map(x=>x.trim()).filter(Boolean)})});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not queue upload.");
   setMessage("Upload job queued. It is not published yet.");$("#publisher-form").reset();renderMetadataPreview();await load();
  }catch(err){setMessage(err.message,true);}
  finally{btn.disabled=!state.connection?.connected||!state.eligible.length;btn.innerHTML='Queue upload <span>→</span>';}
 }
 async function cancel(id){
  if(!window.confirm("Cancel this queued YouTube upload?"))return;
  try{const response=await fetch("/api/youtube?id="+encodeURIComponent(id),{method:"DELETE"}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not cancel job.");await load();}
  catch(e){setMessage(e.message,true);}
 }
 async function removeFailed(id){
  if(!window.confirm("Delete this failed queue record? The rendered video file will remain in your library."))return;
  try{const response=await fetch("/api/youtube?id="+encodeURIComponent(id),{method:"DELETE"}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not delete failed job.");setMessage("Failed queue record deleted.");await load();}
  catch(e){setMessage(e.message,true);}
 }
 document.addEventListener("shortsflow:view",e=>{if(e.detail?.view==="publisher"){ensure();$("#publisher-workspace").classList.remove("hidden");load();}else $("#publisher-workspace")?.classList.add("hidden");});
 ensure();
 setInterval(()=>{const panel=$("#publisher-workspace");if(panel&&!panel.classList.contains("hidden"))load();},15000);
 const params=new URLSearchParams(location.search);if(params.has("youtube")){const result=params.get("youtube"),reason=params.get("reason");history.replaceState({}, "", location.pathname);if(result==="connected")setTimeout(()=>{ensure();load();setMessage("YouTube channel connected successfully.");},0);else if(result!=="")setTimeout(()=>{ensure();const messages={denied:"Google connection was cancelled.",setup:"OAuth configuration is incomplete. Check the YouTube environment variables in Cloudflare Pages.", "invalid-state":"The Google sign-in session expired or did not match. Start Connect YouTube again.",token:"Google rejected the authorization-code exchange. Check the OAuth client ID, client secret, and exact redirect URI.", "channel-api":"Google sign-in succeeded, but YouTube Data API could not read the channel. Confirm YouTube Data API v3 is enabled in the same Google Cloud project.", "no-channel":"This Google account does not have an accessible YouTube channel. Create or select a YouTube channel, then reconnect.", "no-refresh-token":"Google did not provide a refresh token. Remove ShortsFlow access from your Google Account permissions, then connect again.", "encryption-key":"The token encryption key is invalid. Set YOUTUBE_TOKEN_ENCRYPTION_KEY to Base64 for exactly 32 random bytes in Pages.",database:"Google authorized the channel, but ShortsFlow could not save the connection in its database. Check the Pages D1 binding and migration 0012.",callback:"The OAuth callback failed unexpectedly. Check the Pages Function logs for youtube_oauth_callback."};setMessage(messages[reason]||"YouTube connection failed ("+(reason||"unknown")+"). Try connecting again.",true);},0);}
})();