(() => {
 const $=s=>document.querySelector(s), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const stamp=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleString([],{dateStyle:"medium",timeStyle:"short"});};
 const sec=v=>{const n=Math.max(0,Math.floor(Number(v)||0));return Math.floor(n/60)+":"+String(n%60).padStart(2,"0");};
 let items=[],busy=false,loaded=false;
 function ensure(){
  if($("#review-workspace"))return;
  const panel=document.createElement("section");panel.id="review-workspace";panel.className="review-workspace hidden";
  panel.innerHTML=`
   <div class="review-hero"><div><span class="review-kicker">HUMAN APPROVAL GATE</span><h2>Nothing goes live<br><em>without your say.</em></h2><p>Watch the exact rendered file, check its metadata, then approve or send it back. Every decision is tied to this specific render and edit version.</p></div><div class="review-lock"><span>↗</span><b>Publishing locked</b><small>Approval is not an upload</small></div></div>
   <div class="review-toolbar"><div><span class="review-kicker">FINAL QUALITY CHECK</span><h3>Ready for your review</h3><p id="review-summary">Only current renders appear here.</p></div><button class="text-button" id="review-refresh">↻ Refresh</button></div>
   <div id="review-list" class="review-list"><div class="review-empty"><b>Loading review queue…</b><p>Checking the latest rendered clips.</p></div></div>`;
  $(".page-content")?.append(panel);$("#review-refresh")?.addEventListener("click",()=>load(true));
 }
 function render(){
  const list=$("#review-list");if(!list)return;
  const pending=items.filter(x=>x.decision==="pending");
  $("#review-summary").textContent=items.length?items.length+" current render"+(items.length===1?"":"s")+" · "+pending.length+" awaiting your decision":"No current renders waiting for review";
  if(!items.length){list.innerHTML='<div class="review-empty"><div class="review-empty-icon">◉</div><b>Nothing to review yet</b><p>When a clip has a fresh render, it will appear here. Previous or outdated renders cannot be approved.</p><button class="secondary-button" id="review-go-library">Open Content Library →</button></div>';$("#review-go-library")?.addEventListener("click",()=>document.querySelector('.nav-item[data-view="library"]')?.click());return;}
  list.innerHTML=items.map(x=>{
   const decision=x.decision,done=decision!=="pending";
   const state=decision==="approved"?"Approved":decision==="rejected"?"Rejected":decision==="changes_requested"?"Changes requested":"Awaiting decision";
   return `<article class="review-card" data-clip="${esc(x.clipId)}" data-asset="${esc(x.assetId)}">
    <div class="review-video"><video controls playsinline preload="metadata" src="${esc(x.previewUrl)}"></video><span class="review-video-tag">CURRENT RENDER · V${x.assetVersion}</span></div>
    <div class="review-detail">
     <div class="review-state-row"><span class="review-kicker">CLIP REVIEW</span><span class="review-decision ${done?"review-done":"review-pending"}">${state}</span></div>
     <h4>${esc(x.title)}</h4><p class="review-source">${esc(x.sourceTitle)} · ${sec(x.startSeconds)}–${sec(x.endSeconds)} · ${Math.round(x.durationSeconds)} sec</p>
     <div class="review-version-line"><span>Render v${x.assetVersion}</span><span>Metadata v${x.metadataVersion}</span><span>${stamp(x.renderedAt)}</span></div>
     <div class="review-meta"><b>Caption</b><p>${esc(x.caption||"No caption added.")}</p>${x.hashtags?'<p class="review-tags">'+esc(x.hashtags)+'</p>':""}</div>
     <label class="review-notes-label" for="review-note-${esc(x.clipId)}">${done?"Review note":"Notes (required when requesting changes)"}</label>
     <textarea id="review-note-${esc(x.clipId)}" class="review-notes" rows="2" maxlength="2000" placeholder="Add feedback for this clip…">${esc(x.decision==="pending"?"":x.notes)}</textarea>
     <div class="review-actions"><a class="secondary-button" href="${esc(x.downloadUrl)}">↓ Download render</a>${done?'<button class="secondary-button" data-action="reopen">Review again</button>':`<button class="secondary-button" data-action="changes">Request changes</button><button class="secondary-button review-reject" data-action="reject">Reject</button><button class="primary-button" data-action="approve">Approve clip</button>`}</div>
     <p class="review-footnote">Approval only records your decision. It does not publish or upload this video.</p>
    </div></article>`;
  }).join("");
  list.querySelectorAll("[data-action]").forEach(btn=>btn.addEventListener("click",()=>handle(btn)));
 }
 async function handle(btn){
  const card=btn.closest(".review-card"),clipId=card.dataset.clip,assetId=card.dataset.asset,action=btn.dataset.action;
  if(action==="reopen"){const item=items.find(x=>x.clipId===clipId);if(item){item.decision="pending";item.notes="";render();}return;}
  const decision=action==="approve"?"approved":action==="reject"?"rejected":"changes_requested";
  const notes=card.querySelector(".review-notes").value.trim();
  if(decision!=="approved"&&!notes){card.querySelector(".review-notes").focus();card.querySelector(".review-notes").setCustomValidity("Add a note before sending this decision.");card.querySelector(".review-notes").reportValidity();return;}
  card.querySelector(".review-notes").setCustomValidity("");
  if(busy)return;busy=true;btn.disabled=true;btn.textContent="Saving…";
  try{
   const response=await fetch("/api/review",{method:"POST",headers:{"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({clipId,assetId,decision,notes})});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not save your decision.");
   const item=items.find(x=>x.clipId===clipId);if(item){item.decision=decision;item.notes=notes;}render();
  }catch(e){window.alert(e.message||"Review could not be saved.");btn.disabled=false;btn.textContent=action==="approve"?"Approve clip":action==="reject"?"Reject":"Request changes";}
  finally{busy=false;}
 }
 async function load(force=false){
  ensure();if(busy)return;
  if(!loaded||force)$("#review-list").innerHTML='<div class="review-empty"><b>Refreshing review queue…</b><p>Loading current renders and review status.</p></div>';
  try{const response=await fetch("/api/review",{headers:{accept:"application/json"}}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not load review queue.");items=Array.isArray(data.items)?data.items:[];loaded=true;render();}
  catch(e){$("#review-list").innerHTML=`<div class="review-empty"><b>Review queue unavailable</b><p>${esc(e.message)}</p><button class="secondary-button" id="review-retry">Try again</button></div>`;$("#review-retry")?.addEventListener("click",()=>load(true));}
 }
 document.addEventListener("shortsflow:view",e=>{if(e.detail?.view==="review"){ensure();$("#review-workspace").classList.remove("hidden");load();}else $("#review-workspace")?.classList.add("hidden");});
 ensure();
})();