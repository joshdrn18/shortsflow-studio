import { json, getSessionUser, readJson } from "../_lib/auth.js";

const JOB_TYPES = new Set(["analyze_source"]);

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);
  const sourceId = new URL(request.url).searchParams.get("sourceId");
  if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) {
    return json({ ok: false, error: "Invalid source video ID." }, 400);
  }
  try {
    const query = `SELECT j.id, j.source_video_id, s.title AS source_title, j.job_type, j.status,
              j.attempts, j.max_attempts, j.last_error, j.created_at, j.updated_at, j.payload_json
       FROM processing_jobs j JOIN source_videos s ON s.id = j.source_video_id
       WHERE j.workspace_id = ? ${sourceId ? "AND j.source_video_id = ?" : ""}
       ORDER BY j.created_at DESC LIMIT ${sourceId ? 20 : 50}`;
    const result = sourceId
      ? await env.DB.prepare(query).bind(user.workspace.id, sourceId).all()
      : await env.DB.prepare(query).bind(user.workspace.id).all();
    const jobs = (result.results || []).map(row => {
      let payload = {};
      try { payload = JSON.parse(row.payload_json || "{}"); } catch {}
      const { payload_json, ...safe } = row;
      return {
        ...safe,
        progressChunks: Math.max(0, Number(payload.chunkIndex || 0)),
        totalChunks: Math.max(0, Number(payload.totalChunks || 0))
      };
    });
    return json({ ok: true, jobs });
  } catch {
    return json({ ok: false, error: "Could not load processing jobs. Apply migration 0004." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);
  const body = await readJson(request);
  if (!body || !JOB_TYPES.has(body.jobType)) return json({ ok: false, error: "Unsupported job type." }, 400);
  if (typeof body.sourceId !== "string" || body.sourceId.length > 80) return json({ ok: false, error: "A valid source video is required." }, 400);
  try {
    const source = await env.DB.prepare(
      "SELECT id, title, status FROM source_videos WHERE id = ? AND workspace_id = ?"
    ).bind(body.sourceId, user.workspace.id).first();
    if (!source) return json({ ok: false, error: "Source video was not found in this workspace." }, 404);
    if (!["uploaded", "analyzing", "ready", "failed"].includes(source.status)) return json({ ok: false, error: "This source is not ready for analysis." }, 409);
    const active = await env.DB.prepare(
      `SELECT id, status FROM processing_jobs WHERE workspace_id = ? AND source_video_id = ? AND job_type = ?
       AND status IN ('queued','claimed','running') ORDER BY created_at DESC LIMIT 1`
    ).bind(user.workspace.id, source.id, body.jobType).first();
    if (active) return json({ ok: true, job: { id: active.id, status: active.status }, reused: true });
    const id = crypto.randomUUID();
    const key = "analyze_source:" + user.workspace.id + ":" + source.id + ":v1:" + id;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO processing_jobs
       (id, workspace_id, source_video_id, job_type, status, idempotency_key, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
    ).bind(id, user.workspace.id, source.id, body.jobType, key,
      JSON.stringify({ sourceId: source.id, requestedBy: user.id, pipelineVersion: 1 }), now, now).run();
    await env.DB.prepare(
      "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'processing_job', ?, 'job.queued', ?, ?)"
    ).bind(crypto.randomUUID(), user.workspace.id, id, JSON.stringify({ sourceId: source.id, jobType: body.jobType }), now).run();
    return json({ ok: true, job: { id, sourceId: source.id, sourceTitle: source.title, jobType: body.jobType, status: "queued", attempts: 0, maxAttempts: 3, createdAt: now }, reused: false }, 201);
  } catch {
    return json({ ok: false, error: "Could not queue this job. Check that migration 0004 has been applied." }, 503);
  }
}
