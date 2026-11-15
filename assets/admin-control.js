(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  let mounted = false;
  let loading = false;
  let snapshot = null;
  let activeTab = "overview";
  let memberQuery = "";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const fmt = (value) => new Intl.NumberFormat("en-US").format(Number(value) || 0);
  const when = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-MY", {timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"});
  };
  const countByStatus = (items) => Object.fromEntries((items || []).map((item) => [item.status, Number(item.total || 0)]));
  const statusPill = (status) => `<span class="ac-status ac-${esc(String(status || "unknown").replace(/[^a-z0-9_-]/gi,""))}">${esc(status || "unknown")}</span>`;

  function mount() {
    if (mounted || $("#admin-control-workspace")) return;
    const panel = document.createElement("section");
    panel.id = "admin-control-workspace";
    panel.className = "admin-control-workspace hidden";
    panel.innerHTML = `
      <header class="ac-heading"><div><span class="ac-kicker">GLOBAL ADMINISTRATION</span><h2>Platform control center</h2><p>Members, production queues, system status and platform activity.</p></div><button type="button" class="ac-refresh" id="ac-refresh">↻ Refresh</button></header>
      <nav class="ac-tabs" aria-label="Admin sections">
        <button type="button" data-admin-tab="overview" class="active">Overview</button>
        <button type="button" data-admin-tab="members">Members</button>
        <button type="button" data-admin-tab="jobs">Jobs & queues</button>
        <button type="button" data-admin-tab="activity">Activity log</button>
        <button type="button" data-admin-tab="health">System health</button>
      </nav>
      <div id="ac-content" class="ac-content"><div class="ac-loading">Loading platform data…</div></div>`;
    $(".page-heading")?.after(panel);
    panel.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-admin-tab]")?.dataset.adminTab;
      if (tab) { activeTab = tab; render(); }
      if (event.target.closest("#ac-refresh")) load();
    });
    panel.addEventListener("input", (event) => {
      if (event.target.id === "ac-member-search") { memberQuery = event.target.value; renderMembers(); }
    });
    mounted = true;
  }

  function renderOverview() {
    const d = snapshot || {};
    const t = d.totals || {};
    const p = countByStatus(d.queues?.processing);
    const r = countByStatus(d.queues?.rendering);
    const a = countByStatus(d.queues?.autopilot);
    const activeJobs = (p.queued||0)+(p.claimed||0)+(p.running||0)+(r.queued||0)+(r.running||0)+(a.queued||0)+(a.generating||0)+(a.generating_scenes||0)+(a.render_queued||0)+(a.rendering||0);
    const failed = (p.failed||0)+(r.failed||0)+(a.failed||0);
    return `
      <div class="ac-updated">Data snapshot · ${esc(when(d.asOf))} MYT</div>
      <div class="ac-metrics">
        ${metric("Total members",t.users,"Across all accounts")}
        ${metric("Workspaces",t.workspaces,"Member workspaces")}
        ${metric("Source videos",t.sources,"Uploaded or linked")}
        ${metric("Discovered clips",t.clips,"All workspaces")}
        ${metric("Awaiting review",t.awaitingReview,"Human approval required")}
        ${metric("Published Shorts",t.published,"Published content")}
        ${metric("Active jobs",activeJobs,"Processing, render and autopilot")}
        ${metric("Failed jobs",failed,"Across all queues")}
      </div>
      <div class="ac-columns">
        <section class="ac-panel"><div class="ac-panel-head"><div><h3>Queue status</h3><p>Live counts from D1 job tables.</p></div></div>
          ${queueBlock("Source processing",p)}${queueBlock("Background rendering",r)}${queueBlock("Content autopilot",a)}
        </section>
        <section class="ac-panel"><div class="ac-panel-head"><div><h3>Member accounts</h3><p>Latest registrations.</p></div><button class="ac-link" data-admin-tab="members">View all →</button></div>
          ${(d.members||[]).slice(0,5).map(memberRow).join("") || empty("No member accounts yet.")}
        </section>
      </div>
      <section class="ac-panel"><div class="ac-panel-head"><div><h3>Recent platform activity</h3><p>Latest events recorded by workspaces.</p></div><button class="ac-link" data-admin-tab="activity">Open log →</button></div>
        ${(d.activity||[]).slice(0,6).map(activityRow).join("") || empty("No activity has been recorded yet.")}
      </section>`;
  }
  function metric(label,value,note) { return `<article class="ac-metric"><span>${esc(label)}</span><strong>${fmt(value)}</strong><small>${esc(note)}</small></article>`; }
  function queueBlock(label,counts) {
    const keys=Object.keys(counts);
    return `<div class="ac-queue"><b>${esc(label)}</b><div>${keys.length ? keys.map(k=>`<span>${statusPill(k)} <strong>${fmt(counts[k])}</strong></span>`).join("") : '<small>No jobs recorded</small>'}</div></div>`;
  }
  function memberRow(m) {
    return `<article class="ac-member"><div class="ac-avatar">${esc((m.display_name||m.email||"M").slice(0,1).toUpperCase())}</div><div class="ac-member-main"><b>${esc(m.display_name||"Unnamed member")}</b><small>${esc(m.email)}</small></div><div class="ac-member-meta">${statusPill(m.status)}<small>${fmt(m.workspace_count)} workspace(s)</small></div></article>`;
  }
  function activityRow(item) {
    return `<article class="ac-activity"><span class="ac-activity-dot"></span><div><b>${esc(String(item.event||"update").replace(/[._-]+/g," "))}</b><small>${esc(item.workspace||"Workspace")} · ${esc(when(item.created_at))}</small>${item.details ? `<p>${esc(item.details)}</p>` : ""}</div></article>`;
  }
  function empty(message) { return `<div class="ac-empty">${esc(message)}</div>`; }
  function renderMembers() {
    const content=$("#ac-content"); if(!content||activeTab!=="members")return;
    const q=memberQuery.trim().toLowerCase();
    const items=(snapshot?.members||[]).filter(m=>!q||[m.email,m.display_name,m.workspace_names].join(" ").toLowerCase().includes(q));
    content.innerHTML=`<div class="ac-panel"><div class="ac-panel-head"><div><h3>Member directory</h3><p>Latest 100 registered accounts. Workspace ownership does not grant global admin access.</p></div><span class="ac-count">${fmt(snapshot?.totals?.users)} total</span></div>
      <input id="ac-member-search" class="ac-search" type="search" placeholder="Search name, email or workspace…" value="${esc(memberQuery)}">
      <div class="ac-table-wrap"><table class="ac-table"><thead><tr><th>Member</th><th>System role</th><th>Status</th><th>Workspaces</th><th>Joined</th></tr></thead><tbody>
      ${items.map(m=>`<tr><td><b>${esc(m.display_name||"Unnamed")}</b><small>${esc(m.email)}</small></td><td>${statusPill(m.system_role)}</td><td>${statusPill(m.status)}</td><td>${fmt(m.workspace_count)}</td><td>${esc(when(m.created_at))}</td></tr>`).join("")||'<tr><td colspan="5">No matching members.</td></tr>'}
      </tbody></table></div></div>`;
    const input=$("#ac-member-search"); input?.focus(); if(input) input.setSelectionRange(input.value.length,input.value.length);
  }
  function renderJobs() {
    const jobs=snapshot?.jobs||[];
    $("#ac-content").innerHTML=`<div class="ac-panel"><div class="ac-panel-head"><div><h3>Production job monitor</h3><p>Latest 40 processing, render and autopilot jobs across all workspaces. Read-only monitoring.</p></div></div>
      <div class="ac-table-wrap"><table class="ac-table"><thead><tr><th>Job</th><th>Workspace</th><th>Status</th><th>Attempts</th><th>Updated</th></tr></thead><tbody>
      ${jobs.map(j=>`<tr><td><b>${esc(j.title||j.type||"Job")}</b><small>${esc(j.id)}</small>${j.error?`<p class="ac-job-error">${esc(j.error)}</p>`:""}</td><td>${esc(j.workspace||"—")}</td><td>${statusPill(j.status)}</td><td>${fmt(j.attempts)}</td><td>${esc(when(j.updated_at))}</td></tr>`).join("")||'<tr><td colspan="5">No jobs have been recorded.</td></tr>'}
      </tbody></table></div></div>`;
  }
  function renderActivity() {
    $("#ac-content").innerHTML=`<div class="ac-panel"><div class="ac-panel-head"><div><h3>Platform activity log</h3><p>Latest 40 workspace events across the platform.</p></div></div>
      ${(snapshot?.activity||[]).map(activityRow).join("")||empty("No activity has been recorded yet.")}</div>`;
  }
  async function renderHealth() {
    const health=$("#ac-content");
    health.innerHTML='<div class="ac-loading">Checking API, D1 and R2…</div>';
    try {
      const response=await fetch("/api/health",{headers:{accept:"application/json"},cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error("Health endpoint returned "+response.status);
      const checks=[
        ["Pages API",true,"Responding"],
        ["D1 database",Boolean(data.database),data.database?"Connected":"Not connected"],
        ["R2 media storage",Boolean(data.mediaConfigured),data.mediaConfigured?"Binding configured":"Binding missing"]
      ];
      health.innerHTML=`<div class="ac-panel"><div class="ac-panel-head"><div><h3>System health</h3><p>Checks reported by the production Pages API.</p></div><span class="ac-updated">${esc(when(data.timestamp))}</span></div>
        <div class="ac-health-list">${checks.map(c=>`<div class="ac-health-row"><span class="ac-health-dot ${c[1]?"ok":"bad"}"></span><b>${esc(c[0])}</b><span>${esc(c[2])}</span></div>`).join("")}</div>
        <p class="ac-health-note">This checks configured bindings and database connectivity. It does not claim provider-wide Cloudflare usage or YouTube API availability.</p></div>`;
    } catch(error) { health.innerHTML=`<div class="ac-empty">${esc(error.message||"Health check failed.")}</div>`; }
  }
  function render() {
    if(!snapshot)return;
    const content=$("#ac-content"); if(!content)return;
    if(activeTab==="overview")content.innerHTML=renderOverview();
    else if(activeTab==="members")renderMembers();
    else if(activeTab==="jobs")renderJobs();
    else if(activeTab==="activity")renderActivity();
    else if(activeTab==="health")renderHealth();
    document.querySelectorAll("[data-admin-tab]").forEach(b=>b.classList.toggle("active",b.dataset.adminTab===activeTab));
  }
  async function load() {
    if(loading)return; loading=true;
    const button=$("#ac-refresh"); if(button){button.disabled=true;button.textContent="Refreshing…";}
    try {
      const response=await fetch("/api/admin/overview",{headers:{accept:"application/json"},cache:"no-store"});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||"Could not load admin data.");
      snapshot=data; render();
    } catch(error) {
      const content=$("#ac-content");
      if(content)content.innerHTML=`<div class="ac-empty ac-error"><b>Admin data unavailable</b><p>${esc(error.message||"Please refresh and try again.")}</p><button id="ac-retry" type="button">Try again</button></div>`;
    } finally {loading=false;if(button){button.disabled=false;button.textContent="↻ Refresh";}}
  }
  document.addEventListener("DOMContentLoaded",mount);
  document.addEventListener("shortsflow:view",event=>{
    if(event.detail?.view!=="admin")return;
    mount(); $("#admin-control-workspace")?.classList.remove("hidden");
    activeTab="overview"; load();
  });
  document.addEventListener("click",event=>{if(event.target.closest("#ac-retry"))load();});
})();