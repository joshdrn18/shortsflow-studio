import { json, sha256, expiredSessionCookie } from "../_lib/auth.js";

function readSessionToken(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === "sf_session") return value.join("=");
  }
  return "";
}

export async function onRequestPost({ request, env }) {
  const token = readSessionToken(request);
  if (token && env.DB) {
    const tokenHash = await sha256(token);
    await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie() });
}