(() => {
 const $=s=>document.querySelector(s),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 let state={connection:null,jobs:[],eligible:[],eligibleCount:null,loading:false,statusLoading:false,profiles:[],activeProfileId:null,metrics:null,retention:null,activeTool:"calendar"};
 let calendarCursor=new Date();
 let selectedCalendarDay=localDayKey(new Date());
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
   <section class="publisher-section"><div class="publisher-section-head"><div><span class="publisher-kicker">PUBLISHING HISTORY</span><h3>Upload queue</h3><p>Track scheduled and completed YouTube jobs.</p></div><button class="text-button" id="publisher-refresh">↻ Refresh</button></div><div id="publisher-jobs" class="publisher-jobs"><div class="publisher-empty">Loading publishing history…</div></div></section>
   <section class="publisher-section publisher-tools" id="publisher-tools">
    <div class="publisher-section-head"><div><span class="publisher-kicker">PUBLISHER WORKSPACE</span><h3>Plan, review & monitor</h3><p>These tools read your existing publishing and library data. They do not create or publish jobs.</p></div></div>
    <div class="publisher-tool-tabs" role="tablist" aria-label="Publisher tools">
     <button type="button" class="publisher-tool-tab active" data-tool-tab="calendar" role="tab" aria-selected="true">Calendar</button>
     <button type="button" class="publisher-tool-tab" data-tool-tab="checklist" role="tab" aria-selected="false">Pre-publish checklist</button>
     <button type="button" class="publisher-tool-tab" data-tool-tab="ranking" role="tab" aria-selected="false">Performance ranking</button>
     <button type="button" class="publisher-tool-tab" data-tool-tab="insights" role="tab" aria-selected="false">Growth Insights</button>
     <button type="button" class="publisher-tool-tab" data-tool-tab="export" role="tab" aria-selected="false">Metadata export</button>
     <button type="button" class="publisher-tool-tab" data-tool-tab="notifications" role="tab" aria-selected="false">Notifications <span id="publisher-notification-count">0</span></button>
    </div>
    <div class="publisher-tool-panel" data-tool-panel="calendar">
     <div class="publisher-calendar-toolbar"><div><span class="publisher-kicker">PUBLISHING SCHEDULE</span><h4 id="publisher-calendar-month">—</h4></div><div class="publisher-calendar-actions"><button type="button" class="text-button" data-calendar-move="-1" aria-label="Previous month">←</button><button type="button" class="text-button" data-calendar-move="today">Today</button><button type="button" class="text-button" data-calendar-move="1" aria-label="Next month">→</button></div></div>
     <div class="publisher-calendar-grid" id="publisher-calendar-grid" aria-label="Publishing calendar"></div>
     <div class="publisher-calendar-day"><div class="publisher-calendar-day-head"><b id="publisher-calendar-selected-title">Selected day</b><small id="publisher-calendar-selected-count">0 items</small></div><div id="publisher-calendar-day-list" class="publisher-calendar-events"></div></div>
     <small class="publisher-tool-note">Calendar dates come from the current queue’s scheduled_at / created_at timestamps. It does not change an upload schedule.</small>
    </div>
    <div class="publisher-tool-panel hidden" data-tool-panel="checklist">
     <div class="publisher-checklist-head"><div><span class="publisher-kicker">LOCAL PREFLIGHT</span><h4>Check this upload before queueing</h4><p>Choose a render and edit the upload form above. This checklist is informational; the server still rechecks the latest approval when you submit.</p></div><span id="publisher-checklist-status" class="publisher-checklist-status">Waiting</span></div>
     <div id="publisher-checklist-items" class="publisher-checklist-items"></div>
    </div>
    <div class="publisher-tool-panel hidden" data-tool-panel="ranking">
     <div class="publisher-calendar-toolbar"><div><span class="publisher-kicker">CHANNEL PERFORMANCE</span><h4>Top published Shorts</h4><p>Ranked by the latest available lifetime view-count snapshots.</p></div><span id="publisher-ranking-updated" class="publisher-tool-muted">Not synced yet</span></div>
     <div id="publisher-ranking-list" class="publisher-ranking-list"><div class="publisher-empty">Load YouTube metrics to see the ranking.</div></div>
     <small class="publisher-tool-note">Views, likes and comments are Data API lifetime totals for the published videos returned by the existing analytics endpoint. Average viewed is shown only when YouTube Analytics has a value for that video.</small>
    </div>
    <div class="publisher-tool-panel hidden" data-tool-panel="insights">
     <div class="publisher-calendar-toolbar"><div><span class="publisher-kicker">GROWTH INTELLIGENCE</span><h4>Insights from your channel</h4><p>Read-only analysis of your existing YouTube snapshots and publishing history. No forecasts or industry benchmarks.</p></div><span id="publisher-insights-updated" class="publisher-tool-muted">Waiting for metrics</span></div>
     <div id="publisher-insights-summary" class="publisher-insights-summary"></div>
     <div id="publisher-insights-cards" class="publisher-insights-cards"><div class="publisher-empty">Sync views to build your first set of channel insights.</div></div>
     <small class="publisher-tool-note">View totals are lifetime counts for Shorts published in the last 90 days. Changes since the previous sync compare the latest two snapshots; YouTube may revise counts. Retention is best compared between Shorts of similar length and format.</small>
    </div>
    <div class="publisher-tool-panel hidden" data-tool-panel="export">
     <div class="publisher-export-card"><div><span class="publisher-kicker">CONTENT LIBRARY · CSV</span><h4>Export publish-ready metadata</h4><p>Download titles, descriptions, tags, hashtags, hooks and source information from your existing Content Library. No videos are downloaded or uploaded.</p></div><label class="publisher-export-option"><input type="checkbox" id="publisher-export-include-old"> Include previous metadata versions</label><button type="button" class="primary-button" id="publisher-export-csv">Export metadata CSV <span>↓</span></button><small id="publisher-export-status" class="publisher-tool-note">Default export includes current, publish-ready versions only.</small></div>
    </div>
    <div class="publisher-tool-panel hidden" data-tool-panel="notifications">
     <div class="publisher-calendar-toolbar"><div><span class="publisher-kicker">QUEUE ACTIVITY</span><h4>Publishing notifications</h4><p>Alerts are derived from existing job statuses; no new notification service or polling loop is added.</p></div><button type="button" class="text-button" id="publisher-notifications-refresh">↻ Refresh list</button></div>
     <div id="publisher-notifications-list" class="publisher-notifications-list"><div class="publisher-empty">No publishing activity yet.</div></div>
    </div>
   </section>`;
  $(".page-content")?.append(panel);
  $("#youtube-connect").addEventListener("click",e=>{e.preventDefault();window.location.href="/api/youtube/connect";});
  $("#publisher-refresh").addEventListener("click",load);
  $("#publisher-tools").addEventListener("click",event=>{
   const tab=event.target.closest("[data-tool-tab]");
   if(tab){state.activeTool=tab.dataset.toolTab;renderPublisherTools();return;}
   const move=event.target.closest("[data-calendar-move]");
   if(move){
    const value=move.dataset.calendarMove;
    if(value==="today"){calendarCursor=new Date();selectedCalendarDay=localDayKey(new Date());}
    else calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+Number(value),1);
    renderCalendar();return;
   }
   const day=event.target.closest("[data-calendar-day]");
   if(day){selectedCalendarDay=day.dataset.calendarDay;renderCalendar();}
  });
  $("#publisher-export-csv").addEventListener("click",exportPublisherMetadata);
  $("#publisher-notifications-refresh").addEventListener("click",renderNotifications);
  $("#publisher-form").addEventListener("input",renderQualityChecklist);
  $("#publisher-form").addEventListener("change",renderQualityChecklist);
  $("#publisher-metrics-sync").addEventListener("click",syncMetrics);
   $("#publisher-clip").addEventListener("change",()=>{const item=state.eligible.find(x=>x.clipId===$("#publisher-clip").value);if(item){$("#publisher-title").value=item.title||"";$("#publisher-description").value=item.caption||"";}renderMetadataPreview();renderQualityChecklist();});
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
   renderPerformanceRanking();if(state.activeTool==="insights")renderGrowthInsights();
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
   renderPerformanceRanking();if(state.activeTool==="insights")renderGrowthInsights();
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
 function renderConnectionStats(){
  const c=state.connection;
  $("#youtube-channel-title").textContent=c?.connected?c.channelTitle:"YouTube channel not connected";
  $("#youtube-channel-detail").textContent=c?.connected?"Connected · "+date(c.connectedAt):"Connect your Google account to prepare YouTube uploads.";
  $("#youtube-connect").textContent=c?.connected?"Reconnect YouTube ↗":"Connect YouTube ↗";
  $("#youtube-connect").classList.toggle("connected",!!c?.connected);
  $("#publisher-eligible").textContent=state.eligibleCount===null?state.eligible.length:state.eligibleCount;
  $("#publisher-queued").textContent=state.jobs.filter(j=>["queued","uploading","processing"].includes(j.status)).length;
  $("#publisher-published").textContent=state.jobs.filter(j=>j.status==="published").length;
  $("#publisher-submit").disabled=!c?.connected||!state.eligible.length;
 }
 function renderJobs(){
  const list=$("#publisher-jobs");
  if(!list)return;
  if(!state.jobs.length){list.innerHTML='<div class="publisher-empty">No publishing jobs yet. Approved clips will appear in the planner above.</div>';}
  else{
   list.innerHTML=state.jobs.map(j=>{const status=String(j.status||"").trim().toLowerCase();return '<article class="publisher-job"><div class="publisher-job-main"><b>'+esc(j.title||j.clip_title||"YouTube Short")+'</b><span>'+esc(date(j.scheduled_at))+'</span>'+(status==="failed"&&j.last_error?'<small class="publisher-error-detail">'+esc(j.last_error)+'</small>':"")+'</div><span class="publisher-status status-'+esc(status)+'">'+esc(status||"unknown")+'</span>'+(j.platform_url?'<a href="'+esc(j.platform_url)+'" target="_blank" rel="noopener">Watch ↗</a>':"")+(status==="queued"?'<button class="text-button" data-cancel="'+esc(j.id)+'">Cancel</button>':"")+(status==="failed"?'<button class="publisher-delete-button" data-delete="'+esc(j.id)+'" aria-label="Delete failed publishing job">Delete failed job</button>':"")+'</article>'}).join("");
   list.querySelectorAll("[data-cancel]").forEach(btn=>btn.addEventListener("click",()=>cancel(btn.dataset.cancel)));
   list.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>removeFailed(btn.dataset.delete)));
  }
 }
 function render(){
  renderConnectionStats();
  const select=$("#publisher-clip"),current=select.value;
  select.innerHTML='<option value="">Choose an approved render…</option>'+state.eligible.map(x=>'<option value="'+esc(x.clipId)+'">'+esc(x.title)+' · '+Math.round(x.durationSeconds)+' sec</option>').join("");
  if(state.eligible.some(x=>x.clipId===current))select.value=current;
  renderJobs();
  renderPublisherTools();
 }

 function localDayKey(value){
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime()))return "";
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
 }
 function renderPublisherTools(){
  const root=$("#publisher-tools");if(!root)return;
  root.querySelectorAll("[data-tool-tab]").forEach(button=>{
   const active=button.dataset.toolTab===state.activeTool;
   button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));
  });
  root.querySelectorAll("[data-tool-panel]").forEach(panel=>panel.classList.toggle("hidden",panel.dataset.toolPanel!==state.activeTool));
  renderCalendar();renderQualityChecklist();renderPerformanceRanking();renderNotifications();
  if(state.activeTool==="insights")renderGrowthInsights();
 }
 function renderCalendar(){
  const grid=$("#publisher-calendar-grid");if(!grid)return;
  const year=calendarCursor.getFullYear(),month=calendarCursor.getMonth();
  $("#publisher-calendar-month").textContent=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(calendarCursor);
  const first=new Date(year,month,1),start=new Date(year,month,1-first.getDay());
  const weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const cells=weekdays.map(day=>'<div class="publisher-calendar-weekday">'+day+'</div>');
  const grouped=new Map();
  for(const job of state.jobs){
   const key=localDayKey(job.scheduled_at||job.created_at);if(!key)continue;
   if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(job);
  }
  for(let i=0;i<42;i++){
   const day=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),key=localDayKey(day),items=grouped.get(key)||[];
   const outside=day.getMonth()!==month,selected=key===selectedCalendarDay,today=key===localDayKey(new Date());
   cells.push('<button type="button" class="publisher-calendar-day-cell'+(outside?' outside':'')+(selected?' selected':'')+(today?' today':'')+'" data-calendar-day="'+key+'"><span>'+day.getDate()+'</span><small>'+items.length+'</small>'+items.slice(0,2).map(job=>'<i class="publisher-calendar-dot status-'+esc(String(job.status||"").toLowerCase())+'">'+esc(job.title||job.clip_title||"YouTube Short")+'</i>').join("")+(items.length>2?'<em>+'+(items.length-2)+' more</em>':"")+'</button>');
  }
  grid.innerHTML=cells.join("");
  let selectedDate=new Date(selectedCalendarDay+"T12:00:00");
  if(Number.isNaN(selectedDate.getTime()))selectedDate=new Date(year,month,1);
  $("#publisher-calendar-selected-title").textContent=selectedDate.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const selectedItems=grouped.get(selectedCalendarDay)||[];
  $("#publisher-calendar-selected-count").textContent=selectedItems.length+" item"+(selectedItems.length===1?"":"s");
  const list=$("#publisher-calendar-day-list");
  list.innerHTML=selectedItems.length?selectedItems.map(job=>'<article class="publisher-calendar-event"><div><b>'+esc(job.title||job.clip_title||"YouTube Short")+'</b><small>'+esc(date(job.scheduled_at||job.created_at))+'</small></div><span class="publisher-status status-'+esc(String(job.status||"unknown").toLowerCase())+'">'+esc(job.status||"unknown")+'</span>'+(job.platform_url?'<a href="'+esc(job.platform_url)+'" target="_blank" rel="noopener">Watch ↗</a>':"")+'</article>').join(""):'<div class="publisher-empty">No publishing jobs on this day.</div>';
 }
 function renderQualityChecklist(){
  const list=$("#publisher-checklist-items");if(!list)return;
  const clipId=$("#publisher-clip")?.value||"",item=state.eligible.find(x=>x.clipId===clipId);
  const title=$("#publisher-title")?.value.trim()||"",description=$("#publisher-description")?.value||"",tags=($("#publisher-tags")?.value||"").split(",").map(v=>v.trim()).filter(Boolean);
  const tagLength=tags.join(", ").length,schedule=$("#publisher-schedule")?.value||"",scheduledDate=schedule?new Date(schedule):null;
  const scheduleOk=!schedule||(scheduledDate&&Number.isFinite(scheduledDate.getTime())&&scheduledDate.getTime()>=Date.now()+60000);
  const checks=[
   ["Current approved render",Boolean(item),item?"Approved render selected":"Select a render approved in Review Center"],
   ["YouTube channel",Boolean(state.connection?.connected),state.connection?.connected?"Channel connected":"Connect a YouTube channel"],
   ["Title",title.length>=1&&title.length<=100,title.length+"/100 characters"],
   ["Description",description.length<=5000,description.length+"/5000 characters"],
   ["Tags",tags.length<=30&&tagLength<=500,tags.length+" tags · "+tagLength+"/500 characters"],
   ["Schedule",Boolean(scheduleOk),!schedule?"Publish as soon as the queue runs":scheduleOk?"Scheduled time is at least one minute ahead":"Choose a future time at least one minute ahead"],
   ["Visibility",["private","unlisted","public"].includes($("#publisher-privacy")?.value),($("#publisher-privacy")?.value||"private")+" visibility"]
  ];
  const passed=checks.filter(x=>x[1]).length;
  const status=$("#publisher-checklist-status");
  status.textContent=passed+"/"+checks.length+" checks passed";
  status.classList.toggle("ready",passed===checks.length);
  list.innerHTML=checks.map(check=>'<article class="publisher-check-item '+(check[1]?"passed":"pending")+'"><span class="publisher-check-icon">'+(check[1]?"✓":"!")+'</span><div><b>'+esc(check[0])+'</b><small>'+esc(check[2])+'</small></div><strong>'+(check[1]?"Ready":"Check")+'</strong></article>').join("");
 }
 function renderPerformanceRanking(){
  const list=$("#publisher-ranking-list");if(!list)return;
  const videos=(state.metrics?.videos||[]).filter(video=>video.views!==null&&video.views!==undefined).slice().sort((a,b)=>Number(b.views)-Number(a.views)).slice(0,10);
  const retention=new Map((state.retention?.videos||[]).map(video=>[video.job_id,video]));
  $("#publisher-ranking-updated").textContent=state.metrics?.lastSyncedAt?"Synced "+date(state.metrics.lastSyncedAt):"Not synced yet";
  list.innerHTML=videos.length?videos.map((video,index)=>{
   const retentionRow=retention.get(video.job_id),percentage=retentionRow?.average_view_percentage;
   const url=typeof video.platform_url==="string"&&/^https:\/\/(www\.)?youtube\.com\//i.test(video.platform_url)?video.platform_url:"";
   return '<article class="publisher-ranking-row"><span class="publisher-metric-rank">'+(index+1)+'</span><div class="publisher-ranking-main"><b>'+esc(video.title||video.clip_title||"YouTube Short")+'</b><small>'+esc(video.source_title||"")+'</small></div><strong>'+metricNumber(video.views)+' <small>views</small></strong><span class="publisher-ranking-secondary">'+metricNumber(video.likes)+' likes · '+metricNumber(video.comments)+' comments</span><span class="publisher-ranking-secondary">'+(percentage===null||percentage===undefined?"—":Number(percentage).toFixed(1)+"% viewed")+'</span>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">Watch ↗</a>':"")+'</article>';
  }).join(""):'<div class="publisher-empty">No published video snapshots yet. Use “Sync views” in the growth tracker above.</div>';
 }

 function renderGrowthInsights(){
  const summary=$("#publisher-insights-summary"),cards=$("#publisher-insights-cards"),updated=$("#publisher-insights-updated");
  if(!summary||!cards)return;
  const now=Date.now(),metrics=state.metrics||{},allVideos=Array.isArray(metrics.videos)?metrics.videos:[];
  const recent=allVideos.filter(video=>{
   const published=Date.parse(video.published_at||"");
   return Number.isFinite(published)&&published<=now&&now-published<=90*86400000&&video.views!==null&&video.views!==undefined;
  });
  const deltaRows=recent.filter(video=>video.previous_views!==null&&video.previous_views!==undefined&&Number.isFinite(Number(video.views))&&Number.isFinite(Number(video.previous_views))).map(video=>({
   video,views:Number(video.views)-Number(video.previous_views),
   likes:video.previous_likes===null||video.previous_likes===undefined?null:Number(video.likes||0)-Number(video.previous_likes),
   comments:video.previous_comments===null||video.previous_comments===undefined?null:Number(video.comments||0)-Number(video.previous_comments)
  }));
  const netViews=deltaRows.reduce((sum,row)=>sum+row.views,0),netLikes=deltaRows.reduce((sum,row)=>sum+(row.likes??0),0),netComments=deltaRows.reduce((sum,row)=>sum+(row.comments??0),0);
  const bestReach=recent.slice().sort((x,y)=>Number(y.views)-Number(x.views))[0]||null;
  const measured=(state.retention?.videos||[]).filter(v=>v.average_view_percentage!==null&&v.average_view_percentage!==undefined&&Number.isFinite(Number(v.average_view_percentage)));
  const bestRetention=measured.slice().sort((x,y)=>Number(y.average_view_percentage)-Number(x.average_view_percentage))[0]||null;
  const published=(state.jobs||[]).filter(j=>String(j.status||"").toLowerCase()==="published").map(job=>({job,time:Date.parse(job.updated_at||job.created_at||"")})).filter(x=>Number.isFinite(x.time)&&x.time<=now);
  const current30=published.filter(x=>now-x.time<=30*86400000),previous30=published.filter(x=>now-x.time>30*86400000&&now-x.time<=60*86400000);
  const signed=value=>(value>0?"+":"")+metricNumber(value);
  const tiles=[
   {label:"90-day publishing cohort",value:metrics.totals?metricNumber(metrics.totals.views):"—",detail:"Lifetime views on Shorts published in the last 90 days"},
   {label:"Views since last sync",value:deltaRows.length?signed(netViews)+" views":"Need another sync",detail:deltaRows.length?deltaRows.length+" Shorts have two snapshots":"Sync views again later to compare"},
   {label:"Best average viewed",value:bestRetention?Number(bestRetention.average_view_percentage).toFixed(1)+"%":"—",detail:bestRetention?(bestRetention.title||bestRetention.clip_title||"Best measured Short"):"No retention data yet"},
   {label:"Published in last 30 days",value:String(current30.length),detail:previous30.length+" in the previous 30 days"}
  ];
  summary.innerHTML=tiles.map(t=>'<article class="publisher-insight-stat"><span>'+esc(t.label)+'</span><strong>'+esc(t.value)+'</strong><small>'+esc(t.detail)+'</small></article>').join("");
  const syncParts=[];if(metrics.lastSyncedAt)syncParts.push("Views synced "+date(metrics.lastSyncedAt));if(state.retention?.lastSyncedAt)syncParts.push("Retention synced "+date(state.retention.lastSyncedAt));
  if(updated)updated.textContent=syncParts.length?syncParts.join(" · "):"No metrics synced yet";
  const entries=[];
  if(bestReach){const title=bestReach.title||bestReach.clip_title||"Untitled Short",source=bestReach.source_title?" Source: "+bestReach.source_title+".":"";entries.push({kind:"Reach leader",body:title+" has "+metricNumber(bestReach.views)+" lifetime views."+source,detail:"Use it as a comparison point for your next experiment; this does not guarantee the same result."});}
  if(bestRetention){const title=bestRetention.title||bestRetention.clip_title||"Untitled Short",pct=Number(bestRetention.average_view_percentage).toFixed(1)+"%",duration=bestRetention.average_view_duration!==null&&bestRetention.average_view_duration!==undefined?" Average view duration: "+durationLabel(bestRetention.average_view_duration)+".":"";entries.push({kind:"Retention leader",body:title+" currently has the highest measured average viewed at "+pct+"."+duration,detail:"Compare against Shorts with similar length and format before reusing its structure."});}
  if(deltaRows.length){const leader=deltaRows.slice().sort((x,y)=>y.views-x.views)[0],net=netViews>=0?"+"+metricNumber(netViews):metricNumber(netViews),leaderTitle=leader?.video?.title||leader?.video?.clip_title||"a tracked Short";entries.push({kind:"Snapshot momentum",body:"Net view-count change since the previous manual sync: "+net+".",detail:"The largest individual change was "+signed(leader.views)+" views for "+leaderTitle+". Likes changed "+signed(netLikes)+" and comments changed "+signed(netComments)+". YouTube can revise lifetime counts."});}
  else entries.push({kind:"Build your baseline",body:"There are not yet two view snapshots for the same published Shorts.",detail:"Use Sync views again after your next measurement interval. Growth Insights does not add background polling."});
  if(published.length){const diff=current30.length-previous30.length,comparison=diff>0?"up by "+diff:diff<0?"down by "+Math.abs(diff):"unchanged";entries.push({kind:"Publishing rhythm",body:"You published "+current30.length+" Shorts in the last 30 days, "+comparison+" versus the previous 30 days.",detail:"Use your own publishing history to plan the next schedule; no fixed posting target is assumed."});}
  else entries.push({kind:"Publishing rhythm",body:"No published Shorts are recorded in the current Publisher history.",detail:"Once a Short is published and appears in the queue history, this panel can compare your cadence."});
  if(!recent.length&&!measured.length&&!published.length){cards.innerHTML='<div class="publisher-empty">Connect YouTube and sync channel metrics to unlock Growth Insights. This panel uses existing snapshots and does not upload, publish or alter videos.</div>';return;}
  cards.innerHTML=entries.map((entry,index)=>'<article class="publisher-insight-card"><span class="publisher-insight-mark">'+String(index+1)+'</span><div><b>'+esc(entry.kind)+'</b><p>'+esc(entry.body)+'</p><small>'+esc(entry.detail)+'</small></div></article>').join("");
 }
 function renderNotifications(){
  const list=$("#publisher-notifications-list");if(!list)return;
  const jobs=state.jobs||[],entries=[];
  for(const job of jobs){
   const status=String(job.status||"").toLowerCase();
   if(status==="failed")entries.push({job,kind:"Failed upload",detail:job.last_error||"The upload failed. Review the job before retrying.",when:job.updated_at||job.created_at,priority:0});
   else if(status==="published")entries.push({job,kind:"Published successfully",detail:"Your Short is available on YouTube.",when:job.updated_at||job.created_at,priority:1});
   else if(["queued","uploading","processing"].includes(status))entries.push({job,kind:status==="queued"?"Upload queued":status==="uploading"?"Upload in progress":"Upload processing",detail:job.scheduled_at?"Scheduled / queue time: "+date(job.scheduled_at):"Publishing job is active.",when:job.updated_at||job.created_at,priority:2});
  }
  entries.sort((a,b)=>new Date(b.when||0)-new Date(a.when||0));
  const recent=entries.slice(0,20),attention=jobs.filter(job=>String(job.status||"").toLowerCase()==="failed").length;
  $("#publisher-notification-count").textContent=String(attention);
  list.innerHTML=recent.length?recent.map(entry=>'<article class="publisher-notification '+(entry.priority===0?"is-warning":entry.priority===1?"is-success":"")+'"><span class="publisher-notification-mark">'+(entry.priority===0?"!":entry.priority===1?"✓":"◷")+'</span><div><b>'+esc(entry.kind)+' · '+esc(entry.job.title||entry.job.clip_title||"YouTube Short")+'</b><small>'+esc(entry.detail)+'</small><time>'+esc(date(entry.when))+'</time></div><span class="publisher-status status-'+esc(String(entry.job.status||"unknown").toLowerCase())+'">'+esc(entry.job.status||"unknown")+'</span></article>').join(""):'<div class="publisher-empty">No queued, failed or published activity yet.</div>';
 }
 function csvCell(value){
  let text=Array.isArray(value)?value.join(", "):value===null||value===undefined?"":String(value);
  return '"'+text.replace(/"/g,'""')+'"';
 }
 async function exportPublisherMetadata(){
  const button=$("#publisher-export-csv"),status=$("#publisher-export-status");
  button.disabled=true;button.textContent="Preparing CSV…";status.textContent="Reading your existing Content Library…";
  try{
   const response=await fetch("/api/library",{headers:{accept:"application/json"}});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not read Content Library.");
   const includeOld=$("#publisher-export-include-old").checked;
   const assets=(data.assets||[]).filter(asset=>asset.isPublishReady&&(includeOld||asset.isCurrent));
   if(!assets.length)throw new Error("No publish-ready metadata packages match this export filter.");
   const headers=["title","description","hashtags","tags","hook","voice_script","source_title","source_references","clip_id","asset_id","render_version","metadata_version","current_version","is_current","duration_seconds","publish_ready"];
   const rows=assets.map(asset=>[
    asset.title,asset.platformDescription,asset.hashtags,(asset.platformTags||[]),asset.hook,asset.spokenScript,asset.sourceTitle,
    (asset.sourceReferences||[]).map(source=>(source.publisher?source.publisher+": ":"")+(source.url||source.title||"")).join(" | "),
    asset.clipId,asset.id,asset.version,asset.metadataVersion,asset.currentMetadataVersion,asset.isCurrent?"yes":"no",asset.durationSeconds,"yes"
   ]);
   const csv="\uFEFF"+[headers,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n");
   const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");
   anchor.href=url;anchor.download="shortsflow-publisher-metadata-"+new Date().toISOString().slice(0,10)+".csv";
   document.body.append(anchor);anchor.click();anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   status.textContent="Exported "+assets.length+" metadata package"+(assets.length===1?"":"s")+". No video files were included.";
  }catch(error){status.textContent=error.message||"Metadata export failed.";setMessage(status.textContent,true);}
  finally{button.disabled=false;button.innerHTML='Export metadata CSV <span>↓</span>';}
 }

 async function refreshQueueStatus(){
  const panel=$("#publisher-workspace");
  if(!panel||panel.classList.contains("hidden")||document.visibilityState==="hidden"||state.loading||state.statusLoading)return;
  state.statusLoading=true;
  try{
   const response=await fetch("/api/youtube",{headers:{accept:"application/json"}});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"Could not refresh publishing status.");
   state.connection=data.connection;
   state.jobs=data.jobs||[];
   state.eligibleCount=Number(data.eligibleCount||0);
   renderConnectionStats();
   renderJobs();
   if(state.activeTool==="calendar")renderCalendar();
   renderNotifications();
   if(state.activeTool==="insights")renderGrowthInsights();
  }catch(error){
   // Keep the last known queue state; manual refresh surfaces actionable errors.
  }finally{
   state.statusLoading=false;
  }
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
   state.connection=p.connection;state.jobs=p.jobs||[];state.eligibleCount=Number(p.eligibleCount||0);state.eligible=(r.items||[]).filter(x=>x.decision==="approved");state.profiles=b.profiles||[];state.activeProfileId=b.activeProfileId||null;
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
   const payload={clipId:$("#publisher-clip").value,title:$("#publisher-title").value,description:$("#publisher-description").value,privacyStatus:$("#publisher-privacy").value,scheduledAt:scheduled,tags:$("#publisher-tags").value.split(",").map(x=>x.trim()).filter(Boolean)};
   const send=()=>fetch("/api/youtube",{method:"POST",headers:{"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify(payload)});
   let response=await send(),data=await response.json();
   if(!response.ok||!data.ok){
    if(response.status===409&&data.code==="CLIP_OVERLAP"){
     const conflict=data.conflict||{};
     const range=Number.isFinite(Number(conflict.startSeconds))&&Number.isFinite(Number(conflict.endSeconds))
      ?Number(conflict.startSeconds).toFixed(1)+"s–"+Number(conflict.endSeconds).toFixed(1)+"s":"an existing source segment";
     const title=conflict.title||"another queued or published clip";
     if(!window.confirm("Possible duplicate clip detected.\n\n"+title+" ("+range+") already exists in your YouTube queue/history.\n\nQueue this clip anyway?"))throw new Error("Upload was not queued. The possible duplicate was left unchanged.");
     payload.allowDuplicateOverlap=true;
     response=await send();data=await response.json();
    }
    if(!response.ok||!data.ok)throw new Error(data.error||"Could not queue upload.");
   }
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
 setInterval(refreshQueueStatus,60000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshQueueStatus();});
 const params=new URLSearchParams(location.search);if(params.has("youtube")){const result=params.get("youtube"),reason=params.get("reason");history.replaceState({}, "", location.pathname);if(result==="connected")setTimeout(()=>{ensure();load();setMessage("YouTube channel connected successfully.");},0);else if(result!=="")setTimeout(()=>{ensure();const messages={denied:"Google connection was cancelled.",setup:"OAuth configuration is incomplete. Check the YouTube environment variables in Cloudflare Pages.", "invalid-state":"The Google sign-in session expired or did not match. Start Connect YouTube again.",token:"Google rejected the authorization-code exchange. Check the OAuth client ID, client secret, and exact redirect URI.", "channel-api":"Google sign-in succeeded, but YouTube Data API could not read the channel. Confirm YouTube Data API v3 is enabled in the same Google Cloud project.", "no-channel":"This Google account does not have an accessible YouTube channel. Create or select a YouTube channel, then reconnect.", "no-refresh-token":"Google did not provide a refresh token. Remove ShortsFlow access from your Google Account permissions, then connect again.", "encryption-key":"The token encryption key is invalid. Set YOUTUBE_TOKEN_ENCRYPTION_KEY to Base64 for exactly 32 random bytes in Pages.",database:"Google authorized the channel, but ShortsFlow could not save the connection in its database. Check the Pages D1 binding and migration 0012.",callback:"The OAuth callback failed unexpectedly. Check the Pages Function logs for youtube_oauth_callback."};setMessage(messages[reason]||"YouTube connection failed ("+(reason||"unknown")+"). Try connecting again.",true);},0);}
})();