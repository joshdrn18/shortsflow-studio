(() => {
  const $ = (selector) => document.querySelector(selector);
  let mounted = false;
  let loading = false;
  let refreshTimer = null;

  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const number = (value, digits = 0) => new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(Number(value) || 0);
  const time = (value) => {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Time unavailable";
    return new Intl.DateTimeFormat("en-MY", {
      timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short"
    }).format(date) + " MYT";
  };

  function mount() {
    if (mounted || $("#admin-usage-workspace")) return;
    const panel = document.createElement("section");
    panel.id = "admin-usage-workspace";
    panel.className = "admin-usage-workspace hidden";
    panel.innerHTML = `
      <div class="admin-usage-heading">
        <div><span class="admin-usage-kicker">ADMIN CONTROL CENTER</span><h2>AI Usage & Limits</h2><p>Monitor reserved AI budget, safety thresholds and quota errors for this ShortsFlow workspace. Auto-refreshes every 60 seconds while open.</p></div>
        <button type="button" class="admin-usage-refresh" id="admin-usage-refresh">↻ Refresh usage</button>
      </div>
      <div class="admin-usage-content" id="admin-usage-content"><div class="admin-usage-loading">Loading usage ledger…</div></div>`;
    $(".page-heading")?.after(panel);
    panel.addEventListener("click", (event) => {
      if (event.target.closest("#admin-usage-refresh")) load();
    });
    mounted = true;
  }

  function render(data) {
    const content = $("#admin-usage-content");
    if (!content) return;
    const budget = data.internalBudget || {};
    const cloudflare = data.cloudflare || {};
    const incidents = data.quotaIncidents || {};
    const history = Array.isArray(data.history) ? data.history : [];
    const events = Array.isArray(incidents.events) ? incidents.events : [];
    const providerHistory = Array.isArray(cloudflare.history) ? cloudflare.history : [];
    const providerConnected = cloudflare.actualUsageStatus === "connected";
    const providerUsage = cloudflare.actualUsage === null || cloudflare.actualUsage === undefined ? null : Number(cloudflare.actualUsage);
    const providerPercent = Math.max(0, Number(cloudflare.usagePercentOfReference || 0));
    const reserved = Number(budget.reservedNeurons || 0);
    const limit = Number(budget.dailyLimit || 3500);
    const percent = Math.max(0, Math.min(100, Number(budget.percent || 0)));
    const state = budget.status || "healthy";
    const stateLabel = ({
      healthy: "Within safety budget",
      warning: "Approaching safety budget",
      critical: "Near safety limit",
      "limit-reached": "Safety limit reached"
    })[state] || "Status unavailable";
    const stateClass = state === "healthy" ? "good" : state === "warning" ? "warning" : "critical";

    content.innerHTML = `
      <div class="admin-usage-status ${stateClass}">
        <span class="admin-usage-status-dot"></span>
        <div><b>${escapeHTML(stateLabel)}</b><small>Last refreshed ${escapeHTML(time(data.asOf))} · Ledger date ${escapeHTML(data.usageDateUTC || "—")} UTC</small></div>
        <span class="admin-usage-status-tag">${escapeHTML(state.replace("-", " ").toUpperCase())}</span>
      </div>
      <div class="admin-usage-metrics">
        <article class="admin-usage-card primary">
          <span>ShortsFlow reserved today</span>
          <strong>${number(reserved, 2)} <small>neurons</small></strong>
          <p>Estimated reservations · UTC day</p>
        </article>
        <article class="admin-usage-card">
          <span>Internal safety budget</span>
          <strong>${number(limit)} <small>neurons/day</small></strong>
          <p>ShortsFlow's own admission-control cap</p>
        </article>
        <article class="admin-usage-card">
          <span>Cloudflare AI usage today</span>
          <strong>${providerUsage === null ? "—" : number(providerUsage, 2)} <small>neurons</small></strong>
          <p>${providerConnected ? "Account-wide provider analytics · UTC" : "Provider analytics unavailable"}</p>
        </article>
        <article class="admin-usage-card">
          <span>Quota incidents logged</span>
          <strong>${number(incidents.total || 0)}</strong>
          <p>Recorded Workers AI quota/safety errors</p>
        </article>
      </div>
      <div class="admin-usage-grid">
        <section class="admin-usage-panel">
          <div class="admin-usage-panel-head"><div><h3>Daily safety budget</h3><p>Internal reservations compared with the ShortsFlow cap.</p></div><b>${number(percent, 1)}%</b></div>
          <div class="admin-usage-progress"><span style="width:${percent}%"></span></div>
          <div class="admin-usage-progress-labels"><span>${number(reserved, 2)} reserved</span><span>${number(Math.max(0, Number(budget.remainingToSafetyBudget || 0)), 2)} remaining to internal cap</span></div>
          <div class="admin-usage-details">
            <div><span>Reserved audio</span><b>${number(Number(budget.audioSecondsReserved || 0) / 60, 1)} min</b></div>
            <div><span>Latest reservation</span><b>${escapeHTML(time(budget.lastReservedAt))}</b></div>
          </div>
          <div class="admin-usage-note"><b>Important:</b> This meter shows estimated neuron reservations made by ShortsFlow before AI calls. It is not the actual Cloudflare account-wide usage.</div>
        </section>
        <section class="admin-usage-panel">
          <div class="admin-usage-panel-head"><div><h3>Cloudflare account usage</h3><p>Account-wide Workers AI inference telemetry.</p></div><span class="admin-usage-connection ${providerConnected ? "connected" : "disconnected"}">${providerConnected ? "ANALYTICS CONNECTED" : cloudflare.actualUsageStatus === "error" ? "CHECK PERMISSIONS" : "NOT CONNECTED"}</span></div>
          ${providerConnected ? `
            <div class="admin-usage-provider-value"><strong>${number(providerUsage, 2)} <small>neurons</small></strong><span>${escapeHTML(data.usageDateUTC || "—")} UTC</span></div>
            <div class="admin-usage-progress"><span style="width:${Math.min(100, providerPercent)}%"></span></div>
            <div class="admin-usage-progress-labels"><span>${number(providerPercent, 1)}% of published Free reference</span><span>${number(cloudflare.dailyFreeAllocationReference)} neurons/day</span></div>
            <div class="admin-usage-details">
              <div><span>Estimated headroom</span><b>${cloudflare.estimatedHeadroom == null ? "—" : number(cloudflare.estimatedHeadroom, 2) + " neurons"}</b></div>
              <div><span>Analytics data through</span><b>${escapeHTML(cloudflare.latestDataDate || data.usageDateUTC || "—")} UTC</b></div>
            </div>
            <div class="admin-usage-note"><b>Usage source:</b> Cloudflare GraphQL Analytics. Estimated headroom is calculated against the published Free allocation; this is not a live remaining-neuron balance. Analytics may be delayed.</div>
          ` : `
            <div class="admin-usage-unavailable-body"><strong>${cloudflare.actualUsageStatus === "error" ? "Analytics connection needs attention" : "Live usage unavailable"}</strong><p>${escapeHTML(cloudflare.note || "Add the CLOUDFLARE_ANALYTICS_TOKEN Pages secret to enable account-wide Workers AI analytics.")}</p><a href="https://developers.cloudflare.com/workers-ai/platform/pricing/" target="_blank" rel="noopener noreferrer">Workers AI allocation & pricing ↗</a></div>
          `}
        </section>
      </div>
      <div class="admin-usage-grid lower">
        <section class="admin-usage-panel">
          <div class="admin-usage-panel-head"><div><h3>Cloudflare daily AI usage</h3><p>Provider-reported account-wide neurons from Analytics · UTC.</p></div></div>
          ${providerConnected && providerHistory.length ? `<div class="admin-usage-history">${providerHistory.map((row) => {
            const value = Number(row.neurons || 0);
            const width = Math.min(100, (value / Number(cloudflare.dailyFreeAllocationReference || 10000)) * 100);
            return `<div class="admin-usage-history-row"><div><b>${escapeHTML(row.date)}</b><strong>${number(value, 2)} neurons</strong></div><div class="admin-usage-mini-track"><span style="width:${width}%"></span></div><small>${number(Number(row.audioSeconds || 0) / 60, 1)} min audio · ${number(row.requests)} inference records</small></div>`;
          }).join("")}</div>` : '<div class="admin-usage-empty">Cloudflare Analytics history is not available.</div>'}
          <div class="admin-usage-subsection"><div class="admin-usage-panel-head"><div><h3>ShortsFlow daily reservations</h3><p>Estimated reservations recorded in this workspace · UTC.</p></div></div>
          ${history.length ? `<div class="admin-usage-history">${history.map((row) => {
            const value = Number(row.neuronsReserved || 0);
            const width = Math.min(100, (value / limit) * 100);
            return `<div class="admin-usage-history-row"><div><b>${escapeHTML(row.date)}</b><strong>${number(value, 2)} neurons</strong></div><div class="admin-usage-mini-track"><span style="width:${width}%"></span></div><small>${number(Number(row.audioSecondsReserved || 0) / 60, 1)} min audio reserved</small></div>`;
          }).join("")}</div>` : '<div class="admin-usage-empty">No reservation history has been recorded yet.</div>'}</div>
        </section>
        <section class="admin-usage-panel">
          <div class="admin-usage-panel-head"><div><h3>Quota incident monitor</h3><p>Failed calls and internal budget blocks saved by the pipeline.</p></div><b>${number(incidents.total || 0)} total</b></div>
          ${events.length ? `<div class="admin-usage-events">${events.map((event) => `
            <article><div><b>${escapeHTML(event.source || "AI pipeline")}</b><small>${escapeHTML(time(event.at))} · ${escapeHTML(event.status || "logged")}</small></div><p>${escapeHTML(event.message || "Quota incident recorded.")}</p></article>
          `).join("")}</div>` : '<div class="admin-usage-empty">No quota incidents have been recorded in the current job history.</div>'}
        </section>
      </div>
      <p class="admin-usage-footnote">Scope: ${escapeHTML(data.ledger?.scope || "ShortsFlow internal ledger")}. ${escapeHTML(data.ledger?.description || "")}</p>`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    const button = $("#admin-usage-refresh");
    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    try {
      const response = await fetch("/api/admin/ai-usage", { headers: { accept: "application/json" }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load AI usage data.");
      render(data);
    } catch (error) {
      const content = $("#admin-usage-content");
      if (content) content.innerHTML = `<div class="admin-usage-error"><b>Usage data unavailable</b><p>${escapeHTML(error.message || "Please refresh and try again.")}</p><button type="button" id="admin-usage-retry">Try again</button></div>`;
    } finally {
      loading = false;
      if (button) { button.disabled = false; button.textContent = "↻ Refresh usage"; }
    }
  }

  function stopLiveRefresh() {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  function startLiveRefresh() {
    stopLiveRefresh();
    if (document.hidden) return;
    refreshTimer = window.setInterval(() => {
      if (!document.hidden && !loading) load();
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", mount);
  document.addEventListener("shortsflow:view", (event) => {
    if (event.detail?.view !== "admin") {
      stopLiveRefresh();
      return;
    }
    mount();
    $("#admin-usage-workspace")?.classList.remove("hidden");
    load();
    startLiveRefresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLiveRefresh();
    } else if (!$("#admin-usage-workspace")?.classList.contains("hidden")) {
      load();
      startLiveRefresh();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#admin-usage-retry")) load();
  });
})();