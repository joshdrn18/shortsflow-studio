import { json, getSessionUser } from "../_lib/auth.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const PART_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/ogg"]);

function safeFilename(value) {
  const cleaned = String(value || "source-video").replace(/[\\/\r\n\0]/g, "_").replace(/[^a-zA-Z0-9._ -]/g, "").trim();
  return (cleaned || "source-video").slice(0, 120);
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.MEDIA) return json({ ok: false, error: "Video storage is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user?.workspace?.id) return json({ ok: false, error: "Authentication required or workspace missing." }, 401);

  let input = {};
  const action = request.headers.get("X-Multipart-Action") || "init";
  if (action !== "part") {
    try { input = await request.json(); } catch { return json({ ok: false, error: "Invalid upload request." }, 400); }
  }

  if (action === "init") {
    const size = Number(input.sizeBytes);
    const contentType = String(input.mimeType || "").toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) return json({ ok: false, error: "Unsupported video format." }, 415);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) return json({ ok: false, error: "Source videos must be between 1 byte and 200 MB." }, 413);
    const filename = safeFilename(input.filename);
    const key = `workspaces/${user.workspace.id}/sources/${crypto.randomUUID()}/${filename}`;
    try {
      const upload = await env.MEDIA.createMultipartUpload(key, {
        httpMetadata: { contentType },
        customMetadata: { workspaceId: user.workspace.id, originalName: filename, uploadedBy: user.id }
      });
      return json({ ok: true, key, uploadId: upload.uploadId, partBytes: PART_BYTES });
    } catch {
      return json({ ok: false, error: "Could not initialize multipart upload." }, 500);
    }
  }

  const key = request.headers.get("X-Upload-Key") || "";
  const uploadId = request.headers.get("X-Upload-Id") || "";
  if (!key.startsWith(`workspaces/${user.workspace.id}/sources/`) || !uploadId) return json({ ok: false, error: "Invalid upload session." }, 403);

  if (action === "part") {
    const partNumber = Number(request.headers.get("X-Part-Number"));
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ ok: false, error: "Invalid part number." }, 400);
    try {
      const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, request.body);
      return json({ ok: true, partNumber, etag: part.etag });
    } catch {
      return json({ ok: false, error: "A video chunk could not be uploaded. Retry this upload." }, 500);
    }
  }

  if (action === "complete") {
    const size = Number(input.sizeBytes);
    const contentType = String(input.mimeType || "").toLowerCase();
    const filename = safeFilename(input.filename);
    const durationRaw = Number(input.durationSeconds || 0);
    const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 && durationRaw <= 86400 ? durationRaw : null;
    const parts = Array.isArray(input.parts) ? input.parts.map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag || "") })) : [];
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES || !ALLOWED_TYPES.has(contentType) || !parts.length || parts.some(part => !Number.isInteger(part.partNumber) || !part.etag)) {
      return json({ ok: false, error: "Upload completion details are invalid." }, 400);
    }
    const id = crypto.randomUUID();
    const title = filename.replace(/\.[^.]+$/, "").slice(0, 180) || "Source video";
    const now = new Date().toISOString();
    try {
      const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
      await upload.complete(parts);
      try {
        await env.DB.prepare(
          `INSERT INTO source_videos
           (id, workspace_id, title, source_type, storage_key, mime_type, size_bytes, duration_seconds, status, created_at, updated_at)
           VALUES (?, ?, ?, 'upload', ?, ?, ?, ?, 'uploaded', ?, ?)`
        ).bind(id, user.workspace.id, title, key, contentType, size, durationSeconds, now, now).run();
      } catch (error) {
        await env.MEDIA.delete(key);
        throw error;
      }
      await env.DB.prepare(
        "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'source_video', ?, 'source.uploaded', ?, ?)"
      ).bind(crypto.randomUUID(), user.workspace.id, id, JSON.stringify({ filename, sizeBytes: size, mimeType: contentType }), now).run();
      return json({ ok: true, source: { id, title, filename, sizeBytes: size, mimeType: contentType, durationSeconds, status: "uploaded", createdAt: now } }, 201);
    } catch {
      return json({ ok: false, error: "Could not finalize the video upload. Retry or upload the file again." }, 500);
    }
  }

  return json({ ok: false, error: "Unsupported multipart action." }, 400);
}