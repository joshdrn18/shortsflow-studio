const $ = (selector) => document.querySelector(selector);
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
function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 3400);
}
function navigate(view) {
  const item = views[view] ? view : "overview";
  navItems.forEach((button) => button.classList.toggle("active", button.dataset.view === item));
  $("#crumb").textContent = views[item][0];
  $("#page-title").textContent = views[item][0];
  $("#page-subtitle").textContent = views[item][1];
  if (item !== "overview") toast(views[item][0] + " workspace is being prepared.");
  if (window.innerWidth <= 720) $("#sidebar").classList.remove("open");
}
navItems.forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#add-source-btn").addEventListener("click", () => $("#source-file").click());
$("#start-workflow").addEventListener("click", () => $("#source-file").click());
$("#source-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) toast("Source selected: " + file.name + ". Upload processing will be enabled when storage is configured.");
  event.target.value = "";
});
$("#view-activity").addEventListener("click", () => toast("No activity has been recorded yet."));
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
    const activity = $(".empty-activity");
    if (Array.isArray(data.activity) && data.activity.length) {
      activity.innerHTML = "<div class='empty-icon'>◷</div><b>" + data.activity.length + " recent events</b><p>Activity history is available in your workspace.</p>";
    }
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
  } catch (error) {
    dot.className = "system-dot bad";
    label.textContent = "API unavailable";
    detail.textContent = "Could not reach health endpoint";
    version.textContent = "API status: unavailable";
  }
}
$("#refresh-btn").addEventListener("click", () => { checkHealth();
loadWorkspaceSummary(); loadWorkspaceSummary(); toast("System status refreshed."); });
checkHealth();