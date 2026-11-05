import { json, getSessionUser } from "../_lib/auth.js";

const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/ogg"]);

function safeFilename(value) {
  const cleaned = String(value || "source-video").replace(/[\\/\\r\\n\\0]/g, "_").replace(/[^a-zA-Z0-9._ -]/g, "").trim();
  return (cleaned || "source-video").slice(0, 120);
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.MEDIA) return json({ ok: false, error: "Video storage is not configured. Check DB and MEDIA bindings." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const size = Number(request.headers.get("Content-Length") || 0);
  if (!ALLOWED_TYPES.has(contentType)) return json({ ok: false, error: "Unsupported video format. Use MP4, MOV, WebM, MKV or OGG." }, 415);
  if (!Number.isSafeInteger(size) || size < 1) return json({ ok: false, error: "Could not determine the video file size." }, 400);
  if (size > MAX_UPLOAD_BYTES) return json({ ok: false, error: "This upload endpoint currently supports files up to 90 MB." }, 413);

  const filename = safeFilename(decodeURIComponent(request.headers.get("X-File-Name") || "source-video"));
  const id = crypto.randomUUID();
  const key = `workspaces/${user.workspace.id}/sources/${id}/${filename}`;
  const title = filename.replace(/\\.[^.]+$/, "").slice(0, 180) || "Source video";
  const now = new Date().toISOString();

  try {
    const object = await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType },
      customMetadata: { workspaceId: user.workspace.id, sourceId: id, originalName: filename, uploadedBy: user.id }
    });
    try {
      await env.DB.prepare(
        `INSERT INTO source_videos
         (id, workspace_id, title, source_type, storage_key, mime_type, size_bytes, status, created_at, updated_at)
         VALUES (?, ?, ?, 'upload', ?, ?, ?, 'uploaded', ?, ?)`
      ).bind(id, user.workspace.id, title, key, contentType, size, now, now).run();
    } catch (databaseError) {
      await env.MEDIA.delete(key);
      throw databaseError;
    }
    await env.DB.prepare(
      "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'source_video', ?, 'source.uploaded', ?, ?)"
    ).bind(crypto.randomUUID(), user.workspace.id, id, JSON.stringify({ filename, sizeBytes: size, mimeType: contentType }), now).run();
    return json({ ok: true, source: { id, title, filename, sizeBytes: size, mimeType: contentType, status: "uploaded", createdAt: now } }, 201);
  } catch {
    return json({ ok: false, error: "Upload could not be saved. Please retry." }, 500);
  }
}
