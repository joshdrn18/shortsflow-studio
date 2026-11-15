(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let data = null, busy = false, active = false;
  const when = v => v ? new Date(v).toLocaleString("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"}) : "—";
  function install() {
    const nav = $("#admin-control-workspace .ac-tabs");
    if (!nav || $("#ac-admin-controls-tab")) return;
    const tab = document.createElement("button");
    tab.type="button"; tab.id="ac-admin-controls-tab"; tab.textContent="Controls & audit"; tab.dataset.adminControls="1";
    nav.append(tab);
    tab.addEventListener("click", () => { active=true; nav.querySelectorAll("button").forEach(b=>b.classList.toggle("active",b===tab)); render(); });
    $("#admin-control-workspace").addEventListener("click", e => {
      const b=e.target.closest("[data-control-action]");
      if (b) act(b);
    });
  }
  async function load() {
    if(busy)return; busy=true;
    try {
      const r=await fetch("/api/admin/overview",{headers:{accept:"application/json"},cache:"no-store"});
      const j=await r.json(); if(!r.ok||!j.ok)throw new Error(j.error||"Could not load admin controls.");
      data=j; if(active)render();
    } catch(e) { const c=$("#ac-content"); if(active&&c)c.innerHTML='<div class="ac-empty ac-error">'+esc(e.message)+'</div>'; }
    finally {busy=false;}
  }
  function actionButton(action, attrs, label, cls) {
    return '<button type="button" class="ac-action '+(cls||"")+'" data-control-action="'+action+'" '+attrs+'>'+label+'</button>';
  }
  function render() {
    const c=$("#ac-content"); if(!c||!data)return;
    const members=data.members||[], jobs=data.jobs||[], spaces=data.autopilotSettings||[], audit=data.adminAudit||[];
    let h='<div class="ac-panel"><div class="ac-panel-head"><div><h3>Member access controls</h3><p>Global admins are protected. Suspending a member blocks their account from signing in.</p></div></div><div class="ac-table-wrap"><table class="ac-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    h+=members.map(m=>'<tr><td><b>'+esc(m.display_name||"Unnamed")+'</b><small>'+esc(m.email)+'</small></td><td>'+esc(m.system_role)+'</td><td>'+esc(m.status)+'</td><td>'+(m.system_role==="member"?actionButton(m.status==="suspended"?"activate_member":"suspend_member",'data-user-id="'+esc(m.id)+'"',m.status==="suspended"?"Reactivate":"Suspend",m.status==="suspended"?"ac-positive":"ac-danger"):"Protected")+'</td></tr>').join("");
    h+='</tbody></table></div></div>';
    h+='<div class="ac-panel"><div class="ac-panel-head"><div><h3>Queue actions</h3><p>Only failed jobs can be retried; only queued jobs can be cancelled. Running jobs are never force-stopped.</p></div></div><div class="ac-table-wrap"><table class="ac-table"><thead><tr><th>Job</th><th>Workspace</th><th>Type</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    h+=jobs.map(j=>'<tr><td><b>'+esc(j.title||j.type||"Job")+'</b><small>'+esc(j.id)+'</small></td><td>'+esc(j.workspace)+'</td><td>'+esc(j.queue_type||j.type)+'</td><td>'+esc(j.status)+'</td><td>'+((j.queue_type==="processing"||j.queue_type==="render")&&j.status==="failed"?actionButton("retry_job",'data-job-id="'+esc(j.id)+'" data-job-type="'+esc(j.queue_type)+'"',"Retry","ac-positive"):(j.queue_type==="processing"||j.queue_type==="render")&&j.status==="queued"?actionButton("cancel_job",'data-job-id="'+esc(j.id)+'" data-job-type="'+esc(j.queue_type)+'"',"Cancel","ac-danger"):"—")+'</td></tr>').join("");
    h+='</tbody></table></div></div>';
    h+='<div class="ac-panel"><div class="ac-panel-head"><div><h3>Autopilot controls</h3><p>Controls content generation per workspace. Manual review remains required before publishing.</p></div></div><div class="ac-table-wrap"><table class="ac-table"><thead><tr><th>Workspace</th><th>Daily target</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    h+=spaces.map(w=>'<tr><td><b>'+esc(w.name)+'</b><small>'+esc(w.workspace_id)+'</small></td><td>'+esc(w.daily_target)+'</td><td>'+ (Number(w.enabled)?"Enabled":"Paused")+'</td><td>'+actionButton("set_autopilot",'data-workspace-id="'+esc(w.workspace_id)+'" data-enabled="'+(Number(w.enabled)?"false":"true")+'"',Number(w.enabled)?"Pause":"Enable",Number(w.enabled)?"ac-danger":"ac-positive")+'</td></tr>').join("");
    h+='</tbody></table></div></div>';
    h+='<div class="ac-panel"><div class="ac-panel-head"><div><h3>Global admin audit log</h3><p>Recent privileged actions and the administrator who performed them.</p></div></div>';
    h+=audit.map(a=>'<article class="ac-activity"><span class="ac-activity-dot"></span><div><b>'+esc(a.action)+'</b><small>'+esc(a.admin_email)+' · '+esc(a.target_type)+' · '+esc(when(a.created_at))+'</small><p>'+esc(a.target_id||"")+' '+esc(a.details_json||"")+'</p></div></article>').join("")||'<div class="ac-empty">No global admin actions recorded yet.</div>';
    h+='</div><div class="ac-updated">Controls refreshed '+esc(when(data.asOf))+'</div>';
    c.innerHTML=h;
  }
  async function act(b) {
    const a=b.dataset.controlAction;
    const prompts={suspend_member:"Suspend this member? They will be signed out/blocked on next authentication.",activate_member:"Reactivate this member account?",retry_job:"Retry this failed job?",cancel_job:"Cancel this queued job?",set_autopilot:b.dataset.enabled==="true"?"Enable autopilot for this workspace?":"Pause autopilot for this workspace?"};
    if(!confirm(prompts[a]||"Confirm action?"))return;
    const body={action:a};
    if(b.dataset.userId)body.userId=b.dataset.userId;
    if(b.dataset.jobId){body.jobId=b.dataset.jobId;body.jobType=b.dataset.jobType;}
    if(b.dataset.workspaceId){body.workspaceId=b.dataset.workspaceId;body.enabled=b.dataset.enabled==="true";}
    b.disabled=true;
    try {
      const r=await fetch("/api/admin/actions",{method:"POST",headers:{"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify(body)});
      const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||"Action failed.");
      await load();render();
    } catch(e) { alert(e.message||"Admin action failed.");b.disabled=false; }
  }
  document.addEventListener("shortsflow:view", e=>{if(e.detail&&e.detail.view==="admin"){active=false;install();load();}});
  document.addEventListener("DOMContentLoaded",install);
  const observer=new MutationObserver(install);
  document.addEventListener("DOMContentLoaded",()=>{const root=$("#admin-control-workspace");if(root)observer.observe(root,{childList:true,subtree:true});});
})();