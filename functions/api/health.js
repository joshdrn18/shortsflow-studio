export async function onRequestGet({ env }) {
  let database = false;
  let databaseError = null;

  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      database = true;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : "Database check failed";
    }
  }

  return Response.json({
    ok: !env.DB || database,
    service: "ShortsFlow Studio API",
    version: "0.1.0",
    database,
    databaseConfigured: Boolean(env.DB),
    ...(databaseError ? { databaseError } : {}),
    timestamp: new Date().toISOString()
  }, {
    status: env.DB && !database ? 503 : 200,
    headers: { "Cache-Control": "no-store" }
  });
}