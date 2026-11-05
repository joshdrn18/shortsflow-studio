import { json, readJson, normalizeEmail, verifyPassword, createSession, requireDatabase } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const unavailable = await requireDatabase(env);
  if (unavailable) return unavailable;

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "Invalid request body." }, 400);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 128) {
    return json({ ok: false, error: "Email or password is incorrect." }, 401);
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const attempts = await env.DB.prepare("SELECT attempts, window_started_at FROM auth_login_attempts WHERE email_key = ?")
    .bind(email).first();
  if (attempts && attempts.window_started_at > cutoff && attempts.attempts >= 8) {
    return json({ ok: false, error: "Too many login attempts. Please wait 15 minutes and try again." }, 429);
  }

  const user = await env.DB.prepare(
    "SELECT id, email, display_name, password_hash, status FROM users WHERE email = ? COLLATE NOCASE"
  ).bind(email).first();

  const valid = user && user.status === "active" && await verifyPassword(password, user.password_hash);
  if (!valid) {
    if (!attempts || attempts.window_started_at <= cutoff) {
      await env.DB.prepare(
        "INSERT INTO auth_login_attempts (email_key, attempts, window_started_at) VALUES (?, 1, ?) ON CONFLICT(email_key) DO UPDATE SET attempts = 1, window_started_at = excluded.window_started_at"
      ).bind(email, now.toISOString()).run();
    } else {
      await env.DB.prepare("UPDATE auth_login_attempts SET attempts = attempts + 1 WHERE email_key = ?").bind(email).run();
    }
    return json({ ok: false, error: "Email or password is incorrect." }, 401);
  }

  await env.DB.prepare("DELETE FROM auth_login_attempts WHERE email_key = ?").bind(email).run();
  const session = await createSession(env.DB, user.id);
  const workspace = await env.DB.prepare(
    "SELECT w.id, w.name, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = ? ORDER BY wm.created_at ASC LIMIT 1"
  ).bind(user.id).first();

  return json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      workspace: workspace ? { id: workspace.id, name: workspace.name, role: workspace.role } : null
    }
  }, 200, { "Set-Cookie": session.cookie });
}