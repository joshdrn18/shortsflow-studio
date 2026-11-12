import { json, getSessionUser } from "./_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user?.workspace?.id) return json({ ok: false, error: "Authentication required." }, 401);

  try {
    const [active, recent] = await Promise.all([
      env.DB.prepare(`SELECT j.id,j.clip_id,j.status,j.attempts,j.created_at,j.updated_at,j.last_error,
        c.start_seconds,c.end_seconds,m.title AS clip_title,s.title AS source_title
        FROM clip_render_jobs j
        JOIN clips c ON c.id=j.clip_id
        JOIN source_videos s ON s.id=j.source_video_id
        LEFT JOIN clip_metadata m ON m.clip_id=j.clip_id AND m.version=j.metadata_version
        WHERE j.workspace_id=? AND j.status IN ('queued','running')
        ORDER BY CASE j.status WHEN 'running' THEN 0 ELSE 1 END, j.created_at ASC
        LIMIT 50`).bind(user.workspace.id).all(),
      env.DB.prepare(`SELECT created_at,completed_at,updated_at FROM clip_render_jobs
        WHERE workspace_id=? AND status='completed'
        ORDER BY completed_at DESC LIMIT 12`).bind(user.workspace.id).all()
    ]);

    const durations = (recent.results || []).map(row => {
      const start = Date.parse(row.created_at);
      const end = Date.parse(row.completed_at || row.updated_at);
      return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
    }).filter(ms => ms > 0 && ms < 2 * 60 * 60 * 1000).sort((a,b)=>a-b);
    const avgMs = durations.length
      ? durations.slice(Math.floor(durations.length * 0.15), Math.max(1, Math.ceil(durations.length * 0.85))).reduce((a,b)=>a+b,0) / durations.slice(Math.floor(durations.length * 0.15), Math.max(1, Math.ceil(durations.length * 0.85))).length
      : 2 * 60 * 1000;

    let queuedAhead = 0;
    let runningRemainingMs = 0;
    const now = Date.now();
    const items = (active.results || []).map(row => {
      const created = Date.parse(row.created_at);
      const elapsed = Number.isFinite(created) ? Math.max(0, now - created) : 0;
      let remainingMs;
      if (row.status === "running") {
        remainingMs = Math.max(0, avgMs - elapsed);
        runningRemainingMs = Math.max(runningRemainingMs, remainingMs);
      } else {
        queuedAhead += 1;
        remainingMs = runningRemainingMs + avgMs * queuedAhead;
      }
      return {
        id: row.id,
        clipId: row.clip_id,
        status: row.status,
        attempts: Number(row.attempts || 0),
        title: row.clip_title || "Untitled clip",
        sourceTitle: row.source_title || "Source video",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        elapsedMs: elapsed,
        estimatedRemainingMs: Math.round(remainingMs),
        startSeconds: Number(row.start_seconds || 0),
        endSeconds: Number(row.end_seconds || 0)
      };
    });
    const running = items.filter(item => item.status === "running").length;
    const queued = items.filter(item => item.status === "queued").length;
    const queueAheadMs = runningRemainingMs + avgMs * queued;
    return json({
      ok: true,
      items,
      summary: { running, queued, total: items.length, averageRenderMs: Math.round(avgMs), estimatedDrainMs: Math.round(queueAheadMs), sampledCompleted: durations.length },
      generatedAt: new Date(now).toISOString()
    });
  } catch (error) {
    console.error("render_queue_load_failed", error);
    return json({ ok: false, error: "Could not load the rendering queue." }, 503);
  }
}
