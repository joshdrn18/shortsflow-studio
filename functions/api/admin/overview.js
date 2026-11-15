import { json, getSessionUser } from "../_lib/auth.js";

async function rows(statement) {
  const result = await statement.all();
  return result.results || [];
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (user.systemRole !== "admin") return json({ ok: false, error: "Global administrator access is required." }, 403);

  try {
    const db = env.DB;
    const [
      totals, jobCounts, renderCounts, autopilotCounts, members, processing, renders, autopilot, activity, autopilotSettings, adminAudit
    ] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE status='active') AS activeUsers,
        (SELECT COUNT(*) FROM users WHERE status='suspended') AS suspendedUsers,
        (SELECT COUNT(*) FROM workspaces) AS workspaces,
        (SELECT COUNT(*) FROM source_videos) AS sources,
        (SELECT COUNT(*) FROM clips) AS clips,
        (SELECT COUNT(*) FROM clips WHERE status='in_review') AS awaitingReview,
        (SELECT COUNT(*) FROM clips WHERE status='published') AS published
      `).first(),
      db.prepare("SELECT status, COUNT(*) AS total FROM processing_jobs GROUP BY status").all(),
      db.prepare("SELECT status, COUNT(*) AS total FROM clip_render_jobs GROUP BY status").all(),
      db.prepare("SELECT status, COUNT(*) AS total FROM autopilot_jobs GROUP BY status").all(),
      db.prepare(`SELECT u.id, u.email, u.display_name, u.status, u.system_role, u.created_at,
        COUNT(DISTINCT wm.workspace_id) AS workspace_count,
        GROUP_CONCAT(DISTINCT w.name) AS workspace_names
        FROM users u
        LEFT JOIN workspace_members wm ON wm.user_id=u.id
        LEFT JOIN workspaces w ON w.id=wm.workspace_id
        GROUP BY u.id
        ORDER BY u.created_at DESC LIMIT 100`).all(),
      db.prepare(`SELECT j.id, j.job_type AS type, j.status, j.attempts, j.last_error AS error,
        j.created_at, j.updated_at, w.name AS workspace
        FROM processing_jobs j JOIN workspaces w ON w.id=j.workspace_id
        ORDER BY j.updated_at DESC LIMIT 20`).all(),
      db.prepare(`SELECT j.id, 'render' AS type, j.status, j.attempts, j.last_error AS error,
        j.created_at, j.updated_at, w.name AS workspace
        FROM clip_render_jobs j JOIN workspaces w ON w.id=j.workspace_id
        ORDER BY j.updated_at DESC LIMIT 20`).all(),
      db.prepare(`SELECT j.id, 'autopilot' AS type, j.status, j.attempts, j.last_error AS error,
        j.created_at, j.updated_at, w.name AS workspace, j.title
        FROM autopilot_jobs j JOIN workspaces w ON w.id=j.workspace_id
        ORDER BY j.updated_at DESC LIMIT 20`).all(),
      db.prepare(`SELECT a.id, a.event, a.entity_type, a.entity_id, a.details, a.created_at,
        w.name AS workspace
        FROM activity_logs a JOIN workspaces w ON w.id=a.workspace_id
        ORDER BY a.created_at DESC LIMIT 40`).all(),
      db.prepare(`SELECT w.id AS workspace_id,w.name,COALESCE(s.enabled,0) AS enabled,COALESCE(s.daily_target,3) AS daily_target
        FROM workspaces w LEFT JOIN autopilot_settings s ON s.workspace_id=w.id ORDER BY w.created_at DESC LIMIT 100`).all(),
      db.prepare(`SELECT a.id,a.action,a.target_type,a.target_id,a.details_json,a.created_at,u.email AS admin_email
        FROM admin_audit_logs a JOIN users u ON u.id=a.admin_user_id ORDER BY a.created_at DESC LIMIT 40`).all()
    ]);

    const jobs = [
      ...(processing.results || []),
      ...(renders.results || []),
      ...(autopilot.results || [])
    ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 40);

    return json({
      ok: true,
      asOf: new Date().toISOString(),
      totals: Object.fromEntries(Object.entries(totals || {}).map(([key, value]) => [key, Number(value || 0)])),
      queues: {
        processing: jobCounts.results || [],
        rendering: renderCounts.results || [],
        autopilot: autopilotCounts.results || []
      },
      members: members.results || [],
      jobs,
      activity: activity.results || [],
      autopilotSettings: autopilotSettings.results || [],
      adminAudit: adminAudit.results || []
    });
  } catch (error) {
    console.error("admin_overview_failed", error);
    return json({ ok: false, error: "Could not load platform administration data." }, 500);
  }
}
