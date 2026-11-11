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
              m.caption, m.hashtags, m.language, m.version AS metadata_version, m.created_at AS metadata_updated_at
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
        metadataVersion: row.metadata_version || 0, status: row.status, createdAt: row.created_at, lastEditedAt: row.metadata_version > 1 ? row.metadata_updated_at : null
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
      `SELECT c.id, c.start_seconds, c.end_seconds, s.duration_seconds,
              COALESCE((SELECT m.subtitle_config_json FROM clip_metadata m WHERE m.clip_id = c.id ORDER BY m.version DESC LIMIT 1), '{}') AS subtitle_config_json
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
        `INSERT INTO clip_metadata (id, clip_id, version, title, caption, hashtags, language, subtitle_config_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), clipId, version, title, caption, hashtags, language, clip.subtitle_config_json || "{}", now),
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


export async function onRequestDelete({ request, env }) {
  if (!env.DB || !env.MEDIA) return json({ ok: false, error: "Database or private storage is not configured. No clips were deleted." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const body = await readJson(request);
  const requested = Array.isArray(body?.clipIds) ? body.clipIds : [];
  const clipIds = [...new Set(requested.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))].slice(0, 100);
  if (!clipIds.length) return json({ ok: false, error: "Select at least one clip to delete." }, 400);

  try {
    const placeholders = clipIds.map(() => "?").join(",");
    const owned = await env.DB.prepare(
      `SELECT id FROM clips WHERE workspace_id = ? AND id IN (${placeholders})`
    ).bind(user.workspace.id, ...clipIds).all();
    const ids = (owned.results || []).map(row => row.id);
    if (!ids.length) return json({ ok: false, error: "No selected clips were found in this workspace." }, 404);

    const ownedPlaceholders = ids.map(() => "?").join(",");
    const activePublishing = await env.DB.prepare(
      `SELECT id FROM publishing_jobs WHERE clip_id IN (${ownedPlaceholders}) AND status IN ('queued','uploading','processing') LIMIT 1`
    ).bind(...ids).first();
    if (activePublishing) {
      return json({ ok: false, error: "At least one selected clip is currently being published. Wait for publishing to finish before deleting it." }, 409);
    }

    const assets = await env.DB.prepare(
      `SELECT storage_key FROM clip_assets WHERE clip_id IN (${ownedPlaceholders})`
    ).bind(...ids).all();
    const keys = [...new Set((assets.results || []).map(row => row.storage_key).filter(Boolean))];

    // Remove private render assets before deleting their database references.
    if (keys.length) {
      try { await env.MEDIA.delete(keys); }
      catch (error) {
        console.error("Clip asset cleanup failed", error);
        return json({ ok: false, error: "Could not clean up clip render files. Nothing was deleted; please retry." }, 503);
      }
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM publishing_jobs WHERE clip_id IN (${ownedPlaceholders})`).bind(...ids),
      env.DB.prepare(`DELETE FROM clip_reviews WHERE clip_id IN (${ownedPlaceholders})`).bind(...ids),
      env.DB.prepare(`DELETE FROM clip_assets WHERE clip_id IN (${ownedPlaceholders})`).bind(...ids),
      env.DB.prepare(`DELETE FROM clip_metadata WHERE clip_id IN (${ownedPlaceholders})`).bind(...ids),
      env.DB.prepare(`DELETE FROM clips WHERE workspace_id = ? AND id IN (${ownedPlaceholders})`).bind(user.workspace.id, ...ids)
    ]);

    return json({ ok: true, deleted: ids.length, clipIds: ids });
  } catch (error) {
    console.error("Clip deletion failed", error);
    return json({ ok: false, error: "Could not delete selected clips. Please retry." }, 503);
  }
}
