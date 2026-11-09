const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const activityLabels = {
  "source.uploaded": "Source video uploaded",
  "source.transcribed": "Source transcription completed",
  "source.clips_discovered": "AI clip discovery completed",
  "subtitle_settings_saved": "Subtitle settings saved",
  "job.queued": "AI analysis queued",
  "job.cancelled": "Analysis cancelled",
  "job.retried": "Analysis retried",
  "clip_rendered": "Clip render saved",
  "clip_edited": "Clip edits saved",
  "clip_review_approved": "Clip approved",
  "clip_review_rejected": "Clip rejected",
  "clip_review_changes_requested": "Changes requested",
  "youtube_publish_queued": "YouTube upload queued",
  "youtube.published": "Short published to YouTube"
};
const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
const views = {
  overview: ["Overview", "Your short-form production pipeline, all in one place."],
  sources: ["Sources", "Manage the long-form videos you want to turn into Shorts."],
  clips: ["Clip discovery", "Review AI-detected moments and potential short-form cuts."],
  review: ["Review center", "Your approval is required before any clip can be published."],
  library: ["Content library", "Browse rendered videos, drafts and published content."],
  publisher: ["Publisher", "Connect YouTube and manage approved publishing jobs."],
  settings: ["Settings", "Configure your workspace and production preferences."]
};
let activeView = "overview";

function toast(message) {
  const region = $("#toast-region");
  if (!region) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  region.append(node);
  window.setTimeout(() => node.remove(), 3400);
}

function ensurePlaceholder() {
  let panel = $("#feature-placeholder");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "feature-placeholder";
  panel.className = "panel feature-placeholder hidden";
  panel.innerHTML = "<div class='empty-icon'>✳</div><h2></h2><p></p>";
  $(".page-heading").after(panel);
  return panel;
}

function hideAllPagePanels() {
  [
    ".welcome-panel", ".section-head", ".stats-grid", ".lower-grid",
    "#sources-workspace", "#clips-workspace", "#review-workspace", "#library-workspace", "#publisher-workspace", "#watermark-settings", "#workspace-settings", "#feature-placeholder"
  ].forEach((selector) => $(selector)?.classList.add("hidden"));
}

function navigate(view) {
  const next = views[view] ? view : "overview";
  activeView = next;
  navItems.forEach((button) => {
    const selected = button.dataset.view === next;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  $("#crumb").textContent = views[next][0];
  $("#page-title").textContent = views[next][0];
  $("#page-subtitle").textContent = views[next][1];
  hideAllPagePanels();

  if (next === "overview") {
    [".welcome-panel", ".section-head", ".stats-grid", ".lower-grid"].forEach((selector) => $(selector)?.classList.remove("hidden"));
  } else if (next === "sources" || next === "clips" || next === "review" || next === "library" || next === "publisher" || next === "settings") {
    document.dispatchEvent(new CustomEvent("shortsflow:view", { detail: { view: next } }));
  } else {
    const panel = ensurePlaceholder();
    panel.querySelector("h2").textContent = views[next][0];
    panel.querySelector("p").textContent = "This workspace section is being built. Your existing videos and settings are safe.";
    panel.classList.remove("hidden");
  }

  const addButton = $("#add-source-btn");
  if (addButton) addButton.classList.toggle("hidden", !["overview", "sources"].includes(next));
  if (window.innerWidth <= 720) $("#sidebar")?.classList.remove("open");
}
navItems.forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));

const workspaceMenuTrigger = $("#workspace-menu-trigger");
const workspaceMenu = $("#workspace-menu");
function closeWorkspaceMenu() {
  workspaceMenu?.classList.add("hidden");
  workspaceMenuTrigger?.setAttribute("aria-expanded", "false");
}
workspaceMenuTrigger?.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = workspaceMenu?.classList.contains("hidden");
  workspaceMenu?.classList.toggle("hidden", !opening);
  workspaceMenuTrigger.setAttribute("aria-expanded", String(Boolean(opening)));
});
workspaceMenu?.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-workspace-action]")?.dataset.workspaceAction;
  if (!action) return;
  closeWorkspaceMenu();
  if (action === "settings") {
    navigate("settings");
  } else if (action === "refresh") {
    await Promise.all([checkHealth(), loadWorkspaceSummary()]);
    toast("Workspace refreshed.");
  } else if (action === "logout") {
    if (!confirm("Sign out of this ShortsFlow workspace?")) return;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Sign out failed. Please try again.");
      showAuth("You have signed out.");
    } catch (error) {
      toast(error.message || "Could not sign out.");
    }
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".workspace-menu-wrap")) closeWorkspaceMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeWorkspaceMenu();
});


$("#mobile-menu")?.addEventListener("click", () => $("#sidebar")?.classList.toggle("open"));
$("#add-source-btn")?.addEventListener("click", () => {
  navigate("sources");
  $("#source-file")?.click();
});
$("#start-workflow")?.addEventListener("click", () => {
  navigate("sources");
  $("#source-file")?.click();
});
$("#view-activity")?.addEventListener("click", async () => { await loadWorkspaceSummary(); toast("Recent activity refreshed."); });

let authMode = "login";
function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const registering = authMode === "register";
  $("#auth-login-tab").classList.toggle("selected", !registering);
  $("#auth-register-tab").classList.toggle("selected", registering);
  $("#auth-name-field").classList.toggle("hidden", !registering);
  $("#auth-title").textContent = registering ? "Create your workspace." : "Welcome back.";
  $("#auth-description").textContent = registering ? "Set up your private ShortsFlow workspace." : "Sign in to continue to your production workspace.";
  $("#auth-submit").innerHTML = registering ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  $("#auth-password").autocomplete = registering ? "new-password" : "current-password";
  $("#auth-message").textContent = "";
  $("#auth-message").className = "auth-message";
}
function showAuth(message = "") {
  $("#auth-overlay").classList.remove("hidden");
  $("#auth-message").textContent = message;
  $("#auth-message").className = "auth-message";
}
$("#auth-login-tab")?.addEventListener("click", () => setAuthMode("login"));
$("#auth-register-tab")?.addEventListener("click", () => setAuthMode("register"));
$("#auth-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#auth-submit");
  const message = $("#auth-message");
  const payload = {
    email: $("#auth-email").value.trim(),
    password: $("#auth-password").value
  };
  if (authMode === "register") payload.displayName = $("#auth-name").value.trim();
  button.disabled = true;
  button.textContent = authMode === "register" ? "Creating workspace…" : "Signing in…";
  message.textContent = "";
  try {
    const response = await fetch(authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not authenticate. Please try again.");
    $("#auth-overlay").classList.add("hidden");
    $("#auth-password").value = "";
    toast(authMode === "register" ? "Your workspace is ready." : "Welcome back.");
    await loadWorkspaceSummary();
  } catch (error) {
    message.textContent = error.message || "Something went wrong. Please try again.";
    message.className = "auth-message";
  } finally {
    button.disabled = false;
    button.innerHTML = authMode === "register" ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  }
});

async function checkSession() {
  try {
    const healthResponse = await fetch("/api/health", { headers: { accept: "application/json" } });
    if (!healthResponse.ok) return;
    const health = await healthResponse.json();
    if (!health.databaseConfigured || !health.database) return;
    const response = await fetch("/api/auth/me", { headers: { accept: "application/json" } });
    if (!response.ok) {
      showAuth("Account setup is not complete yet. Please check the D1 migrations.");
      return;
    }
    const data = await response.json();
    if (data.authenticated) {
      $("#auth-overlay").classList.add("hidden");
      await loadWorkspaceSummary();
    } else {
      showAuth();
    }
  } catch {
    // Keep the dashboard preview available if the API is temporarily unreachable.
  }
}
function renderActivity(events) {
  const panel = $(".empty-activity");
  if (!panel) return;
  panel.classList.toggle("has-activity", events.length > 0);
  if (!events.length) {
    panel.innerHTML = "<div class='empty-icon'>◷</div><b>No activity yet</b><p>Your production events will appear here when you add your first source video.</p>";
    return;
  }
  panel.innerHTML = `<div class="activity-feed-head"><b>Latest workspace activity</b><span>${events.length} recent events</span></div>
    <div class="activity-feed-list">${events.map((item) => {
      const label = activityLabels[item.event] || String(item.event || "Workspace update").replace(/[._-]+/g, " ").split(" ").map((word) => word ? word[0].toUpperCase() + word.slice(1) : "").join(" ");
      const date = new Date(item.created_at);
      const timestamp = Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `<article class="activity-feed-item"><span class="activity-feed-dot"></span><div><b>${escapeHTML(label)}</b><small>${escapeHTML(timestamp)}</small></div></article>`;
    }).join("")}</div>`;
}
async function loadWorkspaceSummary() {
  try {
    const response = await fetch("/api/workspace/summary", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.ok || !data.stats) return;
    $("#stat-sources").textContent = data.stats.sources;
    $("#stat-clips").textContent = data.stats.clips;
    $("#stat-review").textContent = data.stats.awaitingReview;
    $("#stat-published").textContent = data.stats.published;
    $("#review-count").textContent = data.stats.awaitingReview;
    renderActivity(Array.isArray(data.activity) ? data.activity : []);
  } catch {
    // Keep the empty state when the account or API is not ready.
  }
}
async function checkHealth() {
  const dot = $("#system-dot");
  const label = $("#system-label");
  const detail = $("#system-detail");
  const version = $("#api-version");
  try {
    const response = await fetch("/api/health", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("API returned " + response.status);
    const data = await response.json();
    dot.className = "system-dot ok";
    label.textContent = "API operational";
    detail.textContent = data.database ? "API and database connected" : "API online · database not connected";
    version.textContent = "API v" + (data.version || "—") + " · " + (data.database ? "Database connected" : "Database pending");
  } catch {
    dot.className = "system-dot bad";
    label.textContent = "API unavailable";
    detail.textContent = "Could not reach health endpoint";
    version.textContent = "API status: unavailable";
  }
}
$("#refresh-btn")?.addEventListener("click", async () => {
  await Promise.all([checkHealth(), loadWorkspaceSummary()]);
  toast("System status refreshed.");
});

navigate("overview");
checkHealth();
checkSession();
