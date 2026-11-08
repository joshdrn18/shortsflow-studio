(() => {
  const $ = s => document.querySelector(s);
  let loaded = false;
  function mount() {
    if ($("#workspace-settings")) return;
    const panel = document.createElement("section");
    panel.id = "workspace-settings";
    panel.className = "workspace-settings hidden";
    panel.innerHTML = `
      <div class="settings-intro"><div><span class="settings-kicker">CONTROL CENTER</span><h2>Workspace settings</h2><p>Manage your account, production workflow, brand identity and workspace health.</p></div><span class="settings-private">PRIVATE WORKSPACE</span></div>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections">
          <button class="selected" data-settings-tab="general">◈ <span>General</span></button>
          <button data-settings-tab="workflow">⌁ <span>Workflow & safety</span></button>
          <button data-settings-tab="account">◎ <span>Account & security</span></button>
          <button data-settings-tab="system">▦ <span>System status</span></button>
        </nav>
        <div class="settings-content">
          <section class="settings-tab-panel" data-settings-panel="general">
            <div class="settings-section-heading"><div><h3>Workspace overview</h3><p>Your production space at a glance.</p></div><span class="settings-live-dot">LIVE</span></div>
            <div class="settings-stats">
              <article><small>Source videos</small><strong id="settings-sources">—</strong></article>
              <article><small>Discovered clips</small><strong id="settings-clips">—</strong></article>
              <article><small>Awaiting review</small><strong id="settings-review">—</strong></article>
              <article><small>Published</small><strong id="settings-published">—</strong></article>
            </div>
            <div class="settings-info-card"><span class="settings-info-icon">▣</span><div><b>Personal workspace</b><p>Your sources, clips, renders and settings are isolated to your signed-in workspace.</p><small id="settings-workspace-id">Loading workspace details…</small></div></div>
            <div class="settings-info-card"><span class="settings-info-icon">✳</span><div><b>Brand identity</b><p>Configure your watermark, placement, size and opacity for future renders below.</p><button class="settings-inline-action" data-settings-jump="watermark-settings">Open watermark studio →</button></div></div>
          </section>
          <section class="settings-tab-panel hidden" data-settings-panel="workflow">
            <div class="settings-section-heading"><div><h3>Workflow & publishing safety</h3><p>Controls that protect your channel and production queue.</p></div></div>
            <div class="settings-safety-card"><span class="settings-safety-icon">✓</span><div><b>Manual approval is required</b><p>ShortsFlow does not publish a discovered or rendered clip automatically. A clip must pass through Review Center and receive your approval before it can be queued for YouTube.</p><span class="settings-status-pill">PROTECTED</span></div></div>
            <div class="settings-info-card"><span class="settings-info-icon">↗</span><div><b>YouTube publishing</b><p>Manage channel connection and approved upload jobs in the Publisher section. Disconnecting or changing the channel is handled there.</p><button class="settings-inline-action" data-settings-go="publisher">Open Publisher →</button></div></div>
            <div class="settings-info-card"><span class="settings-info-icon">▤</span><div><b>Storage cleanup</b><p>Delete unused source videos or clip candidates to remove their private stored media and related workspace records. Published videos remain on YouTube.</p><button class="settings-inline-action" data-settings-go="sources">Manage source videos →</button></div></div>
          </section>
          <section class="settings-tab-panel hidden" data-settings-panel="account">
            <div class="settings-section-heading"><div><h3>Account & security</h3><p>Signed-in account information and session controls.</p></div></div>
            <div class="settings-account-card"><div class="settings-account-avatar" id="settings-avatar">S</div><div><b id="settings-user-name">Loading account…</b><p id="settings-user-email">—</p><small id="settings-user-role">Personal workspace member</small></div></div>
            <div class="settings-info-card"><span class="settings-info-icon">⌑</span><div><b>Session security</b><p>Your session is protected by a secure, HTTP-only sign-in cookie. Sign out to end this browser session.</p><button class="settings-danger-action" id="settings-signout">Sign out of this account</button></div></div>
            <p class="settings-muted-note">Password changes and multi-factor authentication are not available in this build yet.</p>
          </section>
          <section class="settings-tab-panel hidden" data-settings-panel="system">
            <div class="settings-section-heading"><div><h3>System status</h3><p>Connection health for the services powering your workspace.</p></div><button class="settings-refresh" id="settings-refresh">↻ Refresh</button></div>
            <div class="settings-system-list">
              <div><span><i></i> Application API</span><b id="settings-api-status">Checking…</b></div>
              <div><span><i></i> Database (D1)</span><b id="settings-db-status">Checking…</b></div>
              <div><span><i></i> Private media storage</span><b id="settings-storage-status">Checking…</b></div>
            </div>
            <p class="settings-muted-note" id="settings-system-detail">Checking service health…</p>
          </section>
        </div>
      </div>`;
    $(".page-heading")?.after(panel);
    panel.addEventListener("click", e => {
      const tab=e.target.closest("[data-settings-tab]");
      if(tab){showTab(tab.dataset.settingsTab);return;}
      const jump=e.target.closest("[data-settings-jump]");
      if(jump){$("#"+jump.dataset.settingsJump)?.scrollIntoView({behavior:"smooth",block:"start"});return;}
      const go=e.target.closest("[data-settings-go]");
      if(go){document.querySelector('.nav-item[data-view="'+go.dataset.settingsGo+'"]')?.click();}
    });
    $("#settings-signout")?.addEventListener("click",async()=>{
      if(!confirm("Sign out of this ShortsFlow workspace?"))return;
      const b=$("#settings-signout");b.disabled=true;b.textContent="Signing out…";
      try{const r=await fetch("/api/auth/logout",{method:"POST",headers:{accept:"application/json"}});if(!r.ok)throw new Error("Sign out failed.");$("#auth-overlay")?.classList.remove("hidden");$("#auth-message").textContent="You have signed out.";$("#auth-message").className="auth-message";}
      catch(e){alert(e.message||"Could not sign out.");}
      finally{b.disabled=false;b.textContent="Sign out of this account";}
    });
    $("#settings-refresh")?.addEventListener("click",load);
  }
  function showTab(name){
    document.querySelectorAll("[data-settings-tab]").forEach(b=>b.classList.toggle("selected",b.dataset.settingsTab===name));
    document.querySelectorAll("[data-settings-panel]").forEach(p=>p.classList.toggle("hidden",p.dataset.settingsPanel!==name));
  }
  async function load(){
    const [me,summary,health]=await Promise.all([
      fetch("/api/auth/me").then(r=>r.json()).catch(()=>({})),
      fetch("/api/workspace/summary").then(r=>r.json()).catch(()=>({})),
      fetch("/api/health").then(r=>r.json()).catch(()=>({}))
    ]);
    if(me.user){
      const u=me.user, name=u.displayName||u.name||"Workspace member";
      $("#settings-user-name").textContent=name;
      $("#settings-user-email").textContent=u.email||"Email unavailable";
      $("#settings-avatar").textContent=(name.trim()[0]||"S").toUpperCase();
      $("#settings-user-role").textContent=u.role||"Personal workspace member";
      $("#settings-workspace-id").textContent=u.workspace?.name||("Workspace ID · "+(u.workspace?.id||"Unavailable"));
    }
    if(summary.stats){
      $("#settings-sources").textContent=summary.stats.sources;
      $("#settings-clips").textContent=summary.stats.clips;
      $("#settings-review").textContent=summary.stats.awaitingReview;
      $("#settings-published").textContent=summary.stats.published;
    }
    const api=!!health.ok, db=!!health.database, storage=!!health.mediaConfigured;
    $("#settings-api-status").textContent=api?"Operational":"Unavailable";
    $("#settings-db-status").textContent=db?"Connected":"Not connected";
    $("#settings-storage-status").textContent=storage?"Configured":"Not configured";
    $("#settings-system-detail").textContent=health.version?"API version "+health.version:"Could not retrieve service details.";
    document.querySelectorAll(".settings-system-list i").forEach((dot,i)=>dot.classList.toggle("ok",[api,db,storage][i]));
    loaded=true;
  }
  document.addEventListener("DOMContentLoaded",mount);
  document.addEventListener("shortsflow:view",e=>{
    if(e.detail?.view!=="settings")return;
    mount();
    $("#workspace-settings")?.classList.remove("hidden");
    showTab("general");
    if(!loaded)load();
  });
})();