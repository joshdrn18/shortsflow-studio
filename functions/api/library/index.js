import { json, getSessionUser } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user?.workspace?.id) return json({ ok: false, error: "Authentication required." }, 401);
  try {
    const result = await env.DB.prepare(`
      SELECT a.id AS asset_id, a.clip_id, a.version AS asset_version,
             a.metadata_version, a.size_bytes, a.mime_type, a.created_at,
             c.start_seconds, c.end_seconds, c.status AS clip_status,
             c.hook, c.transcript AS spoken_script,
             COALESCE(m.title, c.title) AS title, m.caption, m.hashtags,
             m.language AS voice_language, m.subtitle_config_json,
             m.platform_description, m.platform_tags_json, m.source_references_json,
             s.title AS source_title,
             (SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id) AS current_metadata_version
      FROM clip_assets a
      JOIN clips c ON c.id=a.clip_id AND c.workspace_id=?
      JOIN source_videos s ON s.id=c.source_video_id AND s.workspace_id=c.workspace_id
      LEFT JOIN clip_metadata m ON m.clip_id=c.id AND m.version=a.metadata_version
      WHERE a.asset_type='render'
      ORDER BY a.created_at DESC
      LIMIT 150
    `).bind(user.workspace.id).all();
    const assets = (result.results || []).map(row => ({
      id: row.asset_id, clipId: row.clip_id, version: Number(row.asset_version),
      metadataVersion: Number(row.metadata_version), currentMetadataVersion: Number(row.current_metadata_version || 0),
      isCurrent: Number(row.metadata_version) === Number(row.current_metadata_version || 0),
      sizeBytes: Number(row.size_bytes || 0), mimeType: row.mime_type || "video/webm",
      createdAt: row.created_at, title: row.title || "Untitled clip",
      sourceTitle: row.source_title || "Source video",
      startSeconds: Number(row.start_seconds || 0), endSeconds: Number(row.end_seconds || 0),
      durationSeconds: Math.max(0, Number(row.end_seconds || 0) - Number(row.start_seconds || 0)),
      hook: row.hook || "",
      spokenScript: row.spoken_script || "",
      voiceLanguage: row.voice_language || "en",
      subtitleConfig: (() => { try { return JSON.parse(row.subtitle_config_json || "{}"); } catch { return {}; } })(),
      caption: row.caption || "", hashtags: row.hashtags || "",
      platformDescription: row.platform_description || "",
      platformTags: (() => { try { const v=JSON.parse(row.platform_tags_json || "[]"); return Array.isArray(v)?v:[]; } catch { return []; } })(),
      sourceReferences: (() => { try { const v=JSON.parse(row.source_references_json || "[]"); return Array.isArray(v)?v:[]; } catch { return []; } })(),
      isPublishReady: Boolean(row.platform_description),
      clipStatus: row.clip_status || "draft",
      previewUrl: `/api/clips/${row.clip_id}/render?assetId=${encodeURIComponent(row.asset_id)}`,
      downloadUrl: `/api/clips/${row.clip_id}/render?assetId=${encodeURIComponent(row.asset_id)}&download=1`
    }));
    return json({ ok: true, assets });
  } catch (error) {
    console.error("content_library_failed", error);
    return json({ ok: false, error: "Could not load rendered content." }, 503);
  }
}