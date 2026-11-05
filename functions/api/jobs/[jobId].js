import { json, getSessionUser, readJson } from "../_lib/auth.js";

const JOB_ID = /^[0-9a-f-]{36}$/i;

export async function onRequestPatch({ request, env, params }) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured." }, 503);
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  if (!user.workspace?.id) return json({ ok: false, error: "No workspace is assigned to this account." }, 403);

  const jobId = params?.jobId;
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) {
    return json({ ok: false, error: "Invalid job ID." }, 400);
  }
  const body = await readJson(request);
  const action = body?.action;
  if (!["cancel", "retry"].includes(action)) {
    return json({ ok: false, error: "Unsupported job action." }, 400);
  }

  try {
    const job = await env.DB.prepare(
      "SELECT id, status, attempts, max_attempts FROM processing_jobs WHERE id = ? AND workspace_id = ?"
    ).bind(jobId, user.workspace.id).first();
    if (!job) return json({ ok: false, error: "Job not found in this workspace." }, 404);

    const now = new Date().toISOString();
    if (action === "cancel") {
      if (job.status !== "queued") {
        return json({ ok: false, error: "Only queued jobs can be cancelled. A running job cannot be safely stopped yet." }, 409);
      }
      const result = await env.DB.prepare(
        "UPDATE processing_jobs SET status = 'cancelled', updated_at = ?, completed_at = ?, locked_until = NULL, locked_by = NULL WHERE id = ? AND workspace_id = ? AND status = 'queued'"
      ).bind(now, now, jobId, user.workspace.id).run();
      if (!result.meta?.changes) return json({ ok: false, error: "Job status changed. Refresh the queue and try again." }, 409);
    } else {
      if (job.status !== "failed") {
        return json({ ok: false, error: "Only failed jobs can be retried." }, 409);
      }
      const result = await env.DB.prepare(
        "UPDATE processing_jobs SET status = 'queued', attempts = 0, available_at = ?, updated_at = ?, completed_at = NULL, locked_until = NULL, locked_by = NULL, last_error = NULL, result_json = NULL WHERE id = ? AND workspace_id = ? AND status = 'failed'"
      ).bind(now, now, jobId, user.workspace.id).run();
      if (!result.meta?.changes) return json({ ok: false, error: "Job status changed. Refresh the queue and try again." }, 409);
    }

    await env.DB.prepare(
      "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'processing_job', ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), user.workspace.id, jobId, action === "cancel" ? "job.cancelled" : "job.retried", JSON.stringify({ previousStatus: job.status, requestedBy: user.id }), now).run();

    return json({ ok: true, job: { id: jobId, status: action === "cancel" ? "cancelled" : "queued" } });
  } catch {
    return json({ ok: false, error: "Could not update this job. Please refresh the queue and try again." }, 503);
  }
}
