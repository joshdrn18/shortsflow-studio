(() => {
 const $=s=>document.querySelector(s);let busy=false,activeCancel=null;
 function drawCover(ctx,v,x,y,w,h){const sw=v.videoWidth,sh=v.videoHeight;if(!sw||!sh||w<=0||h<=0)return;const ratio=w/h,sr=sw/sh;let sx=0,sy=0,cw=sw,ch=sh;if(sr>ratio){cw=sh*ratio;sx=(sw-cw)/2;}else{ch=sw/ratio;sy=(sh-ch)/2;}ctx.drawImage(v,sx,sy,cw,ch,x,y,w,h);}
 function drawVerticalComposition(ctx,v,w,h){
  const sw=v.videoWidth,sh=v.videoHeight;if(!sw||!sh)return;
  ctx.save();ctx.fillStyle="#050608";ctx.fillRect(0,0,w,h);
  ctx.filter="blur(38px) brightness(.62) saturate(1.18)";
  drawCover(ctx,v,-54,-54,w+108,h+108);
  ctx.filter="none";ctx.fillStyle="rgba(5,6,10,.20)";ctx.fillRect(0,0,w,h);ctx.restore();
  const scale=Math.min(w*.92/sw,h*.82/sh),dw=sw*scale,dh=sh*scale,x=(w-dw)/2,y=(h-dh)/2;
  ctx.save();ctx.shadowColor="rgba(0,0,0,.58)";ctx.shadowBlur=34;ctx.shadowOffsetY=10;
  ctx.fillStyle="#08090d";round(ctx,x-2,y-2,dw+4,dh+4,18);ctx.fill();ctx.restore();
  ctx.save();round(ctx,x,y,dw,dh,16);ctx.clip();ctx.drawImage(v,x,y,dw,dh);ctx.restore();
  return {x,y,w:dw,h:dh};
 }
 function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
 function drawWords(ctx,words,t,c,w,h,videoBox){
  if(!c.enabled||!Array.isArray(words)||!words.length||!Number.isFinite(t))return;
  const clean=words.map((item,index)=>({item,index,word:String(item?.word||"").replace(/<\/?b\d*\s*>|&lt;\/?b\d*\s*&gt;|(?:\\\\|\/)b\d*/gi," ").replace(/\s+/g," ").trim(),start:Number(item?.start),end:Number(item?.end)}))
   .filter(x=>x.word&&Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start);
  if(!clean.length)return;
  const active=clean.findIndex(x=>t>=x.start&&t<=x.end);
  if(active<0)return;
  const groups=[];let group=[];
  for(let i=0;i<clean.length;i++){
   const item=clean[i],prev=group[group.length-1];
   const gap=prev?item.start-prev.end:0;
   const punctuation=prev&&/[.!?…][”’"')\]]*$/.test(prev.word);
   if(group.length&&(group.length>=4||gap>.65||punctuation)){groups.push(group);group=[];}
   group.push(item);
  }
  if(group.length)groups.push(group);
  const current=groups.find(items=>items.includes(clean[active]));
  if(!current)return;
  const scale=Math.max(.82,Math.min(1.65,(Number(c.fontSize)||28)/28));
  let size=Math.round(49*scale),weight=[600,700,800,900].includes(Number(c.fontWeight))?Number(c.fontWeight):900,maxWidth=w*.86,lines=[];
  const buildLines=fontSize=>{
   ctx.font=`${weight} ${fontSize}px Manrope,Arial,sans-serif`;
   const out=[];let line=[];
   for(const token of current){
    const test=[...line,token],width=ctx.measureText(test.map(x=>x.word).join(" ")).width;
    if(line.length&&width>maxWidth){out.push(line);line=[token];}else line=test;
   }
   if(line.length)out.push(line);
   return out;
  };
  lines=buildLines(size);
  while(lines.length>2&&size>30){size-=2;lines=buildLines(size);}
  if(lines.length>2){
   const activeToken=clean[active];
   lines=lines.slice(0,2);
   if(!lines.flat().includes(activeToken))lines[1]=[activeToken];
  }
  const lh=Math.round(size*1.24),gap=10,padX=24,padY=12;
  const totalH=lines.length*lh+(lines.length-1)*gap;
  const frame=videoBox||{x:0,y:0,w,h};
  const edge=Math.max(.05,Math.min(.25,(Number(c.edgeOffset)||9)/100));const centerY=c.position==="top"?frame.y+frame.h*edge+totalH/2:c.position==="center"?frame.y+frame.h*.5:frame.y+frame.h*(1-edge)-totalH/2;
  const minY=frame.y+lh*.65,maxY=frame.y+frame.h-lh*.65;
  const top=Math.max(minY,Math.min(maxY-totalH,centerY-totalH/2));
  ctx.save();ctx.font=`${weight} ${size}px Manrope,Arial,sans-serif`;ctx.textAlign="left";ctx.textBaseline="middle";
  lines.forEach((items,i)=>{
   const widths=items.map(token=>ctx.measureText(token.word).width);
   const space=ctx.measureText(" ").width;
   const total=widths.reduce((a,b)=>a+b,0)+space*Math.max(0,items.length-1);
   let x=(w-total)/2;const y=top+i*(lh+gap)+lh/2;
   if(c.background!==false){const bw=Math.min(w*.92,total+padX*2);ctx.fillStyle="rgba(8,9,13,.88)";round(ctx,(w-bw)/2,y-lh/2-padY/2,bw,lh+padY,Math.min(14,lh*.22));ctx.fill();}
   items.forEach((token,j)=>{
    const word=token.word;
    const isActive=token===clean[active];const animDuration=Math.max(80,Math.min(300,Number(c.animationDuration)||160))/1000;const progress=isActive?Math.max(0,Math.min(1,(t-token.start)/animDuration)):1;const anim=c.animation||"pop";const alpha=anim==="fade"?progress:1;const scaleIn=anim==="pop"?.72+.28*progress:1;const slideY=anim==="slide"?(1-progress)*size*.32:0;ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x+widths[j]/2,y+slideY);ctx.scale(scaleIn,scaleIn);const drawX=-widths[j]/2;if(isActive&&c.highlightStyle==="pill"){ctx.fillStyle=c.highlight||"#b59aff";round(ctx,drawX-7,-lh*.38,widths[j]+14,lh*.76,Math.min(10,lh*.2));ctx.fill();}ctx.lineWidth=Math.max(2,size*.075);ctx.strokeStyle="rgba(0,0,0,.92)";ctx.lineJoin="round";ctx.strokeText(word,drawX,0);ctx.fillStyle=isActive&&c.highlightStyle!=="pill"?(c.highlight||"#b59aff"):(c.color||"#fff");ctx.fillText(word,drawX,0);if(isActive&&c.highlightStyle==="underline"){ctx.strokeStyle=c.highlight||"#b59aff";ctx.lineWidth=Math.max(3,size*.09);ctx.beginPath();ctx.moveTo(drawX,lh*.42);ctx.lineTo(drawX+widths[j],lh*.42);ctx.stroke();}ctx.restore();
    x+=widths[j]+space;
   });
  });
  ctx.restore();
 }
 function drawMark(ctx,s,w,h){if(!s?.watermarkEnabled)return;const txt=String(s.watermarkText||"YOUR BRAND").slice(0,40),scale=s.watermarkScale==="large"?1.15:s.watermarkScale==="small"?.68:.88,font=Math.round(42*scale),pad=58;ctx.save();ctx.globalAlpha=Math.max(.1,Math.min(1,Number(s.watermarkOpacity)||.72));ctx.font=`800 ${font}px Manrope,Arial,sans-serif`;ctx.textBaseline="middle";const tw=ctx.measureText(txt).width,pos=s.watermarkPosition||"bottom-right";const x=pos.endsWith("left")?pad:pos.endsWith("center")||pos==="center"?(w-tw)/2:w-pad-tw;const y=pos.startsWith("top")?pad:pos==="center"?h/2:h-pad-font;ctx.shadowColor="#000";ctx.shadowBlur=12;ctx.fillStyle="#fff";ctx.fillText(txt,x,y);ctx.restore();}
 async function getJson(url){const r=await fetch(url,{headers:{accept:"application/json"}}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not load render settings.");return d;}
 async function seek(v,target){if(Math.abs(v.currentTime-target)<.005&&!v.seeking)return;await new Promise((resolve,reject)=>{let settled=false;const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);v.removeEventListener("seeked",onSeeked);v.removeEventListener("error",onError);error?reject(error):resolve();};const onSeeked=()=>finish();const onError=()=>finish(new Error("Could not seek to the exact clip start. Retry the render."));const timer=setTimeout(()=>finish(new Error("Video seek timed out. Retry the render.")),12000);v.addEventListener("seeked",onSeeked);v.addEventListener("error",onError);v.currentTime=target;});if(Math.abs(v.currentTime-target)>.08)throw new Error("The source video did not reach the requested start time. Retry the render.");}
 async function manageOldRenders(clipId,button){
  let panel=$("#clip-render-cleanup-panel");
  if(panel&&!panel.hidden){panel.hidden=true;return;}
  if(!panel){panel=document.createElement("section");panel.id="clip-render-cleanup-panel";panel.className="panel";panel.style.marginTop="12px";button.insertAdjacentElement("afterend",panel);}
  panel.hidden=false;panel.replaceChildren();const loading=document.createElement("p");loading.textContent="Checking old render versions…";panel.append(loading);button.disabled=true;
  try{
   const response=await fetch("/api/clips/"+encodeURIComponent(clipId)+"/render-assets",{headers:{accept:"application/json"}});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not load old renders.");
   panel.replaceChildren();const heading=document.createElement("strong");heading.textContent="Unused old renders";panel.append(heading);
   const summary=document.createElement("p");summary.textContent=data.items.length?data.items.length+" render(s) can be safely removed · "+(data.totalBytes/1048576).toFixed(1)+" MB":"No unused old renders available. The latest render and all renders used by Review Center or YouTube are protected.";panel.append(summary);
   for(const item of data.items){
    const row=document.createElement("div");row.className="render-cleanup-row";row.style.display="flex";row.style.alignItems="center";row.style.justifyContent="space-between";row.style.gap="12px";row.style.padding="8px 0";row.style.borderTop="1px solid var(--border,rgba(255,255,255,.12))";
    const label=document.createElement("span");const date=item.createdAt?new Date(item.createdAt).toLocaleString():"";label.textContent="Render v"+item.version+" · "+(item.sizeBytes/1048576).toFixed(1)+" MB"+(date?" · "+date:"");
    const remove=document.createElement("button");remove.type="button";remove.className="text-button";remove.textContent="Delete";remove.addEventListener("click",async()=>{
     if(!window.confirm("Delete unused render v"+item.version+"? This cannot be undone."))return;
     remove.disabled=true;remove.textContent="Deleting…";
     try{const result=await fetch("/api/clips/"+encodeURIComponent(clipId)+"/render-assets?assetId="+encodeURIComponent(item.id),{method:"DELETE",headers:{accept:"application/json"}});const payload=await result.json();if(!result.ok||!payload.ok)throw new Error(payload.error||"Could not delete render.");row.remove();summary.textContent="Removed render v"+item.version+" · "+(payload.sizeBytes/1048576).toFixed(1)+" MB. Refresh this panel to check remaining versions.";}
     catch(error){remove.disabled=false;remove.textContent="Retry";summary.textContent=error.message;}
    });
    row.append(label,remove);panel.append(row);
   }
  }catch(error){panel.replaceChildren();const message=document.createElement("p");message.textContent=error.message;panel.append(message);}
  finally{button.disabled=false;}
 }
 async function showRenderHistory(clipId,button){
  let panel=$("#clip-render-history-panel");if(panel&&!panel.hidden){panel.hidden=true;return;}
  if(!panel){panel=document.createElement("section");panel.id="clip-render-history-panel";panel.className="panel";panel.style.marginTop="12px";button.insertAdjacentElement("afterend",panel);}
  panel.hidden=false;panel.replaceChildren();const loading=document.createElement("p");loading.textContent="Loading render history…";panel.append(loading);button.disabled=true;
  try{
   const response=await fetch("/api/clips/"+encodeURIComponent(clipId)+"/render-history",{headers:{accept:"application/json"}}),data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"Could not load render history.");
   panel.replaceChildren();const heading=document.createElement("strong");heading.textContent="Render history · "+data.total+" version(s)";panel.append(heading);
   const note=document.createElement("p");note.textContent="Previewing a version never changes the active render or YouTube publishing selection.";panel.append(note);
   if(data.items.length>=2){
    const compare=document.createElement("div");compare.style.display="flex";compare.style.flexWrap="wrap";compare.style.alignItems="center";compare.style.gap="8px";compare.style.margin="12px 0";
    const left=document.createElement("select"),right=document.createElement("select");left.setAttribute("aria-label","First render version");right.setAttribute("aria-label","Second render version");
    for(const item of data.items){for(const select of [left,right]){const option=document.createElement("option");option.value=item.id;option.textContent="Render v"+item.version+(item.isLatest?" · Latest":"");select.append(option);}}
    left.value=data.items[1].id;right.value=data.items[0].id;
    const compareButton=document.createElement("button");compareButton.type="button";compareButton.className="text-button";compareButton.textContent="Compare versions";
    compare.append(left,right,compareButton);panel.append(compare);
    const compareArea=document.createElement("div");compareArea.id="clip-render-comparison";compareArea.style.display="grid";compareArea.style.gridTemplateColumns="repeat(auto-fit,minmax(min(100%,240px),1fr))";compareArea.style.gap="12px";compareArea.style.margin="12px 0";panel.append(compareArea);
    compareButton.addEventListener("click",()=>{
     const a=data.items.find(item=>item.id===left.value),b=data.items.find(item=>item.id===right.value);
     if(!a||!b||a.id===b.id){compareArea.replaceChildren();const warning=document.createElement("p");warning.textContent="Choose two different render versions to compare.";compareArea.append(warning);return;}
     compareArea.replaceChildren();
     for(const item of [a,b]){
      const card=document.createElement("div");card.style.minWidth="0";card.style.padding="10px";card.style.border="1px solid var(--border,rgba(255,255,255,.14))";card.style.borderRadius="12px";
      const label=document.createElement("strong");label.textContent="Render v"+item.version+(item.isLatest?" · LATEST":"");card.append(label);
      const player=document.createElement("video");player.controls=true;player.playsInline=true;player.preload="metadata";player.src=item.previewUrl;player.style.display="block";player.style.width="100%";player.style.maxHeight="min(65vh,680px)";player.style.aspectRatio="9 / 16";player.style.objectFit="contain";player.style.background="#08090d";player.style.marginTop="8px";card.append(player);
      const meta=document.createElement("p");meta.style.margin="6px 0 0";meta.textContent=(item.sizeBytes/1048576).toFixed(1)+" MB · "+(item.createdAt?new Date(item.createdAt).toLocaleString():"Date unavailable");card.append(meta);compareArea.append(card);
     }
    });
   }
   if(!data.items.length){const empty=document.createElement("p");empty.textContent="No saved renders yet. Render a clip to start its history.";panel.append(empty);}
   for(const item of data.items){
    const row=document.createElement("div");row.style.display="flex";row.style.flexWrap="wrap";row.style.alignItems="center";row.style.justifyContent="space-between";row.style.gap="10px";row.style.padding="10px 0";row.style.borderTop="1px solid var(--border,rgba(255,255,255,.12))";
    const info=document.createElement("div");info.style.minWidth="180px";info.style.flex="1";
    const title=document.createElement("strong");title.textContent="Render v"+item.version+(item.isLatest?" · LATEST":"");info.append(title);
    const meta=document.createElement("p");meta.style.margin="4px 0 0";meta.textContent=(item.sizeBytes/1048576).toFixed(1)+" MB · "+(item.createdAt?new Date(item.createdAt).toLocaleString():"Date unavailable");info.append(meta);
    const status=document.createElement("p");status.style.margin="3px 0 0";status.textContent=item.isProtected?"Protected: "+item.protectedReasons.join(" · "):"Unused historical version";info.append(status);
    const actions=document.createElement("div");actions.style.display="flex";actions.style.flexWrap="wrap";actions.style.gap="8px";
    const play=document.createElement("button");play.type="button";play.className="text-button";play.textContent="Preview";play.addEventListener("click",()=>{
     let player=panel.querySelector("#clip-render-history-preview");
     if(!player){const wrap=document.createElement("div");wrap.style.margin="12px 0";player=document.createElement("video");player.id="clip-render-history-preview";player.controls=true;player.playsInline=true;player.preload="metadata";player.style.width="min(100%,360px)";player.style.maxHeight="65vh";player.style.display="block";wrap.append(player);panel.insertBefore(wrap,panel.children[1]||null);}
     player.src=item.previewUrl;player.load();player.play().catch(()=>{});
    });
    const open=document.createElement("a");open.href=item.downloadUrl;open.target="_blank";open.rel="noopener";open.className="text-button";open.textContent="Download";actions.append(play,open);row.append(info,actions);panel.append(row);
   }
  }catch(error){panel.replaceChildren();const message=document.createElement("p");message.textContent=error.message;panel.append(message);}
  finally{button.disabled=false;}
 }
 function ensureCleanupButton(msg,clipId){
  let button=$("#clip-render-cleanup");if(!button){button=document.createElement("button");button.type="button";button.id="clip-render-cleanup";button.className="text-button";button.textContent="Manage old renders";button.style.marginTop="10px";msg.insertAdjacentElement("afterend",button);button.addEventListener("click",()=>manageOldRenders(button.dataset.clipId,button));}
  button.dataset.clipId=clipId;
  let history=$("#clip-render-history");if(!history){history=document.createElement("button");history.type="button";history.id="clip-render-history";history.className="text-button";history.textContent="Render history";history.style.marginTop="10px";button.insertAdjacentElement("afterend",history);history.addEventListener("click",()=>showRenderHistory(history.dataset.clipId,history));}
  history.dataset.clipId=clipId;
 }
 async function render(){
  if(busy)return false;
  window.__shortsflowRenderSucceeded=false;
  const clip=window.__shortsflowActiveClip,btn=$("#clip-render-btn"),msg=$("#clip-render-message");
  if(!clip?.id||!btn||!msg)return false;
  ensureCleanupButton(msg,clip.id);
  const changedCut=()=>Math.abs(Number(window.__shortsflowClipStart)-Number(clip.startSeconds))>.05||Math.abs(Number(window.__shortsflowClipEnd)-Number(clip.endSeconds))>.05;
  const changedMeta=()=>$("#clip-edit-title")?.value.trim()!==(clip.title||"")||$("#clip-edit-caption")?.value.trim()!==(clip.caption||"")||$("#clip-edit-hashtags")?.value.trim()!==(clip.hashtags||"")||$("#clip-edit-language")?.value.trim()!==(clip.language||"");
  if(changedCut()||changedMeta()||window.__shortsflowSubtitleDirty||window.__shortsflowWatermarkDirty){msg.textContent="Save your latest clip edits, subtitle style and watermark settings first, then render.";return false;}
  busy=true;btn.disabled=true;btn.textContent="Queueing…";
  let metadataVersion=Number(clip.metadataVersion||0),requeues=0;
  const statusUrl="/api/clips/"+encodeURIComponent(clip.id)+"/render-jobs";
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const refreshVersion=async()=>{
   const response=await fetch("/api/clips",{headers:{accept:"application/json"},cache:"no-store"});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not refresh the saved clip version.");
   const latest=(data.clips||[]).find(item=>String(item.id)===String(clip.id));
   if(!latest)throw new Error("This clip is no longer available.");
   Object.assign(clip,latest);window.__shortsflowActiveClip=clip;
   metadataVersion=Number(latest.metadataVersion||0);
   return latest;
  };
  const showAsset=asset=>{
   msg.replaceChildren();msg.append(document.createTextNode("Background render saved · MP4 · "+(Number(asset.sizeBytes||0)/1048576).toFixed(1)+" MB · "));
   const link=document.createElement("a");link.href=asset.url||("/api/clips/"+encodeURIComponent(clip.id)+"/render");link.target="_blank";link.rel="noopener";link.textContent="Open rendered video ↗";msg.append(link);
   btn.textContent="Render again";window.__shortsflowRenderSucceeded=true;
  };
  const queueLatest=async()=>{
   const response=await fetch(statusUrl,{method:"POST",headers:{accept:"application/json"}});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not queue the latest background render.");
   return data.job;
  };
  try{
   await refreshVersion();
   let response=await fetch(statusUrl,{headers:{accept:"application/json"},cache:"no-store"});
   let data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not check background render status.");
   let job=data.job;
   if(job&&Number(job.metadataVersion)===metadataVersion&&job.status==="completed"&&job.asset){showAsset(job.asset);return true;}
   if(!job||Number(job.metadataVersion)!==metadataVersion||!["queued","running"].includes(job.status)){
    msg.textContent="Adding the latest saved edits to the background queue…";job=await queueLatest();
   }
   msg.textContent="Background render queued. You can switch tabs or close this browser; processing continues on the server.";
   const deadline=Date.now()+45*60*1000;
   while(Date.now()<deadline){
    await wait(5000);
    response=await fetch(statusUrl,{headers:{accept:"application/json"},cache:"no-store"});
    data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Could not refresh background render status.");
    job=data.job;
    if(job&&job.status==="completed"&&job.asset&&Number(job.metadataVersion)===metadataVersion){showAsset(job.asset);return true;}
    if(job&&job.status==="failed"&&Number(job.metadataVersion)===metadataVersion)throw new Error(job.error||"Background rendering failed. You can retry safely.");
    if(job&&Number(job.metadataVersion)!==metadataVersion){
     await refreshVersion();
     if(changedCut()||changedMeta()||window.__shortsflowSubtitleDirty||window.__shortsflowWatermarkDirty){
      throw new Error("New edits are not saved yet. Save the latest edits, then render again.");
     }
     if(++requeues>3)throw new Error("Clip settings changed repeatedly. The latest edits are saved; please queue one more render.");
     msg.textContent="Newer saved settings detected. Automatically queueing a fresh render…";
     job=await queueLatest();
     continue;
    }
    if(job?.status==="queued")msg.textContent="Waiting for the background FFmpeg runner… You can close this tab safely.";
    else if(job?.status==="running")msg.textContent="Rendering on the background server… This continues even when ShortsFlow is closed.";
   }
   msg.textContent="Render is still running in the background. You can close this tab and reopen the clip later to check the result.";
   btn.textContent="Check render status";return false;
  }catch(error){
   msg.textContent=error.message||"Background render failed. Retry.";
   btn.textContent="Retry background render";window.__shortsflowRenderSucceeded=false;return false;
  }finally{busy=false;btn.disabled=false;}
 }
 window.__shortsflowRenderActiveClip=async()=>{await render();return window.__shortsflowRenderSucceeded===true;};
 document.addEventListener("click",e=>{if(e.target.closest("#clip-render-btn"))render();});
})();