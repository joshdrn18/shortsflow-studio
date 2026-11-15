import { json, getSessionUser } from "../_lib/auth.js";

const SHORTSFLOW_DAILY_SAFETY_BUDGET = 3500;
const CLOUDFLARE_FREE_ALLOCATION_REFERENCE = 10000;
const HISTORY_DAYS = 14;

function utcDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);

  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);

  const role = String(user.workspace?.role || "").toLowerCase();
  if (!user.workspace?.id || !["owner", "admin"].includes(role)) {
    return json({ ok: false, error: "Workspace owner or admin access is required." }, 403);
  }

  const workspaceId = user.workspace.id;
  const today = utcDate(new Date());
  const since = utcDate(new Date(Date.now() - (HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000));
  const quotaPattern = "%daily free allocation%";

  try {
    const [todayUsage, history, autopilotEvents, processingEvents, autopilotCount, processingCount] = await Promise.all([
      env.DB.prepare(
        "SELECT usage_date, neurons_reserved, audio_seconds_reserved, updated_at FROM ai_usage_daily WHERE usage_date = ?"
      ).bind(today).first(),
      env.DB.prepare(
        "SELECT usage_date, neurons_reserved, audio_seconds_reserved, updated_at FROM ai_usage_daily WHERE usage_date >= ? ORDER BY usage_date DESC LIMIT ?"
      ).bind(since, HISTORY_DAYS).all(),
      env.DB.prepare(
        `SELECT updated_at, status, last_error, 'Autopilot' AS source
         FROM autopilot_jobs
         WHERE workspace_id = ?
           AND (last_error LIKE '%4006%' OR lower(last_error) LIKE ? OR lower(last_error) LIKE '%workers ai safety budget%')
         ORDER BY updated_at DESC LIMIT 8`
      ).bind(workspaceId, quotaPattern).all(),
      env.DB.prepare(
        `SELECT updated_at, status, last_error, 'Source processing' AS source
         FROM processing_jobs
         WHERE workspace_id = ?
           AND (last_error LIKE '%4006%' OR lower(last_error) LIKE ? OR lower(last_error) LIKE '%workers ai safety budget%')
         ORDER BY updated_at DESC LIMIT 8`
      ).bind(workspaceId, quotaPattern).all(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM autopilot_jobs WHERE workspace_id = ? AND (last_error LIKE '%4006%' OR lower(last_error) LIKE ? OR lower(last_error) LIKE '%workers ai safety budget%')"
      ).bind(workspaceId, quotaPattern).first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM processing_jobs WHERE workspace_id = ? AND (last_error LIKE '%4006%' OR lower(last_error) LIKE ? OR lower(last_error) LIKE '%workers ai safety budget%')"
      ).bind(workspaceId, quotaPattern).first()
    ]);

    const reservedNeurons = Number(todayUsage?.neurons_reserved || 0);
    const percent = Math.min(100, Math.round((reservedNeurons / SHORTSFLOW_DAILY_SAFETY_BUDGET) * 1000) / 10);
    const events = [...(autopilotEvents.results || []), ...(processingEvents.results || [])]
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 10)
      .map((event) => ({
        at: event.updated_at,
        source: event.source,
        status: event.status,
        message: String(event.last_error || "").slice(0, 260)
      }));

    return json({
      ok: true,
      asOf: new Date().toISOString(),
      usageDateUTC: today,
      workspace: { id: workspaceId, name: user.workspace.name, role },
      internalBudget: {
        dailyLimit: SHORTSFLOW_DAILY_SAFETY_BUDGET,
        reservedNeurons,
        remainingToSafetyBudget: Math.max(0, SHORTSFLOW_DAILY_SAFETY_BUDGET - reservedNeurons),
        percent,
        audioSecondsReserved: Number(todayUsage?.audio_seconds_reserved || 0),
        lastReservedAt: todayUsage?.updated_at || null,
        status: reservedNeurons >= SHORTSFLOW_DAILY_SAFETY_BUDGET
          ? "limit-reached"
          : percent >= 90 ? "critical" : percent >= 70 ? "warning" : "healthy"
      },
      cloudflare: {
        dailyFreeAllocationReference: CLOUDFLARE_FREE_ALLOCATION_REFERENCE,
        actualUsage: null,
        actualRemaining: null,
        actualUsageStatus: "not-connected",
        note: "Cloudflare account-wide AI usage is not available through the current API connection. The 10,000-neuron figure is the published Free allocation reference, not a live account balance."
      },
      ledger: {
        scope: "ShortsFlow's internal AI reservation ledger",
        description: "Reserved estimates recorded before model calls. This is not a provider-reported consumption total and does not include AI usage outside this ShortsFlow database."
      },
      history: (history.results || []).map((row) => ({
        date: row.usage_date,
        neuronsReserved: Number(row.neurons_reserved || 0),
        audioSecondsReserved: Number(row.audio_seconds_reserved || 0),
        updatedAt: row.updated_at
      })),
      quotaIncidents: {
        total: Number(autopilotCount?.total || 0) + Number(processingCount?.total || 0),
        events
      }
    });
  } catch (error) {
    console.error("admin_ai_usage_failed", error);
    return json({ ok: false, error: "Could not load AI usage data." }, 500);
  }
}
