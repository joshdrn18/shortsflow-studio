import { json, getSessionUser } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, authenticated: false }, 200);
  return json({ ok: true, authenticated: true, user });
}