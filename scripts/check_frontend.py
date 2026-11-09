from html.parser import HTMLParser
from pathlib import Path
import json
import shlex

ROOT = Path(__file__).resolve().parents[1]
BUILD = "20261109-audit-1"

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
print(f"OK: {len(parser.paths)} linked assets exist; cache versions match {BUILD}; all {len(actual)} JavaScript files are syntax-checked.")
