import { json, getSessionUser } from "../_lib/auth.js";

const ANALYSIS_WORKER_HEALTH = "https://shortsflow-analysis-engine.inipastiuy-41f.workers.dev/health";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user?.workspace?.id) return json({ ok: false, error: "Authentication required." }, 401);
  try {
    const response = await fetch(ANALYSIS_WORKER_HEALTH, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    const payload = await response.json();
    return json({ ok: response.ok && Boolean(payload?.ok), checkedAt: new Date().toISOString(), worker: {
      ok: response.ok && Boolean(payload?.ok), httpStatus: response.status, service: String(payload?.service || "ShortsFlow Analysis Engine"),
      mode: String(payload?.mode || "unknown"), bindings: {
        database: Boolean(payload?.bindings?.database), sourceStorage: Boolean(payload?.bindings?.sourceStorage),
        mediaTransformations: Boolean(payload?.bindings?.mediaTransformations), workersAI: Boolean(payload?.bindings?.workersAI),
        backgroundRenderRunner: Boolean(payload?.bindings?.backgroundRenderRunner)
      }
    }});
  } catch {
    return json({ ok: false, checkedAt: new Date().toISOString(), worker: { ok: false, httpStatus: 0, service: "ShortsFlow Analysis Engine", error: "Worker health endpoint could not be reached." } });
  }
}
