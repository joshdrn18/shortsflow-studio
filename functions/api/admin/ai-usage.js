import { json, getSessionUser } from "../_lib/auth.js";

const SHORTSFLOW_DAILY_SAFETY_BUDGET = 3500;
const CLOUDFLARE_FREE_ALLOCATION_REFERENCE = 10000;
const HISTORY_DAYS = 14;
const DEFAULT_CLOUDFLARE_ACCOUNT_ID = "41fd279541b99b7e66e83d001385a000";
const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

function utcDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

async function queryCloudflareAnalytics(token, accountId, since, until) {
  const accountTag = JSON.stringify(accountId);
  const dailyQuery = `{
    viewer {
      accounts(filter: { accountTag: ${accountTag} }) {
        aiInferenceAdaptiveGroups(
          limit: 100
          filter: { date_geq: "${since}", date_lt: "${until}" }
        ) {
          count
          dimensions { date }
          sum { totalNeurons totalAudioSeconds }
        }
      }
    }
  }`;
  const errorQuery = `{
    viewer {
      accounts(filter: { accountTag: ${accountTag} }) {
        aiInferenceAdaptive(
          limit: 100
          filter: {
            datetime_geq: "${since}T00:00:00Z"
            datetime_lt: "${until}T00:00:00Z"
            errorCode_gt: 0
          }
        ) {
          datetime modelId errorCode neurons requestSource
        }
      }
    }
  }`;

  async function run(query) {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ query })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message || `Cloudflare Analytics returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    if (!payload || payload.errors?.length) {
      throw new Error(payload?.errors?.[0]?.message || "Cloudflare Analytics returned an invalid response.");
    }
    const account = payload?.data?.viewer?.accounts?.[0];
    if (!account) throw new Error("The token cannot read Workers AI analytics for the configured account.");
    return account;
  }

  const [dailyAccount, errorAccount] = await Promise.all([run(dailyQuery), run(errorQuery)]);
  const dailyRows = Array.isArray(dailyAccount.aiInferenceAdaptiveGroups)
    ? dailyAccount.aiInferenceAdaptiveGroups
    : [];
  const errorRows = Array.isArray(errorAccount.aiInferenceAdaptive)
    ? errorAccount.aiInferenceAdaptive
    : [];

  return {
    history: dailyRows.map((row) => ({
      date: row.dimensions?.date || null,
      neurons: Number(row.sum?.totalNeurons || 0),
      audioSeconds: Number(row.sum?.totalAudioSeconds || 0),
      requests: Number(row.count || 0)
    })).filter((row) => row.date).sort((a, b) => b.date.localeCompare(a.date)),
    errors: errorRows.map((row) => ({
      at: row.datetime || null,
      code: Number(row.errorCode || 0),
      model: row.modelId || null,
      source: row.requestSource || null
    })).filter((row) => row.code > 0 && row.at)
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);

  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);

  if (user.systemRole !== "admin" || !user.workspace?.id) {
    return json({ ok: false, error: "Global administrator access is required." }, 403);
  }

  const workspaceId = user.workspace.id;
  const now = new Date();
  const today = utcDate(now);
  const since = utcDate(addDays(now, -(HISTORY_DAYS - 1)));
  const until = utcDate(addDays(now, 1));
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

    let provider = null;
    let providerError = null;
    const analyticsToken = env.CLOUDFLARE_ANALYTICS_TOKEN;
    const cloudflareAccountId = env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_CLOUDFLARE_ACCOUNT_ID;
    if (analyticsToken) {
      try {
        provider = await queryCloudflareAnalytics(analyticsToken, cloudflareAccountId, since, until);
      } catch (error) {
        providerError = String(error?.message || "Cloudflare Analytics request failed.").slice(0, 240);
        console.error("cloudflare_ai_analytics_failed", providerError);
      }
    }

    const reservedNeurons = Number(todayUsage?.neurons_reserved || 0);
    const percent = Math.min(100, Math.round((reservedNeurons / SHORTSFLOW_DAILY_SAFETY_BUDGET) * 1000) / 10);
    const internalEvents = [...(autopilotEvents.results || []), ...(processingEvents.results || [])]
      .map((event) => ({
        at: event.updated_at,
        source: event.source,
        status: event.status,
        message: String(event.last_error || "").slice(0, 260)
      }));
    const providerEvents = (provider?.errors || []).map((event) => ({
      at: event.at,
      source: "Cloudflare Workers AI",
      status: "failed",
      message: `${event.code}: Workers AI request rejected${event.model ? ` · ${event.model}` : ""}`
    }));
    const events = [...internalEvents, ...providerEvents]
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .slice(0, 12);

    const providerToday = (provider?.history || []).find((row) => row.date === today) || null;
    const providerUsage = provider ? Number(providerToday?.neurons || 0) : null;
    const providerHistory = provider?.history || [];

    return json({
      ok: true,
      asOf: now.toISOString(),
      usageDateUTC: today,
      workspace: { id: workspaceId, name: user.workspace.name, role: user.systemRole },
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
        accountId: cloudflareAccountId,
        dailyFreeAllocationReference: CLOUDFLARE_FREE_ALLOCATION_REFERENCE,
        actualUsage: providerUsage,
        actualRemaining: null,
        estimatedHeadroom: providerUsage === null
          ? null
          : Math.max(0, CLOUDFLARE_FREE_ALLOCATION_REFERENCE - providerUsage),
        usagePercentOfReference: providerUsage === null
          ? null
          : Math.round((providerUsage / CLOUDFLARE_FREE_ALLOCATION_REFERENCE) * 1000) / 10,
        actualUsageStatus: provider ? "connected" : analyticsToken ? "error" : "not-configured",
        source: provider ? "Cloudflare GraphQL Analytics · aiInferenceAdaptiveGroups" : null,
        latestDataDate: providerHistory[0]?.date || null,
        history: providerHistory,
        providerError,
        note: provider
          ? "Provider-reported Workers AI inference usage from Cloudflare Analytics. Analytics may be delayed; estimated headroom is calculated against the published Free allocation reference, not a live quota balance."
          : analyticsToken
            ? `Cloudflare Analytics could not be read: ${providerError || "Check token permissions and account scope."}`
            : "Add the CLOUDFLARE_ANALYTICS_TOKEN Pages secret to enable account-wide Workers AI analytics. The 10,000-neuron figure is a published Free allocation reference, not a live account balance."
      },
      ledger: {
        scope: "ShortsFlow's internal AI reservation ledger",
        description: "Reserved estimates recorded before model calls. This is not the provider-reported account-wide consumption total."
      },
      history: (history.results || []).map((row) => ({
        date: row.usage_date,
        neuronsReserved: Number(row.neurons_reserved || 0),
        audioSecondsReserved: Number(row.audio_seconds_reserved || 0),
        updatedAt: row.updated_at
      })),
      quotaIncidents: {
        total: Number(autopilotCount?.total || 0) + Number(processingCount?.total || 0) + (provider?.errors?.length || 0),
        events,
        providerEvents: provider?.errors?.length || 0
      }
    });
  } catch (error) {
    console.error("admin_ai_usage_failed", error);
    return json({ ok: false, error: "Could not load AI usage data." }, 500);
  }
}
