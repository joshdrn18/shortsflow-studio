import { json, getSessionUser } from "../_lib/auth.js";

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size < 1) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { invalid: true };
  }
  end = Math.min(end, size - 1);
  return { start, end, length: end - start + 1 };
}

export async function onRequestGet({ request, env, params }) {
  if (!env.DB || !env.MEDIA) return json({ ok: false, error: "Private video storage is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  const workspaceId = user.workspace?.id;
  if (!workspaceId) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const sourceId = String(params?.sourceId || "");
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return json({ ok: false, error: "Invalid source video ID." }, 400);

  try {
    const source = await env.DB.prepare(
      "SELECT storage_key, mime_type, size_bytes, title FROM source_videos WHERE id = ? AND workspace_id = ?"
    ).bind(sourceId, workspaceId).first();
    if (!source?.storage_key) return json({ ok: false, error: "Source video was not found." }, 404);

    const object = await env.MEDIA.head(source.storage_key);
    if (!object) return json({ ok: false, error: "Stored source video is missing." }, 404);

    const headers = new Headers({
      "Content-Type": source.mime_type || object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(object.size)
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);

    const range = parseRange(request.headers.get("Range"), object.size);
    if (range?.invalid) {
      headers.set("Content-Range", `bytes */${object.size}`);
      headers.delete("Content-Length");
      return new Response(null, { status: 416, headers });
    }

    const stored = range
      ? await env.MEDIA.get(source.storage_key, { range: { offset: range.start, length: range.length } })
      : await env.MEDIA.get(source.storage_key);
    if (!stored) return json({ ok: false, error: "Stored source video is missing." }, 404);

    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.size}`);
      headers.set("Content-Length", String(range.length));
      return new Response(stored.body, { status: 206, headers });
    }
    return new Response(stored.body, { status: 200, headers });
  } catch {
    return json({ ok: false, error: "Could not load this source video." }, 500);
  }
}
