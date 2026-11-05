import { json, getSessionUser } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  try {
    const result = await env.DB.prepare(
      `SELECT c.id, c.source_video_id, s.title AS source_title, c.title, c.start_seconds,
              c.end_seconds, c.hook, c.ai_score, c.transcript, c.status, c.created_at,
              m.caption, m.hashtags, m.language
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
        id: row.id,
        sourceId: row.source_video_id,
        sourceTitle: row.source_title,
        title: row.title,
        startSeconds: row.start_seconds,
        endSeconds: row.end_seconds,
        durationSeconds: Math.max(0, Number(row.end_seconds) - Number(row.start_seconds)),
        hook: row.hook,
        score: row.ai_score,
        transcript: row.transcript,
        caption: row.caption,
        hashtags: row.hashtags,
        language: row.language,
        status: row.status,
        createdAt: row.created_at
      }))
    });
  } catch {
    return json({ ok: false, error: "Could not load discovered clips." }, 503);
  }
}
