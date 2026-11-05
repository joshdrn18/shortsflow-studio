import { json, getSessionUser } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const workspaceId = user.workspace.id;
  try {
    const [sources, clips, review, published, activity] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM source_videos WHERE workspace_id = ?").bind(workspaceId).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM clips WHERE workspace_id = ?").bind(workspaceId).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM clips WHERE workspace_id = ? AND status = 'in_review'").bind(workspaceId).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM publishing_jobs j JOIN clips c ON c.id = j.clip_id WHERE c.workspace_id = ? AND j.status = 'published'").bind(workspaceId).first(),
      env.DB.prepare("SELECT id, entity_type, entity_id, event, details, created_at FROM activity_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 8").bind(workspaceId).all()
    ]);

    return json({
      ok: true,
      workspace: user.workspace,
      stats: {
        sources: Number(sources?.total || 0),
        clips: Number(clips?.total || 0),
        awaitingReview: Number(review?.total || 0),
        published: Number(published?.total || 0)
      },
      activity: activity.results || []
    });
  } catch {
    return json({ ok: false, error: "Could not load workspace summary." }, 500);
  }
}