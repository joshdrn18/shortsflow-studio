from html.parser import HTMLParser
from pathlib import Path
import json
import shlex

ROOT = Path(__file__).resolve().parents[1]
BUILD = "20261115-publisher-suite3"

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
addon_js = (ROOT / "assets/publisher-addons.js").read_text(encoding="utf-8")
for marker in ("publisher-draft-bar", "publisher-queue-controls", "publisher-failure-diagnosis", "publisher-history-export", "publisher-system-health"):
    if marker not in addon_js:
        raise SystemExit(f"Publisher add-on feature missing: {marker}")
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
if "publisher.js" not in html or "publisher-addons.js" not in html or 'publisher: ["Publisher"' not in app_js:
    raise SystemExit("Publisher navigation or script is not wired into the application.")
smoke_test = (ROOT / "scripts/smoke_test.py").read_text(encoding="utf-8")
if f'BUILD = "{BUILD}"' not in smoke_test:
    raise SystemExit("Production smoke-test build marker is out of sync with the frontend.");

publisher_js = (ROOT / "assets/publisher.js").read_text(encoding="utf-8")
for marker in ("publisher-calendar-grid", "publisher-checklist-items", "publisher-ranking-list", "publisher-export-csv", "publisher-notifications-list"):
    if marker not in publisher_js:
        raise SystemExit(f"Publisher workspace tool is missing: {marker}")
if 'fetch("/api/library"' not in publisher_js or 'fetch("/api/youtube"' not in publisher_js:
    raise SystemExit("Publisher tools must reuse existing library and YouTube APIs.")
if "decision===\"approved\"" not in publisher_js or "Review Center" not in publisher_js:
    raise SystemExit("Publisher approval selection or explanatory review gate is missing.")
if "admin-control.js" not in html or "admin-control.css" not in html or "admin-actions.js" not in html or "admin-actions.css" not in html:
    raise SystemExit("Admin control center assets are not linked.")
print("OK: global admin access is separate from workspace owner permissions.")
if 'admin.systemRole !== "admin"' not in admin_actions_api:
    raise SystemExit("Admin actions endpoint must require the global administrator role.")
print("OK: admin control center API and assets are protected and linked.")
print("OK: background FFmpeg runner Python syntax is valid.")
print(f"OK: {len(parser.paths)} linked assets exist; cache versions match {BUILD}; all {len(actual)} JavaScript files are syntax-checked.")
