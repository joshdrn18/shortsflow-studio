(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let clipId = null, words = [], config = {}, busy = false;
  const defaults = {enabled:true,preset:"pop",fontSize:28,color:"#ffffff",highlight:"#b59aff",position:"bottom",background:true,edgeOffset:9,fontWeight:900,highlightStyle:"color",animation:"pop",animationDuration:160};
  function inject() {
    const dialog=$("#clip-preview-dialog"), video=$("#clip-preview-video");
    if (!dialog || !video || $("#subtitle-studio")) return;
    const frame=document.createElement("div"); frame.className="subtitle-preview-frame"; video.parentNode.insertBefore(frame,video); frame.appendChild(video);
    const overlay=document.createElement("div"); overlay.id="subtitle-live-overlay"; overlay.className="subtitle-live-overlay"; frame.appendChild(overlay);
    const panel=document.createElement("section"); panel.id="subtitle-studio"; panel.className="subtitle-studio";
    panel.innerHTML='<div class="subtitle-studio-head"><div><span class="discovery-kicker">SUBTITLE STUDIO</span><strong>Style your words</strong><small id="subtitle-status">Loading timestamped words…</small></div><label class="subtitle-enable"><input id="subtitle-enabled" type="checkbox" checked> Show subtitles</label></div><div class="subtitle-brand-kit"><div><strong>Brand Kit</strong><small>Reuse your channel look across future clips.</small></div><label>Brand profile<select id="subtitle-brand-profile"><option value="">Loading profiles…</option></select></label><label>Profile name<input id="subtitle-brand-name" type="text" maxlength="40" value="My Brand" placeholder="e.g. My Channel"></label><div class="subtitle-brand-actions"><button type="button" class="secondary-button" id="subtitle-brand-new">＋ New profile</button><button type="button" class="secondary-button" id="subtitle-brand-load">Refresh</button><button type="button" class="secondary-button" id="subtitle-brand-save">Save profile</button><button type="button" class="secondary-button" id="subtitle-brand-delete">Delete</button><button type="button" class="primary-button" id="subtitle-brand-apply">Apply to this clip</button></div></div><div class="subtitle-controls"><label>Quick preset<select id="subtitle-quick-preset"><option value="">Choose a look…</option><option value="tiktok">TikTok Viral</option><option value="mrbeast">MrBeast-style</option><option value="documentary">Clean Documentary</option><option value="podcast">Podcast</option><option value="cinematic">Minimal Cinematic</option></select></label><label>Style<select id="subtitle-preset"><option value="pop">Pop highlight</option><option value="classic">Classic bold</option><option value="minimal">Minimal</option></select></label><label>Position<select id="subtitle-position"><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label><label>Font size <span id="subtitle-size-value">28px</span><input id="subtitle-size" type="range" min="18" max="44" value="28"></label><label>Font weight<select id="subtitle-weight"><option value="600">Semi bold</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900" selected>Black</option></select></label><label>Highlight style<select id="subtitle-highlight-style"><option value="color">Text color</option><option value="pill">Highlight pill</option><option value="underline">Underline</option></select></label><label>Word animation<select id="subtitle-animation"><option value="none">None</option><option value="pop">Pop in</option><option value="fade">Fade in</option><option value="slide">Slide up</option></select></label><label>Animation speed <span id="subtitle-duration-value">160ms</span><input id="subtitle-duration" type="range" min="80" max="300" step="20" value="160"></label><label>Edge spacing <span id="subtitle-offset-value">9%</span><input id="subtitle-offset" type="range" min="5" max="25" value="9"></label><label>Text color<select id="subtitle-color"><option value="#ffffff">White</option><option value="#f8e16c">Warm yellow</option><option value="#b9f5d0">Mint</option><option value="#ffb4c2">Soft pink</option></select></label><label>Highlight<select id="subtitle-highlight"><option value="#b59aff">Lavender</option><option value="#f8e16c">Yellow</option><option value="#75c8ff">Blue</option><option value="#ff8fbd">Pink</option></select></label><label class="subtitle-background"><input id="subtitle-background" type="checkbox" checked> Text backing</label></div><div class="subtitle-studio-footer"><span>Preview uses transcript word timestamps · relative to this clip</span><button type="button" class="primary-button" id="subtitle-save">Save subtitle style</button></div>';
    frame.after(panel);
    ["subtitle-enabled","subtitle-preset","subtitle-position","subtitle-size","subtitle-color","subtitle-highlight","subtitle-background","subtitle-weight","subtitle-highlight-style","subtitle-offset","subtitle-animation","subtitle-duration"].forEach(id=>$("#"+id).addEventListener("input",()=>{window.__shortsflowSubtitleDirty=true;update();}));
    $("#subtitle-quick-preset").addEventListener("change",event=>applyQuickPreset(event.target.value));
    $("#subtitle-brand-save").addEventListener("click",saveBrandKit);
    $("#subtitle-brand-load").addEventListener("click",loadBrandKit);
    $("#subtitle-brand-apply").addEventListener("click",applyBrandKit);
    $("#subtitle-brand-profile").addEventListener("change",selectBrandProfile);
    $("#subtitle-brand-new").addEventListener("click",createBrandProfile);
    $("#subtitle-brand-delete").addEventListener("click",deleteBrandProfile);
    $("#subtitle-save").addEventListener("click",save);
    video.addEventListener("timeupdate",render);
    video.addEventListener("seeked",render);
  }
  function readControls(){
    config={enabled:$("#subtitle-enabled").checked,preset:$("#subtitle-preset").value,position:$("#subtitle-position").value,fontSize:Number($("#subtitle-size").value),color:$("#subtitle-color").value,highlight:$("#subtitle-highlight").value,background:$("#subtitle-background").checked,fontWeight:Number($("#subtitle-weight").value),highlightStyle:$("#subtitle-highlight-style").value,edgeOffset:Number($("#subtitle-offset").value),animation:$("#subtitle-animation").value,animationDuration:Number($("#subtitle-duration").value)};
  }
  function update(){readControls();$("#subtitle-size-value").textContent=config.fontSize+"px";$("#subtitle-offset-value").textContent=config.edgeOffset+"%";$("#subtitle-duration-value").textContent=config.animationDuration+"ms";render();}
  function applyQuickPreset(name){
    const looks={
      tiktok:{preset:"pop",fontSize:32,color:"#ffffff",highlight:"#f8e16c",position:"bottom",background:true,fontWeight:900,highlightStyle:"pill",edgeOffset:9,animation:"pop",animationDuration:140},
      mrbeast:{preset:"classic",fontSize:34,color:"#ffffff",highlight:"#f8e16c",position:"center",background:false,fontWeight:900,highlightStyle:"color",edgeOffset:9,animation:"pop",animationDuration:120},
      documentary:{preset:"minimal",fontSize:26,color:"#ffffff",highlight:"#b9f5d0",position:"bottom",background:true,fontWeight:700,highlightStyle:"underline",edgeOffset:12,animation:"fade",animationDuration:220},
      podcast:{preset:"classic",fontSize:28,color:"#ffffff",highlight:"#ff8fbd",position:"center",background:true,fontWeight:800,highlightStyle:"pill",edgeOffset:9,animation:"slide",animationDuration:180},
      cinematic:{preset:"minimal",fontSize:24,color:"#ffffff",highlight:"#75c8ff",position:"bottom",background:false,fontWeight:600,highlightStyle:"color",edgeOffset:15,animation:"fade",animationDuration:260}
    };
    const look=looks[name];if(!look)return;
    $("#subtitle-preset").value=look.preset;$("#subtitle-position").value=look.position;$("#subtitle-size").value=look.fontSize;
    $("#subtitle-color").value=look.color;$("#subtitle-highlight").value=look.highlight;$("#subtitle-background").checked=look.background;
    $("#subtitle-weight").value=String(look.fontWeight);$("#subtitle-highlight-style").value=look.highlightStyle;
    $("#subtitle-offset").value=look.edgeOffset;$("#subtitle-animation").value=look.animation;$("#subtitle-duration").value=look.animationDuration;
    window.__shortsflowSubtitleDirty=true;update();
    $("#subtitle-status").textContent=name==="tiktok"?"TikTok Viral look applied — save to keep it.":name==="mrbeast"?"MrBeast-style look applied — save to keep it.":name==="documentary"?"Clean Documentary look applied — save to keep it.":name==="podcast"?"Podcast look applied — save to keep it.":"Minimal Cinematic look applied — save to keep it.";
  }
  function applyConfig(value){
    config={...defaults,...(value||{})};window.__shortsflowSubtitleDirty=false;
    $("#subtitle-enabled").checked=config.enabled;$("#subtitle-preset").value=config.preset;$("#subtitle-position").value=config.position;
    $("#subtitle-size").value=config.fontSize;$("#subtitle-color").value=config.color;$("#subtitle-highlight").value=config.highlight;$("#subtitle-background").checked=config.background;$("#subtitle-weight").value=String(config.fontWeight);$("#subtitle-highlight-style").value=config.highlightStyle;$("#subtitle-offset").value=config.edgeOffset;$("#subtitle-animation").value=config.animation;$("#subtitle-duration").value=config.animationDuration;
    update();
  }
  function render(){
    const overlay=$("#subtitle-live-overlay"),video=$("#clip-preview-video");if(!overlay||!video)return;
    overlay.className="subtitle-live-overlay animation-"+(config.animation||"pop")+" "+(config.position==="top"?"is-top":config.position==="center"?"is-center":"is-bottom")+" "+(config.preset||"pop")+" "+(config.background?"has-background":"")+" highlight-"+config.highlightStyle;
    overlay.style.setProperty("--subtitle-size",config.fontSize+"px");overlay.style.setProperty("--subtitle-color",config.color);overlay.style.setProperty("--subtitle-highlight",config.highlight);overlay.style.setProperty("--subtitle-weight",String(config.fontWeight));overlay.style.setProperty("--subtitle-edge",config.edgeOffset+"%");overlay.style.setProperty("--subtitle-animation-duration",config.animationDuration+"ms");
    if(!config.enabled){overlay.innerHTML="";return;}
    const t=video.currentTime-Number(window.__shortsflowClipStart||0);
    const active=words.findIndex(w=>t>=w.start&&t<=w.end);
    if(active<0){if(overlay.innerHTML){overlay.innerHTML="";delete overlay.dataset.renderKey;}return;}
    // Keep the live preview grouping identical to the browser render:
    // max four words, split after long pauses and sentence-ending punctuation.
    const groups=[];let current=[];
    for(const word of words){
      const previous=current[current.length-1];
      const gap=previous?Number(word.start)-Number(previous.end):0;
      const sentenceEnd=previous&&/[.!?…][”’"')\\]]*$/.test(String(previous.word||""));
      if(current.length&&(current.length>=4||gap>.65||sentenceEnd)){groups.push(current);current=[];}
      current.push(word);
    }
    if(current.length)groups.push(current);
    const group=groups.find(items=>items.some(w=>w===words[active]))||[];const key=String(words.indexOf(group[0]))+":"+active;if(overlay.dataset.renderKey===key)return;overlay.dataset.renderKey=key;
    overlay.innerHTML=group.map(w=>'<span class="'+(w===words[active]?"is-active":"")+'">'+esc(String(w.word||"").replace(/<\/?b\d*\s*>|&lt;\/?b\d*\s*&gt;|(?:\\\\|\/)b\d*/gi," ").replace(/\s+/g," ").trim())+'</span>').join(" ");
  }
  async function load(){
    const clip=window.__shortsflowActiveClip;
    if(!clip?.id)return;
    clipId=clip.id;delete $("#subtitle-live-overlay").dataset.renderKey;$("#subtitle-status").textContent="Loading subtitle timing…";words=[];
    try{
      const r=await fetch("/api/clips/"+encodeURIComponent(clipId)+"/subtitles",{headers:{accept:"application/json"}});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Subtitle data unavailable.");
      words=d.words||[];applyConfig(d.config);
      $("#subtitle-status").textContent=words.length?words.length.toLocaleString()+" timestamped words ready":"No word timestamps found. Run source transcription first.";
      if(!words.length)$("#subtitle-live-overlay").innerHTML="";
    }catch(e){$("#subtitle-status").textContent=e.message;}
  }
  function renderBrandProfiles(data){
    const select=$("#subtitle-brand-profile");
    const profiles=Array.isArray(data.profiles)?data.profiles:[];
    window.__shortsflowBrandProfiles=profiles;
    select.innerHTML=profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("") || '<option value="">Legacy Brand Kit</option>';
    if(data.activeProfileId)select.value=data.activeProfileId;
    const kit=data.kit||profiles[0]||null;
    window.__shortsflowLoadedBrandKit=kit;
    if(kit){$("#subtitle-brand-name").value=kit.name||"My Brand";}
    $("#subtitle-brand-delete").disabled=profiles.length<=1;
  }
  async function loadBrandKit(){
    const button=$("#subtitle-brand-load");button.disabled=true;button.textContent="Loading…";
    try{const r=await fetch("/api/workspace/brand-kit",{headers:{accept:"application/json"}});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not load Brand Profiles.");renderBrandProfiles(d);if(!d.kit)throw new Error("No saved Brand Profile yet. Save your current look first.");$("#subtitle-status").textContent="Brand Profiles loaded. Choose a profile to switch channel identity.";}
    catch(e){$("#subtitle-status").textContent=e.message;}finally{button.disabled=false;button.textContent="Refresh";}
  }
  async function selectBrandProfile(){
    const id=$("#subtitle-brand-profile").value;
    const profile=(window.__shortsflowBrandProfiles||[]).find(p=>p.id===id);
    if(!profile)return;
    const button=$("#subtitle-brand-profile");button.disabled=true;
    try{
      const r=await fetch("/api/workspace/brand-kit",{method:"PUT",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({action:"activate",profileId:id})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not switch Brand Profile.");
      window.__shortsflowLoadedBrandKit=d.profile;$("#subtitle-brand-name").value=d.profile.name||"My Brand";
      applyConfig(d.profile.subtitle||{});window.__shortsflowSubtitleDirty=false;
      $("#subtitle-status").textContent="Active profile: "+d.profile.name+". Apply it to copy its subtitle and watermark look to this clip.";
      $("#subtitle-brand-delete").disabled=(window.__shortsflowBrandProfiles||[]).length<=1;
    }catch(e){$("#subtitle-status").textContent=e.message;await loadBrandKit();}
    finally{button.disabled=false;}
  }
  async function createBrandProfile(){
    readControls();const button=$("#subtitle-brand-new");button.disabled=true;button.textContent="Creating…";
    try{
      const settingsResponse=await fetch("/api/workspace/settings",{headers:{accept:"application/json"}});
      const settingsData=await settingsResponse.json();if(!settingsResponse.ok||!settingsData.ok)throw new Error(settingsData.error||"Could not read watermark settings.");
      const r=await fetch("/api/workspace/brand-kit",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({name:$("#subtitle-brand-name").value||"New Brand",subtitle:config,watermark:settingsData.settings||{}})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not create Brand Profile.");
      await loadBrandKit();$("#subtitle-brand-profile").value=d.profile.id;window.__shortsflowLoadedBrandKit=d.profile;$("#subtitle-brand-name").value=d.profile.name;
      $("#subtitle-status").textContent="New profile created. Edit the look and save when ready.";
    }catch(e){$("#subtitle-status").textContent=e.message;}
    finally{button.disabled=false;button.textContent="＋ New profile";}
  }
  async function deleteBrandProfile(){
    const id=$("#subtitle-brand-profile").value;if(!id)return;
    if(!window.confirm("Delete this Brand Profile? This cannot be undone."))return;
    const button=$("#subtitle-brand-delete");button.disabled=true;button.textContent="Deleting…";
    try{
      const r=await fetch("/api/workspace/brand-kit?profileId="+encodeURIComponent(id),{method:"DELETE",headers:{accept:"application/json"}});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not delete Brand Profile.");
      await loadBrandKit();if(d.activeProfile){$("#subtitle-brand-profile").value=d.activeProfile.id;window.__shortsflowLoadedBrandKit=d.activeProfile;$("#subtitle-brand-name").value=d.activeProfile.name;applyConfig(d.activeProfile.subtitle||{});}
      $("#subtitle-status").textContent="Brand Profile deleted. Another profile is now active.";
    }catch(e){$("#subtitle-status").textContent=e.message;}
    finally{button.textContent="Delete";button.disabled=(window.__shortsflowBrandProfiles||[]).length<=1;}
  }
  async function saveBrandKit(){
    readControls();const button=$("#subtitle-brand-save");button.disabled=true;button.textContent="Saving…";
    try{
      const settingsResponse=await fetch("/api/workspace/settings",{headers:{accept:"application/json"}});
      const settingsData=await settingsResponse.json();if(!settingsResponse.ok||!settingsData.ok)throw new Error(settingsData.error||"Could not read watermark settings.");
      const loaded=window.__shortsflowLoadedBrandKit;
      const r=await fetch("/api/workspace/brand-kit",{method:"PUT",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({profileId:loaded?.id||"",name:$("#subtitle-brand-name").value,subtitle:config,watermark:settingsData.settings||{}})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not save Brand Profile.");
      await loadBrandKit();if(d.profile?.id)$("#subtitle-brand-profile").value=d.profile.id;
      window.__shortsflowLoadedBrandKit=d.profile;$("#subtitle-status").textContent="Brand Profile saved. This identity is ready to reuse on other clips.";
    }catch(e){$("#subtitle-status").textContent=e.message;}
    finally{button.disabled=false;button.textContent="Save profile";}
  }
  async function applyBrandKit(){
    const button=$("#subtitle-brand-apply");button.disabled=true;button.textContent="Applying…";
    try{
      let kit=window.__shortsflowLoadedBrandKit;
      if(!kit){await loadBrandKit();kit=window.__shortsflowLoadedBrandKit;}
      if(!kit)throw new Error("No saved Brand Profile found.");
      if(kit.watermark&&Object.keys(kit.watermark).length){
        const wr=await fetch("/api/workspace/settings",{method:"PUT",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify(kit.watermark)});
        const wd=await wr.json();if(!wr.ok||!wd.ok)throw new Error(wd.error||"Could not apply watermark settings.");
      }
      $("#subtitle-brand-name").value=kit.name||"My Brand";applyConfig(kit.subtitle||{});window.__shortsflowSubtitleDirty=true;await save();
      $("#subtitle-status").textContent="Brand Profile applied: "+(kit.name||"My Brand")+". Subtitle style saved for this clip; watermark settings updated for future renders.";
    }catch(e){$("#subtitle-status").textContent=e.message;}
    finally{button.disabled=false;button.textContent="Apply to this clip";}
  }
  async function save(){
    if(!clipId||busy)return;readControls();busy=true;const b=$("#subtitle-save");b.disabled=true;b.textContent="Saving…";
    try{
      const r=await fetch("/api/clips/"+encodeURIComponent(clipId)+"/subtitles",{method:"PUT",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({config})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not save subtitle style.");
      window.__shortsflowSubtitleDirty=false;$("#subtitle-status").textContent="Saved as metadata version "+d.metadataVersion+". Preview only — no video has been rendered.";
    }catch(e){$("#subtitle-status").textContent=e.message;}
    finally{busy=false;b.disabled=false;b.textContent="Save subtitle style";}
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest(".clip-preview-btn");if(!button)return;
    setTimeout(()=>{inject();const clip=(window.__shortsflowClipCache||[]).find(x=>String(x.id)===button.dataset.clipId);if(clip){window.__shortsflowActiveClip=clip;window.__shortsflowClipStart=Number(clip.startSeconds)||0;load();}},80);
  });
  document.addEventListener("DOMContentLoaded",inject);
})();
