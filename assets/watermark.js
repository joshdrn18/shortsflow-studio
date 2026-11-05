(() => {
 const $=s=>document.querySelector(s);
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function panel(){
  let el=$("#watermark-settings");if(el)return el;
  el=document.createElement("section");el.id="watermark-settings";el.className="watermark-settings hidden";
  el.innerHTML='<div class="wm-card"><div class="wm-heading"><div><span class="wm-kicker">BRAND IDENTITY</span><h2>Watermark studio</h2><p>Set a consistent brand mark for future Shorts renders.</p></div><label class="wm-toggle"><input id="wm-enabled" type="checkbox" checked><span>Enabled</span></label></div><div class="wm-grid"><div class="wm-controls"><label>Watermark text<input id="wm-text" maxlength="40" value="YOUR BRAND" placeholder="Your channel name"></label><label>Position<select id="wm-position"><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right" selected>Bottom right</option></select></label><label>Size<select id="wm-scale"><option value="small">Small</option><option value="medium" selected>Medium</option><option value="large">Large</option></select></label><label>Opacity <span id="wm-opacity-value">72%</span><input id="wm-opacity" type="range" min="10" max="100" value="72"></label><button id="wm-save" class="primary-button">Save watermark settings</button><p id="wm-message" role="status"></p></div><div class="wm-preview-wrap"><span>LIVE PREVIEW</span><div id="wm-preview" class="wm-preview"><div id="wm-preview-mark">YOUR BRAND</div><small>9:16 SHORTS PREVIEW</small></div><p>Preview only. The watermark is applied during video rendering, not to the original source.</p></div></div></div>';
  $(".page-heading").after(el);
  ["wm-enabled","wm-text","wm-position","wm-scale","wm-opacity"].forEach(id=>$("#"+id).addEventListener("input",preview));
  $("#wm-save").addEventListener("click",save);
  return el;
 }
 function preview(){
  const mark=$("#wm-preview-mark"),box=$("#wm-preview");if(!mark)return;
  mark.textContent=$("#wm-text").value.trim()||"YOUR BRAND";
  mark.style.opacity=Number($("#wm-opacity").value)/100;
  mark.className="wm-mark wm-"+$("#wm-position").value+" wm-size-"+$("#wm-scale").value;
  $("#wm-opacity-value").textContent=$("#wm-opacity").value+"%";
  box.classList.toggle("wm-disabled",!$("#wm-enabled").checked);
 }
 async function load(){
  panel();$("#wm-message").textContent="Loading saved settings…";
  try{const r=await fetch("/api/workspace/settings");const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not load settings.");
   const s=d.settings;$("#wm-enabled").checked=s.watermarkEnabled;$("#wm-text").value=s.watermarkText;$("#wm-position").value=s.watermarkPosition;$("#wm-scale").value=s.watermarkScale;$("#wm-opacity").value=Math.round(s.watermarkOpacity*100);preview();$("#wm-message").textContent="Settings loaded.";
  }catch(e){$("#wm-message").textContent=e.message;}
 }
 async function save(){
  const b=$("#wm-save"),msg=$("#wm-message");b.disabled=true;b.textContent="Saving…";
  try{const payload={watermarkEnabled:$("#wm-enabled").checked,watermarkText:$("#wm-text").value,watermarkPosition:$("#wm-position").value,watermarkScale:$("#wm-scale").value,watermarkOpacity:Number($("#wm-opacity").value)/100};
   const r=await fetch("/api/workspace/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Could not save settings.");msg.textContent="Watermark settings saved to your workspace.";
  }catch(e){msg.textContent=e.message;}finally{b.disabled=false;b.textContent="Save watermark settings";}
 }
 document.addEventListener("DOMContentLoaded",()=>{
  panel();
  document.querySelectorAll('[data-view="settings"]').forEach(btn=>btn.addEventListener("click",()=>{
   const show=$("#watermark-settings");show.classList.remove("hidden");
   $(".welcome-panel")?.classList.add("hidden");$(".section-head")?.classList.add("hidden");$(".stats-grid")?.classList.add("hidden");$(".lower-grid")?.classList.add("hidden");
   load();
  }));
 });
})();