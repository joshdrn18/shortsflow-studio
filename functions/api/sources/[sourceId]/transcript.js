import { json, getSessionUser } from "../../_lib/auth.js";

const SOURCE_ID = /^[0-9a-f-]{36}$/i;

export async function onRequestGet({ request, env, params }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const sourceId = params?.sourceId;
  if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId)) {
    return json({ ok: false, error: "Invalid source ID." }, 400);
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, version, status, language, model, transcript_text, segments_json,
              audio_duration_seconds, error_message, created_at, updated_at
       FROM source_transcripts
       WHERE source_video_id = ? AND workspace_id = ?
       ORDER BY version DESC LIMIT 1`
    ).bind(sourceId, user.workspace.id).first();

    if (!row) return json({ ok: false, error: "No transcript exists for this source yet." }, 404);
    let words = [];
    try {
      const parsed = JSON.parse(row.segments_json || "[]");
      if (Array.isArray(parsed)) words = parsed.slice(0, 30000);
    } catch {
      words = [];
    }

    return json({
      ok: true,
      transcript: {
        id: row.id,
        version: row.version,
        status: row.status,
        language: row.language,
        model: row.model,
        text: row.transcript_text || "",
        words,
        wordCount: words.length,
        durationSeconds: row.audio_duration_seconds,
        error: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch {
    return json({ ok: false, error: "Could not load this transcript." }, 503);
  }
}
