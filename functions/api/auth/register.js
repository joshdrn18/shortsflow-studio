import { json, readJson, normalizeEmail, hashPassword, createSession, requireDatabase } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const unavailable = await requireDatabase(env);
  if (unavailable) return unavailable;

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "Invalid request body." }, 400);

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 60) : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ ok: false, error: "Enter a valid email address." }, 400);
  }
  if (password.length < 10 || password.length > 128) {
    return json({ ok: false, error: "Password must be between 10 and 128 characters." }, 400);
  }
  if (displayName.length < 2) {
    return json({ ok: false, error: "Display name must contain at least 2 characters." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").bind(email).first();
  if (existing) return json({ ok: false, error: "An account with this email already exists." }, 409);

  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)")
        .bind(userId, email, displayName, passwordHash),
      env.DB.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)")
        .bind(workspaceId, `${displayName}'s workspace`),
      env.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'owner')")
        .bind(membershipId, workspaceId, userId)
    ]);
  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("unique")) {
      return json({ ok: false, error: "An account with this email already exists." }, 409);
    }
    return json({ ok: false, error: "Could not create the account. Please try again." }, 500);
  }

  const session = await createSession(env.DB, userId);
  return json({
    ok: true,
    user: { id: userId, email, displayName, workspace: { id: workspaceId, name: `${displayName}'s workspace`, role: "owner" } }
  }, 201, { "Set-Cookie": session.cookie });
}