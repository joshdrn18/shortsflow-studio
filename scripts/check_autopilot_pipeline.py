from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "workers/analysis-engine/index.js").read_text(encoding="utf-8")
RENDER_WORKFLOW = (ROOT / ".github/workflows/background-render.yml").read_text(encoding="utf-8")


def require(condition, message):
    if not condition:
        raise SystemExit(message)


# The model receives exactly three numbered articles. IDs outside this
# submitted set must never be accepted as factual evidence.
require(
    "const allowedIds=new Set(selectedResearch.map((source,index)=>index+1));" in WORKER,
    "Autopilot source IDs are not restricted to the three articles sent to the model.",
)
require(
    "const selectedSources=selectedResearch.filter((source,index)=>selectedIds.has(index+1));" in WORKER,
    "Autopilot must persist only the actual cited article(s), not the whole discovery pool.",
)
require(
    "if(!sourceNotes.length)throw new Error(" in WORKER
    and "sourceForNarration=sources[sourceNotes[0].source_id-1]" in WORKER,
    "Autopilot must reject scripts that do not cite a supplied, valid source.",
)

# Autopilot only creates a content package. It must never enqueue a YouTube
# publishing job by itself. The separate Publisher processor may handle only
# jobs that a user explicitly queued through the approval-protected Publisher.
require(
    "status='ready_to_publish'" in WORKER and "publishing_job_id=NULL" in WORKER,
    "Autopilot render completion must create a ready-to-publish content package.",
)
require(
    "ctx.waitUntil(Promise.all([processNextJob(env), processAutopilot(env), processYoutubeJob(env)]));" in WORKER,
    "Worker scheduled handler must retain content processing and the manual Publisher queue processor.",
)
require(
    WORKER.count("processYoutubeJob(env)") == 2
    and "p.platform='youtube' AND p.status='queued'" in WORKER
    and "AND r.id=?" in WORKER,
    "Publisher processor must handle only explicitly queued uploads and recheck the exact approval.",
)
require(
    "status='ready_to_publish'" in WORKER and "publishing_job_id=NULL" in WORKER,
    "Autopilot render completion must create a ready-to-publish content package.",
)

# AI quota cooldown and independent render runner safety net.
require(
    "Date.now()-lastQuotaFailure<24*60*60*1000" in WORKER,
    "Workers AI quota cooldown is missing or shortened.",
)
require(
    'cron: "*/5 * * * *"' in RENDER_WORKFLOW
    and "python3 scripts/background_render.py" in RENDER_WORKFLOW,
    "Five-minute background render safety net is missing.",
)

print("OK: Autopilot research citations, content-only output, quota cooldown, and render schedule verified.")
