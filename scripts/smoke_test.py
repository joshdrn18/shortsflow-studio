from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import json
import os
import time

BASE_URL = os.environ.get("SHORTSFLOW_BASE_URL", "https://shortsflow-studio.pages.dev").rstrip("/")
BUILD = "20261115-publisher-suite3"
TIMEOUT_SECONDS = 240
RETRY_SECONDS = 5

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.urls.append(attrs["src"])
        elif tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            self.urls.append(attrs["href"])

def get(path):
    target = path if urlsplit(path).scheme else BASE_URL + path
    request = Request(target, headers={
        "User-Agent": "ShortsFlow-production-smoke-test",
        "Cache-Control": "no-cache",
        "Accept": "application/json,text/html,*/*",
    })
    with urlopen(request, timeout=20) as response:
        return response.status, response.headers, response.read()

def post(path, payload):
    target = path if urlsplit(path).scheme else BASE_URL + path
    request = Request(target, data=json.dumps(payload).encode("utf-8"), method="POST", headers={
        "User-Agent": "ShortsFlow-production-smoke-test",
        "Cache-Control": "no-cache",
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    with urlopen(request, timeout=20) as response:
        return response.status, response.headers, response.read()

deadline = time.monotonic() + TIMEOUT_SECONDS
last_error = None
while time.monotonic() < deadline:
    try:
        status, headers, body = get("/")
        html = body.decode("utf-8")
        if status != 200:
            raise RuntimeError(f"Homepage returned HTTP {status}")
        if f"UI build {BUILD}" not in html:
            raise RuntimeError(f"Production homepage has not deployed build {BUILD} yet")
        break
    except (HTTPError, URLError, TimeoutError, RuntimeError, UnicodeDecodeError) as error:
        last_error = error
        time.sleep(RETRY_SECONDS)
else:
    raise SystemExit(f"Production homepage did not become ready: {last_error}")

cache = headers.get("Cache-Control", "").lower()
if "no-cache" not in cache or "no-store" not in cache:
    raise SystemExit(f"Homepage cache policy is unsafe for HTML: {cache!r}")

parser = Assets()
parser.feed(html)
asset_paths = []
for value in parser.urls:
    parsed = urlsplit(value)
    if parsed.path.startswith("/assets/"):
        if f"v={BUILD}" not in parsed.query:
            raise SystemExit(f"Stale or unversioned asset URL: {value}")
        asset_paths.append(parsed.path + "?" + parsed.query)

if not asset_paths:
    raise SystemExit("No versioned frontend assets were found in the production HTML.")
if "/assets/publisher.js" not in [urlsplit(value).path for value in parser.urls]:
    raise SystemExit("Publisher workspace script is missing from production HTML.")

if "/assets/publisher-addons.js" not in [urlsplit(value).path for value in parser.urls]:
    raise SystemExit("Publisher add-on script is missing from production HTML.")

for path in asset_paths:
    status, asset_headers, _ = get(path)
    if status != 200:
        raise SystemExit(f"Frontend asset failed: {path} (HTTP {status})")
    policy = asset_headers.get("Cache-Control", "").lower()
    if "immutable" not in policy or "max-age=31536000" not in policy:
        raise SystemExit(f"Versioned asset cache policy is missing: {path} ({policy!r})")

status, health_headers, health_body = get("/api/health")
if status != 200:
    raise SystemExit(f"Health endpoint returned HTTP {status}")
health = json.loads(health_body)
if not health.get("ok") or not health.get("databaseConfigured") or not health.get("database") or not health.get("mediaConfigured"):
    raise SystemExit("Production API health check failed: database or media binding is unavailable.")
if "no-store" not in health_headers.get("Cache-Control", "").lower():
    raise SystemExit("API health response is missing no-store cache policy.")

try:
    publisher_health_status, _, _ = get("/api/system/health")
except HTTPError as error:
    publisher_health_status = error.code
if publisher_health_status not in (401, 403):
    raise SystemExit(f"Publisher system health endpoint must reject unauthenticated requests (HTTP {publisher_health_status}).")

try:
    admin_status, _, _ = get("/api/admin/ai-usage")
except HTTPError as error:
    admin_status = error.code
if admin_status not in (401, 403):
    raise SystemExit(f"Admin AI usage endpoint must reject unauthenticated requests (HTTP {admin_status}).")
try:
    overview_status, _, _ = get("/api/admin/overview")
except HTTPError as error:
    overview_status = error.code
if overview_status not in (401, 403):
    raise SystemExit(f"Admin overview endpoint must reject unauthenticated requests (HTTP {overview_status}).")
try:
    actions_status, _, _ = post("/api/admin/actions", {})
except HTTPError as error:
    actions_status = error.code
if actions_status not in (400, 401, 403):
    raise SystemExit(f"Admin actions endpoint must reject unauthenticated requests (HTTP {actions_status}).")

worker_url = "https://shortsflow-analysis-engine.inipastiuy-41f.workers.dev/health"
worker_status, _, worker_body = get(worker_url)
worker = json.loads(worker_body)
if worker_status != 200 or not worker.get("ok") or not worker.get("bindings", {}).get("backgroundRenderRunner"):
    raise SystemExit("Analysis Worker or background render runner health check failed.")

print("OK: analysis Worker and background render runner are healthy.")
print(f"OK: production homepage serves build {BUILD}; {len(asset_paths)} frontend assets return HTTP 200 with immutable cache; API, D1 and R2 bindings are healthy.")
