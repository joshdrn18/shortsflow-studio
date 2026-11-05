import { json, getSessionUser, readJson } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  try {
    const result = await env.DB.prepare(
      `SELECT c.id, c.source_video_id, s.title AS source_title, COALESCE(m.title, c.title) AS title,
              c.start_seconds, c.end_seconds, s.duration_seconds AS source_duration,
              c.hook, c.ai_score, c.transcript, c.status, c.created_at,
              m.caption, m.hashtags, m.language, m.version AS metadata_version
       FROM clips c
       JOIN source_videos s ON s.id = c.source_video_id AND s.workspace_id = c.workspace_id
       LEFT JOIN clip_metadata m ON m.clip_id = c.id
         AND m.version = (SELECT MAX(m2.version) FROM clip_metadata m2 WHERE m2.clip_id = c.id)
       WHERE c.workspace_id = ?
       ORDER BY c.ai_score DESC, c.created_at DESC
       LIMIT 100`
    ).bind(user.workspace.id).all();

    return json({
      ok: true,
      clips: (result.results || []).map(row => ({
        id: row.id, sourceId: row.source_video_id, sourceTitle: row.source_title,
        title: row.title, startSeconds: row.start_seconds, endSeconds: row.end_seconds,
        sourceDuration: row.source_duration,
        durationSeconds: Math.max(0, Number(row.end_seconds) - Number(row.start_seconds)),
        hook: row.hook, score: row.ai_score, transcript: row.transcript,
        caption: row.caption, hashtags: row.hashtags, language: row.language,
        metadataVersion: row.metadata_version || 0, status: row.status, createdAt: row.created_at
      }))
    });
  } catch {
    return json({ ok: false, error: "Could not load discovered clips." }, 503);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const body = await readJson(request);
  const clipId = typeof body?.clipId === "string" ? body.clipId.trim() : "";
  if (!clipId) return json({ ok: false, error: "Clip ID is required." }, 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const hashtags = typeof body.hashtags === "string" ? body.hashtags.trim() : "";
  const language = typeof body.language === "string" ? body.language.trim() : "";
  const start = Number(body.startSeconds);
  const end = Number(body.endSeconds);
  if (!title || title.length > 120) return json({ ok: false, error: "Title must contain 1–120 characters." }, 400);
  if (caption.length > 2200 || hashtags.length > 500 || language.length > 20) {
    return json({ ok: false, error: "Caption, hashtags, or language exceeds its allowed length." }, 400);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    return json({ ok: false, error: "Enter a valid start and end time." }, 400);
  }

  try {
    const clip = await env.DB.prepare(
      `SELECT c.id, c.start_seconds, c.end_seconds, s.duration_seconds
       FROM clips c JOIN source_videos s ON s.id = c.source_video_id
       WHERE c.id = ? AND c.workspace_id = ?`
    ).bind(clipId, user.workspace.id).first();
    if (!clip) return json({ ok: false, error: "Clip not found in this workspace." }, 404);
    if (end > Number(clip.duration_seconds || 0) || end - start < 1 || end - start > 180) {
      return json({ ok: false, error: "The cut must be 1–180 seconds and remain inside the source video." }, 400);
    }

    const latest = await env.DB.prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM clip_metadata WHERE clip_id = ?"
    ).bind(clipId).first();
    const version = Number(latest?.version || 0) + 1;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE clips SET start_seconds = ?, end_seconds = ?, title = ?, status = 'editing', updated_at = ? WHERE id = ? AND workspace_id = ?"
      ).bind(start, end, title, now, clipId, user.workspace.id),
      env.DB.prepare(
        `INSERT INTO clip_metadata (id, clip_id, version, title, caption, hashtags, language, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), clipId, version, title, caption, hashtags, language, now),
      env.DB.prepare(
        `INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at)
         VALUES (?, ?, 'clip', ?, 'clip_edited', ?, ?)`
      ).bind(crypto.randomUUID(), user.workspace.id, clipId, JSON.stringify({ version, startSeconds: start, endSeconds: end }), now)
    ]);
    return json({ ok: true, clip: { id: clipId, startSeconds: start, endSeconds: end, metadataVersion: version, status: "editing" } });
  } catch {
    return json({ ok: false, error: "Could not save clip edits. No changes were confirmed." }, 503);
  }
}
