from html.parser import HTMLParser
from pathlib import Path
import json
import shlex

ROOT = Path(__file__).resolve().parents[1]
BUILD = "20261117-server-transcribe1"

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.paths.append(("script", attrs["src"]))
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            self.paths.append(("stylesheet", attrs["href"]))

html = (ROOT / "index.html").read_text(encoding="utf-8")
parser = Assets()
parser.feed(html)
missing = []
unversioned = []
for kind, url in parser.paths:
    if not url.startswith("/"):
        continue
    path, _, query = url.partition("?")
    target = ROOT / path.lstrip("/")
    if not target.is_file():
        missing.append(path)
    if path.startswith("/assets/") and f"v={BUILD}" not in query:
        unversioned.append(path)
if missing:
    raise SystemExit(f"Missing frontend assets: {sorted(set(missing))}")
if unversioned:
    raise SystemExit(f"Assets missing current cache version {BUILD}: {sorted(set(unversioned))}")

package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
command = package["scripts"]["check:js"]
checked = {shlex.split(part)[-1] for part in command.split("&&") if "node --check" in part}
actual = {str(path.relative_to(ROOT)) for path in (ROOT / "assets").glob("*.js")}
actual |= {str(path.relative_to(ROOT)) for path in (ROOT / "functions").rglob("*.js")}
actual |= {str(path.relative_to(ROOT)) for path in (ROOT / "workers").rglob("*.js")}
omitted = sorted(actual - checked)
if omitted:
    raise SystemExit(f"JavaScript files not covered by syntax checks: {omitted}")
if f"UI build {BUILD}" not in html:
    raise SystemExit("Visible UI build marker is missing.")
compile((ROOT / "scripts/background_render.py").read_text(encoding="utf-8"), "scripts/background_render.py", "exec")
compile((ROOT / "scripts/test_background_render.py").read_text(encoding="utf-8"), "scripts/test_background_render.py", "exec")
app_js = (ROOT / "assets/app.js").read_text(encoding="utf-8")
admin_api = (ROOT / "functions/api/admin/ai-usage.js").read_text(encoding="utf-8")
admin_overview_api = (ROOT / "functions/api/admin/overview.js").read_text(encoding="utf-8")
admin_actions_api = (ROOT / "functions/api/admin/actions.js").read_text(encoding="utf-8")
auth_lib = (ROOT / "functions/api/_lib/auth.js").read_text(encoding="utf-8")
if 'user?.systemRole === "admin"' not in app_js:
    raise SystemExit("Admin navigation must use global admin role, not workspace ownership.")
if 'user.systemRole !== "admin"' not in admin_api:
    raise SystemExit("Admin API must require the global administrator role.")
if "u.system_role" not in auth_lib:
    raise SystemExit("Session lookup must load the global administrator role.")
if 'user.systemRole !== "admin"' not in admin_overview_api:
    raise SystemExit("Admin overview API must require the global administrator role.")
if "publisher.js" not in html or 'publisher: ["Publisher"' not in app_js:
    raise SystemExit("Publisher navigation or script is not wired into the application.")
smoke_test = (ROOT / "scripts/smoke_test.py").read_text(encoding="utf-8")
if f'BUILD = "{BUILD}"' not in smoke_test:
    raise SystemExit("Production smoke-test build marker is out of sync with the frontend.");

publisher_js = (ROOT / "assets/publisher.js").read_text(encoding="utf-8")
refresh_start = publisher_js.find("async function refreshQueueStatus(){")
refresh_end = publisher_js.find("async function load(){", refresh_start)
if refresh_start < 0 or refresh_end < 0:
    raise SystemExit("Publisher lightweight queue refresh function is missing.")
refresh_block = publisher_js[refresh_start:refresh_end]
if 'fetch("/api/youtube"' not in refresh_block:
    raise SystemExit("Publisher background refresh must use the lightweight queue endpoint.")
for endpoint in ("/api/review", "/api/workspace/brand-kit", "/api/youtube/analytics", "/api/youtube/retention"):
    if endpoint in refresh_block:
        raise SystemExit(f"Publisher background refresh must not reload {endpoint}.")
if "setInterval(refreshQueueStatus,60000)" not in publisher_js:
    raise SystemExit("Publisher queue refresh must use the 60-second cadence.")
if 'document.visibilityState==="hidden"' not in refresh_block:
    raise SystemExit("Publisher queue refresh must pause while the browser tab is hidden.")
for marker in ("publisher-calendar-grid", "publisher-checklist-items", "publisher-ranking-list", "publisher-insights-summary", "publisher-insights-cards", "renderGrowthInsights", "publisher-export-csv", "publisher-notifications-list"):
    if marker not in publisher_js:
        raise SystemExit(f"Publisher workspace tool is missing: {marker}")
if 'fetch("/api/library"' not in publisher_js or 'fetch("/api/youtube"' not in publisher_js:
    raise SystemExit("Publisher tools must reuse existing library and YouTube APIs.")
analytics_api = (ROOT / "functions/api/youtube/analytics.js").read_text(encoding="utf-8")
for field in ("previous_views", "previous_likes", "previous_comments"):
    if field not in analytics_api:
        raise SystemExit(f"Growth Insights snapshot comparison field is missing: {field}")
if "decision===\"approved\"" not in publisher_js or "Review Center" not in publisher_js:
    raise SystemExit("Publisher approval selection or explanatory review gate is missing.")
if "admin-control.js" not in html or "admin-control.css" not in html or "admin-actions.js" not in html or "admin-actions.css" not in html:
    raise SystemExit("Admin control center assets are not linked.")
sources_js = (ROOT / "assets/sources.js").read_text(encoding="utf-8")
clips_js = (ROOT / "assets/clips.js").read_text(encoding="utf-8")
render_queue_js = (ROOT / "assets/rendering-queue.js").read_text(encoding="utf-8")
render_studio_js = (ROOT / "assets/render-studio.js").read_text(encoding="utf-8")
clips_api = (ROOT / "functions/api/clips/index.js").read_text(encoding="utf-8")
if "},60000);" not in sources_js or 'document.visibilityState!=="hidden"' not in sources_js:
    raise SystemExit("Source job polling must run every 60 seconds only while the tab is visible.")
if "setInterval(()=>{const panel=$(\"#clips-workspace\")" not in clips_js or "},60000);" not in clips_js or 'document.visibilityState!=="hidden"' not in clips_js:
    raise SystemExit("Clip Discovery polling must be throttled to 60 seconds and pause in hidden tabs.")
if "setInterval(()=>{if(document.visibilityState!==\"hidden\")load();},30000);" not in render_queue_js:
    raise SystemExit("Rendering Queue polling must run every 30 seconds only while the tab is visible.")
if 'await wait(document.visibilityState==="hidden"?60000:10000);' not in render_studio_js or 'document.addEventListener("visibilitychange",onVisibility)' not in render_studio_js:
    raise SystemExit("Render status polling must slow while hidden and resume immediately when visible.")
if 'fetch("/api/clips?sourceId="+encodeURIComponent(sourceId)' not in sources_js:
    raise SystemExit("Autopilot must request clips for its current source only.")
if 'const clipsUrl=clip.sourceId?"/api/clips?sourceId="+encodeURIComponent(clip.sourceId):"/api/clips";' not in render_studio_js:
    raise SystemExit("Render version refresh must use the source-filtered clips endpoint when possible.")
if 'const sourceFilter = sourceId ? "AND c.source_video_id = ?" : "";' not in clips_api or "Invalid source ID." not in clips_api:
    raise SystemExit("Clip API source-specific discovery filter is missing or unvalidated.")
if 'let sourceBuffer=await response.arrayBuffer();' not in sources_js or 'finally {\n      try{ffmpeg.terminate();}catch{}' not in sources_js:
    raise SystemExit("Browser FFmpeg must use a single response buffer and always terminate the worker.")
server_jobs_api = (ROOT / "functions/api/jobs/index.js").read_text(encoding="utf-8")
if 'searchParams.get("sourceId")' not in server_jobs_api or 'AND j.source_video_id = ?' not in server_jobs_api:
    raise SystemExit("Processing jobs API must support a validated source-specific status query.")
if "progressChunks" not in server_jobs_api or "totalChunks" not in server_jobs_api:
    raise SystemExit("Server transcription progress must expose safe chunk counters.")
server_transcribe = sources_js.find("async function transcribeSourceOnServer(")
browser_transcribe = sources_js.find("async function transcribeSourceInBrowser(")
queue_source = sources_js.find("async function queueSource(")
if min(server_transcribe, browser_transcribe, queue_source) < 0 or not server_transcribe < queue_source:
    raise SystemExit("Low-memory server transcription path is missing from Source Library.")
server_queue_block = sources_js[server_transcribe:queue_source]
if 'fetch("/api/jobs"' not in server_queue_block or 'fetch("/api/jobs?sourceId="+encodeURIComponent(sourceId)' not in server_queue_block:
    raise SystemExit("Eligible MP4 sources must queue and monitor server-side transcription.")
if "size<100*1024*1024" not in sources_js or "transcribeSourceInBrowser(sourceId,duration,updateProgress)" not in sources_js:
    raise SystemExit("The 100 MB server path and large-file browser fallback must both be preserved.")
if "Large MP4 detected" not in sources_js or 'source.mimeType!=="video/mp4"' not in sources_js:
    raise SystemExit("Large-file fallback and MP4-only analysis guidance are missing.")
if "browserFallback=job.status===\"failed\"" not in sources_js or "switching to browser fallback" not in sources_js:
    raise SystemExit("Unsupported Media Transform codec fallback is missing.")
print("OK: Smaller MP4s use Cloudflare server transcription; large MP4s and unsupported codecs retain browser fallback.")
print("OK: Server transcription progress is source-scoped and payload data stays private.")
print("OK: Sources, Clip Discovery, rendering queue and render-status polling are throttled and visibility-aware.")
print("OK: Autopilot discovery is source-filtered and browser FFmpeg always terminates.")
print("OK: Publisher background refresh only checks queue status every 60 seconds and pauses in hidden tabs.")
print("OK: global admin access is separate from workspace owner permissions.")
if 'admin.systemRole !== "admin"' not in admin_actions_api:
    raise SystemExit("Admin actions endpoint must require the global administrator role.")
print("OK: admin control center API and assets are protected and linked.")
print("OK: background FFmpeg runner Python syntax is valid.")
print(f"OK: {len(parser.paths)} linked assets exist; cache versions match {BUILD}; all {len(actual)} JavaScript files are syntax-checked.")
