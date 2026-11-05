import { json, getSessionUser } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);
  try {
    const result = await env.DB.prepare(
      `SELECT id, title, storage_key, mime_type, size_bytes, duration_seconds, status, created_at
       FROM source_videos WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`
    ).bind(user.workspace.id).all();
    return json({ ok: true, sources: (result.results || []).map((row) => ({
      id: row.id, title: row.title, mimeType: row.mime_type, sizeBytes: row.size_bytes, durationSeconds: row.duration_seconds,
      status: row.status, createdAt: row.created_at
    })) });
  } catch {
    return json({ ok: false, error: "Could not load source videos." }, 500);
  }
}
