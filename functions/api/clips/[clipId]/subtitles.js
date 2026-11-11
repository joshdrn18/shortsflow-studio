import { json, getSessionUser, readJson } from "../../_lib/auth.js";

const ID = /^[0-9a-f-]{36}$/i;
const DEFAULTS = { enabled: true, preset: "pop", fontSize: 28, color: "#ffffff", highlight: "#b59aff", position: "bottom", background: true };

function cleanSubtitleWord(value) {
  return String(value ?? "").replace(/<\/?b\d*\s*>|&lt;\/?b\d*\s*&gt;|\/b\d*/gi, " ").replace(/\s+/g, " ").trim();
}

function cleanConfig(value) {
  const v = value && typeof value === "object" ? value : {};
  const presets = ["pop", "classic", "minimal"];
  const colors = ["#ffffff", "#f8e16c", "#b9f5d0", "#ffb4c2"];
  const highlights = ["#b59aff", "#f8e16c", "#75c8ff", "#ff8fbd"];
  return {
    enabled: v.enabled !== false,
    preset: presets.includes(v.preset) ? v.preset : DEFAULTS.preset,
    fontSize: Math.max(18, Math.min(44, Math.round(Number(v.fontSize) || DEFAULTS.fontSize))),
    color: colors.includes(v.color) ? v.color : DEFAULTS.color,
    highlight: highlights.includes(v.highlight) ? v.highlight : DEFAULTS.highlight,
    position: ["top", "center", "bottom"].includes(v.position) ? v.position : DEFAULTS.position,
    background: v.background !== false,
    edgeOffset: Math.max(5, Math.min(25, Math.round(Number(v.edgeOffset) || 9))),
    fontWeight: [600, 700, 800, 900].includes(Number(v.fontWeight)) ? Number(v.fontWeight) : 900,
    highlightStyle: ["color", "pill", "underline"].includes(v.highlightStyle) ? v.highlightStyle : "color",
    animation: ["none", "pop", "fade", "slide"].includes(v.animation) ? v.animation : "pop",
    animationDuration: Math.max(80, Math.min(300, Math.round(Number(v.animationDuration) || 160)))
  };
}

export async function onRequestGet({ request, env, params }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  const clipId = String(params?.clipId || "");
  if (!ID.test(clipId)) return json({ ok: false, error: "Invalid clip ID." }, 400);
  try {
    const row = await env.DB.prepare(
      `SELECT c.id, c.source_video_id, c.start_seconds, c.end_seconds,
              m.version, m.subtitle_config_json, t.segments_json, t.language
       FROM clips c
       JOIN clip_metadata m ON m.clip_id = c.id
         AND m.version = (SELECT MAX(m2.version) FROM clip_metadata m2 WHERE m2.clip_id = c.id)
       LEFT JOIN source_transcripts t ON t.source_video_id = c.source_video_id
         AND t.workspace_id = c.workspace_id
         AND t.version = (SELECT MAX(t2.version) FROM source_transcripts t2 WHERE t2.source_video_id = c.source_video_id)
       WHERE c.id = ? AND c.workspace_id = ?`
    ).bind(clipId, user.workspace.id).first();
    if (!row) return json({ ok: false, error: "Clip not found." }, 404);
    let words = [];
    try { words = JSON.parse(row.segments_json || "[]"); } catch {}
    words = (Array.isArray(words) ? words : []).filter(w => w && typeof w.word === "string" && cleanSubtitleWord(w.word) && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)) && Number(w.end) > Number(w.start) && Number(w.end) > Number(row.start_seconds) && Number(w.start) < Number(row.end_seconds)).slice(0, 10000).map(w => ({ word: cleanSubtitleWord(w.word), start: Math.max(0, Number(w.start) - Number(row.start_seconds)), end: Math.max(0, Number(w.end) - Number(row.start_seconds)) }));
    let config = {};
    try { config = JSON.parse(row.subtitle_config_json || "{}"); } catch {}
    return json({ ok: true, clip: { id: row.id, sourceId: row.source_video_id, startSeconds: row.start_seconds, endSeconds: row.end_seconds, metadataVersion: row.version }, config: cleanConfig(config), words, language: row.language || null });
  } catch {
    return json({ ok: false, error: "Could not load subtitle settings." }, 503);
  }
}

export async function onRequestPut({ request, env, params }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);
  const clipId = String(params?.clipId || "");
  if (!ID.test(clipId)) return json({ ok: false, error: "Invalid clip ID." }, 400);
  const body = await readJson(request);
  const config = cleanConfig(body?.config);
  try {
    const row = await env.DB.prepare(
      `SELECT c.id, c.title, m.version, m.title AS metadata_title, m.caption, m.hashtags, m.language
       FROM clips c
       LEFT JOIN clip_metadata m ON m.clip_id = c.id
         AND m.version = (SELECT MAX(m2.version) FROM clip_metadata m2 WHERE m2.clip_id = c.id)
       WHERE c.id = ? AND c.workspace_id = ?`
    ).bind(clipId, user.workspace.id).first();
    if (!row) return json({ ok: false, error: "Clip not found." }, 404);
    const version = Number(row.version || 0) + 1;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO clip_metadata (id, clip_id, version, title, caption, hashtags, language, subtitle_config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), clipId, version, row.metadata_title || row.title || "", row.caption || "", row.hashtags || "", row.language || "", JSON.stringify(config), now),
      env.DB.prepare(`UPDATE clips SET status = 'editing', updated_at = ? WHERE id = ? AND workspace_id = ?`).bind(now, clipId, user.workspace.id),
      env.DB.prepare(`INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'clip', ?, 'subtitle_settings_saved', ?, ?)`)
        .bind(crypto.randomUUID(), user.workspace.id, clipId, JSON.stringify({ version, config }), now)
    ]);
    return json({ ok: true, config, metadataVersion: version });
  } catch {
    return json({ ok: false, error: "Could not save subtitle settings." }, 503);
  }
}
