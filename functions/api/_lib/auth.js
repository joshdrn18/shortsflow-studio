const encoder = new TextEncoder();
const SESSION_COOKIE = "sf_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 100000;

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64(new Uint8Array(digest));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algorithm, iterationsText, saltText, expectedText] = stored.split("$");
    const iterations = Number(iterationsText);
    if (algorithm !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 50000 || iterations > 1000000) return false;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(saltText), iterations },
      key,
      256
    );
    const actual = new Uint8Array(bits);
    const expected = fromBase64(expectedText);
    if (actual.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ expected[i];
    return mismatch === 0;
  } catch {
    return false;
  }
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

export async function createSession(db, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64(tokenBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db.prepare(
    "INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(sessionId, userId, tokenHash, expiresAt).run();
  return { cookie: sessionCookie(token), expiresAt };
}

export async function getSessionUser(request, env) {
  if (!env.DB) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.status,
            w.id AS workspace_id, w.name AS workspace_name, wm.role,
            s.id AS session_id
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN workspace_members wm ON wm.user_id = u.id
     LEFT JOIN workspaces w ON w.id = wm.workspace_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
     ORDER BY wm.created_at ASC LIMIT 1`
  ).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.session_id).run();
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    workspace: row.workspace_id ? { id: row.workspace_id, name: row.workspace_name, role: row.role } : null
  };
}

export async function requireDatabase(env) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  return null;
}