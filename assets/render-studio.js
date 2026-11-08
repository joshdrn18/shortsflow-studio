(() => {
 const $=s=>document.querySelector(s);let busy=false;
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
  const clean=words.map((item,index)=>({item,index,word:String(item?.word||"").replace(/\s+/g," ").trim(),start:Number(item?.start),end:Number(item?.end)}))
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
  let size=Math.round(49*scale),maxWidth=w*.86,lines=[];
  const buildLines=fontSize=>{
   ctx.font=`900 ${fontSize}px Manrope,Arial,sans-serif`;
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
  const centerY=c.position==="top"?frame.y+frame.h*.2:frame.y+frame.h*.8;
  const minY=frame.y+lh*.65,maxY=frame.y+frame.h-lh*.65;
  const top=Math.max(minY,Math.min(maxY-totalH,centerY-totalH/2));
  ctx.save();ctx.font=`900 ${size}px Manrope,Arial,sans-serif`;ctx.textAlign="left";ctx.textBaseline="middle";
  lines.forEach((items,i)=>{
   const widths=items.map(token=>ctx.measureText(token.word).width);
   const space=ctx.measureText(" ").width;
   const total=widths.reduce((a,b)=>a+b,0)+space*Math.max(0,items.length-1);
   let x=(w-total)/2;const y=top+i*(lh+gap)+lh/2;
   if(c.background!==false){const bw=Math.min(w*.92,total+padX*2);ctx.fillStyle="rgba(8,9,13,.88)";round(ctx,(w-bw)/2,y-lh/2-padY/2,bw,lh+padY,Math.min(14,lh*.22));ctx.fill();}
   items.forEach((token,j)=>{
    const word=token.word;
    ctx.lineWidth=Math.max(2,size*.075);ctx.strokeStyle="rgba(0,0,0,.92)";ctx.lineJoin="round";ctx.strokeText(word,x,y);
    ctx.fillStyle=token===clean[active]?(c.highlight||"#b59aff"):(c.color||"#fff");ctx.fillText(word,x,y);
    x+=widths[j]+space;
   });
  });
  ctx.restore();
 }
 function drawMark(ctx,s,w,h){if(!s?.watermarkEnabled)return;const txt=String(s.watermarkText||"YOUR BRAND").slice(0,40),scale=s.watermarkScale==="large"?1.15:s.watermarkScale==="small"?.68:.88,font=Math.round(42*scale),pad=58;ctx.save();ctx.globalAlpha=Math.max(.1,Math.min(1,Number(s.watermarkOpacity)||.72));ctx.font=`800 ${font}px Manrope,Arial,sans-serif`;ctx.textBaseline="middle";const tw=ctx.measureText(txt).width,pos=s.watermarkPosition||"bottom-right";const x=pos.endsWith("left")?pad:pos.endsWith("center")||pos==="center"?(w-tw)/2:w-pad-tw;const y=pos.startsWith("top")?pad:pos==="center"?h/2:h-pad-font;ctx.shadowColor="#000";ctx.shadowBlur=12;ctx.fillStyle="#fff";ctx.fillText(txt,x,y);ctx.restore();}
 async function getJson(url){const r=await fetch(url,{headers:{accept:"application/json"}}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not load render settings.");return d;}
 async function seek(v,target){if(Math.abs(v.currentTime-target)<.04)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Video seek timed out. Retry the render.")),12000);v.addEventListener("seeked",()=>{clearTimeout(timer);resolve();},{once:true});v.currentTime=target;});}
 async function render(){
  if(busy)return;const clip=window.__shortsflowActiveClip,v=$("#clip-preview-video"),btn=$("#clip-render-btn"),msg=$("#clip-render-message");if(!clip?.id||!v||!btn)return;
  if(!window.MediaRecorder||!v.captureStream||!HTMLCanvasElement.prototype.captureStream){msg.textContent="Browser rendering requires the latest Chrome or Edge.";return;}
  const current=window.__shortsflowActiveClip;
  const changedCut=Math.abs(Number(window.__shortsflowClipStart)-Number(clip.startSeconds))>.05||Math.abs(Number(window.__shortsflowClipEnd)-Number(clip.endSeconds))>.05;
  const changedMeta=$("#clip-edit-title")?.value.trim()!==(clip.title||"")||$("#clip-edit-caption")?.value.trim()!==(clip.caption||"")||$("#clip-edit-hashtags")?.value.trim()!==(clip.hashtags||"")||$("#clip-edit-language")?.value.trim()!==(clip.language||"");
  if(changedCut||changedMeta||window.__shortsflowSubtitleDirty||window.__shortsflowWatermarkDirty){msg.textContent="Save your clip edits, subtitle style and watermark settings first, then render again.";return;}
  busy=true;btn.disabled=true;btn.textContent="Preparing…";let recorder=null,canvasStream=null,sourceStream=null,frame=0,stopped=false,xhr=null;\n  const cancelBtn=document.createElement("button");cancelBtn.type="button";cancelBtn.id="clip-render-cancel";cancelBtn.className=btn.className;cancelBtn.textContent="Cancel render";cancelBtn.style.marginLeft="8px";btn.insertAdjacentElement("afterend",cancelBtn);\n  const task={cancelled:false,cancel(){if(this.cancelled)return;this.cancelled=true;stopped=true;cancelAnimationFrame(frame);try{if(v&&!v.paused)v.pause();}catch{}if(recorder&&recorder.state!=="inactive"){try{recorder.stop();}catch{}}if(xhr&&xhr.readyState!==XMLHttpRequest.DONE)xhr.abort();msg.textContent="Render cancelled. No new render was saved.";}};activeCancel=task;cancelBtn.addEventListener("click",()=>task.cancel());
  try{
   msg.textContent="Loading saved cut, subtitles and watermark…";
   const [sub,settings]=await Promise.all([getJson("/api/clips/"+encodeURIComponent(clip.id)+"/subtitles"),getJson("/api/workspace/settings")]);
   const c=sub.clip,start=Number(c.startSeconds),end=Number(c.endSeconds),duration=end-start,mv=Number(c.metadataVersion);
   if(!mv||duration<1||duration>180)throw new Error("Save the clip cut and subtitle style first. Clip duration must be 1–180 seconds.");
   if(v.readyState<2||!v.videoWidth)throw new Error("Wait until the source video preview is ready.");
   if(v.currentSrc&&!v.currentSrc.includes(encodeURIComponent(c.sourceId)))throw new Error("This preview is not showing the selected clip source. Close and reopen it.");
   const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext("2d",{alpha:false});
   canvasStream=canvas.captureStream(30);sourceStream=v.captureStream();const tracks=[...canvasStream.getVideoTracks(),...sourceStream.getAudioTracks()];if(!tracks.length)throw new Error("Could not capture video/audio tracks.");
   const stream=new MediaStream(tracks),types=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"],mime=types.find(x=>MediaRecorder.isTypeSupported(x));if(!mime)throw new Error("No supported WebM encoder found in this browser.");
   const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000,audioBitsPerSecond:128000});
   const done=new Promise((resolve,reject)=>{recorder.addEventListener("stop",resolve,{once:true});recorder.addEventListener("error",()=>reject(new Error("Browser video encoder failed.")),{once:true});});
   recorder.addEventListener("dataavailable",e=>{if(e.data?.size)chunks.push(e.data);});
   v.pause();await seek(v,start);const started=performance.now();let last=0;
   const stop=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);v.pause();if(recorder&&recorder.state!=="inactive")recorder.stop();};
   const draw=()=>{if(stopped)return;const videoBox=drawVerticalComposition(ctx,v,1080,1920);const t=v.currentTime-start;drawWords(ctx,sub.words||[],t,sub.config||{},1080,1920,videoBox);drawMark(ctx,settings.settings||{},1080,1920);if(performance.now()-last>350){msg.textContent="Rendering in this browser… "+Math.round(Math.min(99,Math.max(0,t/duration*100)))+"%";last=performance.now();}if(v.currentTime>=end||v.ended){stop();return;}frame=requestAnimationFrame(draw);};
   recorder.start(1000);await v.play();frame=requestAnimationFrame(draw);const timeout=setTimeout(stop,(duration+10)*1000);await done;clearTimeout(timeout);
   if(performance.now()-started<500)throw new Error("The source did not play long enough. Retry.");
   const blob=new Blob(chunks,{type:"video/webm"});if(blob.size<1024)throw new Error("Render output is empty. Check source playback and retry.");if(blob.size>90*1024*1024)throw new Error("Render exceeds the 90 MB limit. Try a shorter clip.");
   msg.textContent="Uploading render to private R2 storage…";
   const result=await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open("POST","/api/clips/"+encodeURIComponent(clip.id)+"/render");xhr.withCredentials=true;xhr.timeout=300000;
    xhr.setRequestHeader("Content-Type","video/webm");xhr.setRequestHeader("X-Metadata-Version",String(mv));
    xhr.upload.addEventListener("progress",event=>{
     if(event.lengthComputable){const percent=Math.round(event.loaded/event.total*100),sent=(event.loaded/1048576).toFixed(1),total=(event.total/1048576).toFixed(1);msg.textContent=percent>=100?"Upload complete. Verifying the video in private R2 storage…":"Uploading to private R2 storage… "+percent+"% · "+sent+" / "+total+" MB";}
     else msg.textContent="Uploading render to private R2 storage…";
    });
    xhr.addEventListener("load",()=>{
     let data={};try{data=JSON.parse(xhr.responseText||"{}");}catch{}
     if(xhr.status<200||xhr.status>=300||!data.ok){reject(new Error(data.error||"R2 upload failed (HTTP "+xhr.status+")."));return;}
     resolve(data);
    });
    xhr.addEventListener("error",()=>reject(new Error("Network error while uploading to R2. Check connection and retry.")));
    xhr.addEventListener("timeout",()=>reject(new Error("R2 upload timed out after 5 minutes. The server did not confirm a saved asset; refresh the clip before retrying.")));
    xhr.addEventListener("abort",()=>reject(new Error("R2 upload was cancelled.")));
    xhr.send(blob);msg.textContent="Connecting to private R2 storage…";
   });
   msg.replaceChildren();
   msg.append(document.createTextNode("Render saved · WebM · "+(result.asset.sizeBytes/1048576).toFixed(1)+" MB · "));
   const link=document.createElement("a");link.href=result.asset.url;link.target="_blank";link.rel="noopener";link.textContent="Open rendered video ↗";msg.append(link);
   btn.textContent="Render again";
  }catch(e){msg.textContent=e.message||"Render failed. Retry.";btn.textContent="Retry render";}
  finally{stopped=true;cancelAnimationFrame(frame);if(recorder&&recorder.state!=="inactive"){try{recorder.stop();}catch{}}if(canvasStream)canvasStream.getTracks().forEach(t=>t.stop());if(sourceStream)sourceStream.getTracks().forEach(t=>t.stop());cancelBtn.remove();if(activeCancel===task)activeCancel=null;busy=false;btn.disabled=false;}
 }
 document.addEventListener("click",e=>{if(e.target.closest("#clip-render-btn"))render();});
})();