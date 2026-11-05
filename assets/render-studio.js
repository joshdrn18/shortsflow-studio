(() => {
 const $=s=>document.querySelector(s);let busy=false;
 function drawCover(ctx,v,w,h){const sw=v.videoWidth,sh=v.videoHeight;if(!sw||!sh)return;const ratio=9/16,sr=sw/sh;let sx=0,sy=0,cw=sw,ch=sh;if(sr>ratio){cw=sh*ratio;sx=(sw-cw)/2;}else{ch=sw/ratio;sy=(sh-ch)/2;}ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);ctx.drawImage(v,sx,sy,cw,ch,0,0,w,h);}
 function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
 function drawWords(ctx,words,t,c,w,h){if(!c.enabled)return;const active=words.findIndex(x=>t>=x.start&&t<=x.end);if(active<0)return;let first=active;while(first>0&&active-first<2&&words[first-1].end>=words[first].start-.18)first--;const group=words.slice(first,first+6).filter(x=>x.start<=t+2);if(!group.length)return;const size=Math.round((Number(c.fontSize)||28)*2.25),lh=size*1.2;ctx.save();ctx.font=`900 ${size}px Manrope,Arial,sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";const lines=[];let line=[];for(const word of group){const test=[...line,word];if(line.length&&ctx.measureText(test.map(x=>x.word).join(" ")).width>w*.84){lines.push(line);line=[word];}else line=test;}if(line.length)lines.push(line);const y0=(c.position==="top"?h*.16:h*.8)-lines.length*lh/2;lines.forEach((items,i)=>{const y=y0+i*lh+lh/2,txt=items.map(x=>x.word).join(" ");if(c.background!==false){const bw=ctx.measureText(txt).width+40;ctx.fillStyle="rgba(8,9,13,.84)";round(ctx,(w-bw)/2,y-lh*.42,bw,lh*.84,12);ctx.fill();}let x=w/2-ctx.measureText(txt).width/2;for(let j=0;j<items.length;j++){const item=items[j],word=item.word+(j===items.length-1?"":" ");ctx.lineWidth=size*.12;ctx.strokeStyle="#08090d";ctx.lineJoin="round";ctx.strokeText(word,x,y);ctx.fillStyle=item===words[active]?(c.highlight||"#b59aff"):(c.color||"#fff");ctx.fillText(word,x,y);x+=ctx.measureText(word).width;}});ctx.restore();}
 function drawMark(ctx,s,w,h){if(!s?.watermarkEnabled)return;const txt=String(s.watermarkText||"YOUR BRAND").slice(0,40),scale=s.watermarkScale==="large"?1.15:s.watermarkScale==="small"?.68:.88,font=Math.round(42*scale),pad=58;ctx.save();ctx.globalAlpha=Math.max(.1,Math.min(1,Number(s.watermarkOpacity)||.72));ctx.font=`800 ${font}px Manrope,Arial,sans-serif`;ctx.textBaseline="middle";const tw=ctx.measureText(txt).width,left=s.watermarkPosition?.endsWith("left"),top=s.watermarkPosition?.startsWith("top");ctx.shadowColor="#000";ctx.shadowBlur=12;ctx.fillStyle="#fff";ctx.fillText(txt,left?pad:w-pad-tw,top?pad:h-pad-font);ctx.restore();}
 async function getJson(url){const r=await fetch(url,{headers:{accept:"application/json"}}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not load render settings.");return d;}
 async function seek(v,target){if(Math.abs(v.currentTime-target)<.04)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Video seek timed out. Retry the render.")),12000);v.addEventListener("seeked",()=>{clearTimeout(timer);resolve();},{once:true});v.currentTime=target;});}
 async function render(){
  if(busy)return;const clip=window.__shortsflowActiveClip,v=$("#clip-preview-video"),btn=$("#clip-render-btn"),msg=$("#clip-render-message");if(!clip?.id||!v||!btn)return;
  if(!window.MediaRecorder||!v.captureStream||!HTMLCanvasElement.prototype.captureStream){msg.textContent="Browser rendering requires the latest Chrome or Edge.";return;}
  const current=window.__shortsflowActiveClip;
  const changedCut=Math.abs(Number(window.__shortsflowClipStart)-Number(clip.startSeconds))>.05||Math.abs(Number(window.__shortsflowClipEnd)-Number(clip.endSeconds))>.05;
  const changedMeta=$("#clip-edit-title")?.value.trim()!==(clip.title||"")||$("#clip-edit-caption")?.value.trim()!==(clip.caption||"")||$("#clip-edit-hashtags")?.value.trim()!==(clip.hashtags||"")||$("#clip-edit-language")?.value.trim()!==(clip.language||"");
  if(changedCut||changedMeta||window.__shortsflowSubtitleDirty||window.__shortsflowWatermarkDirty){msg.textContent="Save your clip edits, subtitle style and watermark settings first, then render again.";return;}
  busy=true;btn.disabled=true;btn.textContent="Preparing…";let recorder=null,canvasStream=null,sourceStream=null,frame=0,stopped=false;
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
   const draw=()=>{if(stopped)return;drawCover(ctx,v,1080,1920);const t=v.currentTime-start;drawWords(ctx,sub.words||[],t,sub.config||{},1080,1920);drawMark(ctx,settings.settings||{},1080,1920);if(performance.now()-last>350){msg.textContent="Rendering in this browser… "+Math.round(Math.min(99,Math.max(0,t/duration*100)))+"%";last=performance.now();}if(v.currentTime>=end||v.ended){stop();return;}frame=requestAnimationFrame(draw);};
   recorder.start(1000);await v.play();frame=requestAnimationFrame(draw);const timeout=setTimeout(stop,(duration+10)*1000);await done;clearTimeout(timeout);
   if(performance.now()-started<500)throw new Error("The source did not play long enough. Retry.");
   const blob=new Blob(chunks,{type:"video/webm"});if(blob.size<1024)throw new Error("Render output is empty. Check source playback and retry.");if(blob.size>90*1024*1024)throw new Error("Render exceeds the 90 MB limit. Try a shorter clip.");
   msg.textContent="Uploading render to private R2 storage…";
   const response=await fetch("/api/clips/"+encodeURIComponent(clip.id)+"/render",{method:"POST",headers:{"Content-Type":"video/webm","X-Metadata-Version":String(mv)},body:blob}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||"Could not save rendered video.");
   msg.innerHTML='Render saved · WebM · '+(result.asset.sizeBytes/1048576).toFixed(1)+' MB · <a href="'+result.asset.url+'" target="_blank" rel="noopener">Open rendered video ↗</a>';btn.textContent="Render again";
  }catch(e){msg.textContent=e.message||"Render failed. Retry.";btn.textContent="Retry render";}
  finally{stopped=true;cancelAnimationFrame(frame);if(recorder&&recorder.state!=="inactive"){try{recorder.stop();}catch{}}if(canvasStream)canvasStream.getTracks().forEach(t=>t.stop());if(sourceStream)sourceStream.getTracks().forEach(t=>t.stop());busy=false;btn.disabled=false;}
 }
 document.addEventListener("click",e=>{if(e.target.closest("#clip-render-btn"))render();});
})();