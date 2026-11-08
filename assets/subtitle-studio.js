(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let clipId = null, words = [], config = {}, busy = false;
  const defaults = {enabled:true,preset:"pop",fontSize:28,color:"#ffffff",highlight:"#b59aff",position:"bottom",background:true,edgeOffset:9,fontWeight:900,highlightStyle:"color"};
  function inject() {
    const dialog=$("#clip-preview-dialog"), video=$("#clip-preview-video");
    if (!dialog || !video || $("#subtitle-studio")) return;
    const frame=document.createElement("div"); frame.className="subtitle-preview-frame"; video.parentNode.insertBefore(frame,video); frame.appendChild(video);
    const overlay=document.createElement("div"); overlay.id="subtitle-live-overlay"; overlay.className="subtitle-live-overlay"; frame.appendChild(overlay);
    const panel=document.createElement("section"); panel.id="subtitle-studio"; panel.className="subtitle-studio";
    panel.innerHTML='<div class="subtitle-studio-head"><div><span class="discovery-kicker">SUBTITLE STUDIO</span><strong>Style your words</strong><small id="subtitle-status">Loading timestamped words…</small></div><label class="subtitle-enable"><input id="subtitle-enabled" type="checkbox" checked> Show subtitles</label></div><div class="subtitle-controls"><label>Style<select id="subtitle-preset"><option value="pop">Pop highlight</option><option value="classic">Classic bold</option><option value="minimal">Minimal</option></select></label><label>Position<select id="subtitle-position"><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label><label>Font size <span id="subtitle-size-value">28px</span><input id="subtitle-size" type="range" min="18" max="44" value="28"></label><label>Font weight<select id="subtitle-weight"><option value="600">Semi bold</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900" selected>Black</option></select></label><label>Highlight style<select id="subtitle-highlight-style"><option value="color">Text color</option><option value="pill">Highlight pill</option><option value="underline">Underline</option></select></label><label>Edge spacing <span id="subtitle-offset-value">9%</span><input id="subtitle-offset" type="range" min="5" max="25" value="9"></label><label>Text color<select id="subtitle-color"><option value="#ffffff">White</option><option value="#f8e16c">Warm yellow</option><option value="#b9f5d0">Mint</option><option value="#ffb4c2">Soft pink</option></select></label><label>Highlight<select id="subtitle-highlight"><option value="#b59aff">Lavender</option><option value="#f8e16c">Yellow</option><option value="#75c8ff">Blue</option><option value="#ff8fbd">Pink</option></select></label><label class="subtitle-background"><input id="subtitle-background" type="checkbox" checked> Text backing</label></div><div class="subtitle-studio-footer"><span>Preview uses transcript word timestamps · relative to this clip</span><button type="button" class="primary-button" id="subtitle-save">Save subtitle style</button></div>';
    frame.after(panel);
    ["subtitle-enabled","subtitle-preset","subtitle-position","subtitle-size","subtitle-color","subtitle-highlight","subtitle-background","subtitle-weight","subtitle-highlight-style","subtitle-offset"].forEach(id=>$("#"+id).addEventListener("input",()=>{window.__shortsflowSubtitleDirty=true;update();}));
    $("#subtitle-save").addEventListener("click",save);
    video.addEventListener("timeupdate",render);
    video.addEventListener("seeked",render);
  }
  function readControls(){
    config={enabled:$("#subtitle-enabled").checked,preset:$("#subtitle-preset").value,position:$("#subtitle-position").value,fontSize:Number($("#subtitle-size").value),color:$("#subtitle-color").value,highlight:$("#subtitle-highlight").value,background:$("#subtitle-background").checked,fontWeight:Number($("#subtitle-weight").value),highlightStyle:$("#subtitle-highlight-style").value,edgeOffset:Number($("#subtitle-offset").value)};
  }
  function update(){readControls();$("#subtitle-size-value").textContent=config.fontSize+"px";$("#subtitle-offset-value").textContent=config.edgeOffset+"%";render();}
  function applyConfig(value){
    config={...defaults,...(value||{})};window.__shortsflowSubtitleDirty=false;
    $("#subtitle-enabled").checked=config.enabled;$("#subtitle-preset").value=config.preset;$("#subtitle-position").value=config.position;
    $("#subtitle-size").value=config.fontSize;$("#subtitle-color").value=config.color;$("#subtitle-highlight").value=config.highlight;$("#subtitle-background").checked=config.background;$("#subtitle-weight").value=String(config.fontWeight);$("#subtitle-highlight-style").value=config.highlightStyle;$("#subtitle-offset").value=config.edgeOffset;
    update();
  }
  function render(){
    const overlay=$("#subtitle-live-overlay"),video=$("#clip-preview-video");if(!overlay||!video)return;
    overlay.className="subtitle-live-overlay "+(config.position==="top"?"is-top":config.position==="center"?"is-center":"is-bottom")+" "+(config.preset||"pop")+" "+(config.background?"has-background":"")+" highlight-"+config.highlightStyle;
    overlay.style.setProperty("--subtitle-size",config.fontSize+"px");overlay.style.setProperty("--subtitle-color",config.color);overlay.style.setProperty("--subtitle-highlight",config.highlight);overlay.style.setProperty("--subtitle-weight",String(config.fontWeight));overlay.style.setProperty("--subtitle-edge",config.edgeOffset+"%");
    if(!config.enabled){overlay.innerHTML="";return;}
    const t=video.currentTime-Number(window.__shortsflowClipStart||0);
    const active=words.findIndex(w=>t>=w.start&&t<=w.end);
    if(active<0){overlay.innerHTML="";return;}
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
    const group=groups.find(items=>items.some(w=>w===words[active]))||[];
    overlay.innerHTML=group.map(w=>'<span class="'+(w===words[active]?"is-active":"")+'">'+esc(w.word)+'</span>').join(" ");
  }
  async function load(){
    const clip=window.__shortsflowActiveClip;
    if(!clip?.id)return;
    clipId=clip.id;$("#subtitle-status").textContent="Loading subtitle timing…";words=[];
    try{
      const r=await fetch("/api/clips/"+encodeURIComponent(clipId)+"/subtitles",{headers:{accept:"application/json"}});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Subtitle data unavailable.");
      words=d.words||[];applyConfig(d.config);
      $("#subtitle-status").textContent=words.length?words.length.toLocaleString()+" timestamped words ready":"No word timestamps found. Run source transcription first.";
      if(!words.length)$("#subtitle-live-overlay").innerHTML="";
    }catch(e){$("#subtitle-status").textContent=e.message;}
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
