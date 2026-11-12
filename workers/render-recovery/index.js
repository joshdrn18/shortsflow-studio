/**
 * ShortsFlow render queue recovery.
 * Runs independently from the analysis Worker so queue recovery can ship
 * without replacing that Worker or touching its existing secrets.
 */
const ACCOUNT = "shortsflow-render-recovery";

async function recover(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing.");
  const now = new Date().toISOString();
  const retryBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const results = await env.DB.batch([
    // Old clip versions can never produce the current render. Cancel them,
    // but do not interrupt a runner until its lease expires.
    env.DB.prepare(`
      UPDATE clip_render_jobs
      SET status='cancelled', runner_id=NULL, locked_until=NULL,
          last_error='Clip settings changed; this render is obsolete.', updated_at=?
      WHERE status IN ('queued','failed')
         OR (status='running' AND (locked_until IS NULL OR locked_until<=?))
      AND EXISTS (
        SELECT 1 FROM clip_metadata m
        WHERE m.clip_id=clip_render_jobs.clip_id
          AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clip_render_jobs.clip_id)
          AND m.version<>clip_render_jobs.metadata_version
      )
    `).bind(now, now),

    // A worker-reported failure is retried after a short cooling-off period.
    // Attempts are incremented by the existing atomic claim endpoint.
    env.DB.prepare(`
      UPDATE clip_render_jobs
      SET status='queued', runner_id=NULL, locked_until=NULL, updated_at=?
      WHERE status='failed' AND attempts<3 AND updated_at<=?
        AND (last_error IS NULL OR lower(last_error) NOT LIKE '%source video is missing%')
        AND EXISTS (
          SELECT 1 FROM clip_metadata m
          WHERE m.clip_id=clip_render_jobs.clip_id
            AND m.version=clip_render_jobs.metadata_version
            AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clip_render_jobs.clip_id)
        )
    `).bind(now, retryBefore),

    // Do not leave an exhausted or unrecoverable job appearing active forever.
    env.DB.prepare(`
      UPDATE clip_render_jobs
      SET status='failed', runner_id=NULL, locked_until=NULL,
          last_error=CASE
            WHEN last_error IS NULL OR last_error=''
              THEN 'Background render exhausted its retry attempts or lost its runner lease.'
            ELSE last_error
          END,
          updated_at=?
      WHERE (status='running' AND attempts>=3 AND (locked_until IS NULL OR locked_until<=?))
         OR (status='queued' AND attempts>=3)
         OR (status='failed' AND (attempts>=3 OR lower(COALESCE(last_error,'')) LIKE '%source video is missing%'))
    `).bind(now, now),

    // Keep the clip-level status aligned with its latest-version queue state.
    env.DB.prepare(`
      UPDATE clips SET status='rendering', updated_at=?
      WHERE EXISTS (
        SELECT 1 FROM clip_render_jobs j
        WHERE j.clip_id=clips.id AND j.status IN ('queued','running')
          AND j.metadata_version=(SELECT MAX(m.version) FROM clip_metadata m WHERE m.clip_id=clips.id)
      )
    `).bind(now),

    env.DB.prepare(`
      UPDATE clips SET status='editing', updated_at=?
      WHERE status='rendering'
        AND NOT EXISTS (
          SELECT 1 FROM clip_render_jobs j
          WHERE j.clip_id=clips.id AND j.status IN ('queued','running')
            AND j.metadata_version=(SELECT MAX(m.version) FROM clip_metadata m WHERE m.clip_id=clips.id)
        )
    `).bind(now)
  ]);

  return results.reduce((sum, item) => sum + Number(item.meta?.changes || 0), 0);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(recover(env).then(
      changed => console.log("render_queue_recovery_complete", { changed }),
      error => console.error("render_queue_recovery_failed", String(error?.message || error))
    ));
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json({
      ok: Boolean(env.DB),
      service: ACCOUNT,
      database: Boolean(env.DB),
      mode: "scheduled-recovery"
    }, { headers: { "Cache-Control": "no-store" } });
  }
};
