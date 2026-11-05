const MODEL = "@cf/openai/whisper";
const CLIP_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const CHUNK_SECONDS = 60;
const MAX_SOURCE_SECONDS = 600;
const DAILY_NEURON_BUDGET = 8000;
const NEURONS_PER_AUDIO_MINUTE = 41.14;
const LOCK_SECONDS = 600;

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});

function parsePayload(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function claimJob(env) {
  const now = new Date();
  const nowIso = now.toISOString();
  const lockUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();
  const workerId = crypto.randomUUID();
  return env.DB.prepare(
    `UPDATE processing_jobs
       SET status = 'running', locked_by = ?, locked_until = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM processing_jobs
       WHERE job_type IN ('analyze_source','discover_clips')
         AND status IN ('queued','running')
         AND available_at <= ?
         AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY created_at ASC
       LIMIT 1
     )
       AND status IN ('queued','running')
       AND (locked_until IS NULL OR locked_until < ?)
     RETURNING *`
  ).bind(workerId, lockUntil, nowIso, nowIso, nowIso, nowIso).first();
}

async function releaseJob(env, jobId, payload, message = null) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE processing_jobs
       SET status = 'queued', payload_json = ?, available_at = ?, locked_until = NULL,
           locked_by = NULL, updated_at = ?, last_error = ?
     WHERE id = ? AND status = 'running'`
  ).bind(JSON.stringify(payload), now, now, message, jobId).run();
}

async function failJob(env, job, transcriptId, message) {
  const now = new Date().toISOString();
  const safeMessage = String(message || "Analysis failed.").slice(0, 1000);
  const statements = [env.DB.prepare(
    `UPDATE processing_jobs SET status = 'failed', attempts = attempts + 1,
       last_error = ?, locked_until = NULL, locked_by = NULL, updated_at = ?,
       completed_at = ? WHERE id = ?`
  ).bind(safeMessage, now, now, job.id)];
  if (job.job_type === "analyze_source") {
    statements.push(env.DB.prepare(
      "UPDATE source_videos SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND workspace_id = ?"
    ).bind(safeMessage, now, job.source_video_id, job.workspace_id));
    if (transcriptId) statements.push(env.DB.prepare(
      "UPDATE source_transcripts SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND workspace_id = ?"
    ).bind(safeMessage, now, transcriptId, job.workspace_id));
  }
  await env.DB.batch(statements);
}

async function reserveAiBudget(env, seconds) {
  const usageDate = new Date().toISOString().slice(0, 10);
  const neurons = (seconds / 60) * NEURONS_PER_AUDIO_MINUTE;
  const result = await env.DB.prepare(
    `INSERT INTO ai_usage_daily (usage_date, neurons_reserved, audio_seconds_reserved, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(usage_date) DO UPDATE SET
       neurons_reserved = neurons_reserved + excluded.neurons_reserved,
       audio_seconds_reserved = audio_seconds_reserved + excluded.audio_seconds_reserved,
       updated_at = excluded.updated_at
     WHERE neurons_reserved + excluded.neurons_reserved <= ?`
  ).bind(usageDate, neurons, Math.ceil(seconds), new Date().toISOString(), DAILY_NEURON_BUDGET).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function reserveTextBudget(env, inputTokens, outputTokens) {
  const usageDate = new Date().toISOString().slice(0, 10);
  const neurons = (Math.max(0, inputTokens) * 4119 + Math.max(0, outputTokens) * 34868) / 1000000 + 20;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO ai_usage_daily (usage_date, neurons_reserved, audio_seconds_reserved, updated_at)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(usage_date) DO UPDATE SET
       neurons_reserved = neurons_reserved + excluded.neurons_reserved,
       updated_at = excluded.updated_at
     WHERE neurons_reserved + excluded.neurons_reserved <= ?`
  ).bind(usageDate, neurons, now, DAILY_NEURON_BUDGET).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function ensureTranscript(env, job, payload) {
  if (payload.transcriptId) {
    const existing = await env.DB.prepare(
      "SELECT id, transcript_text, segments_json FROM source_transcripts WHERE id = ? AND workspace_id = ? AND source_video_id = ?"
    ).bind(payload.transcriptId, job.workspace_id, job.source_video_id).first();
    if (existing) return existing;
  }
  const latest = await env.DB.prepare(
    "SELECT COALESCE(MAX(version), 0) AS version FROM source_transcripts WHERE source_video_id = ?"
  ).bind(job.source_video_id).first();
  const version = Number(latest?.version || 0) + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO source_transcripts
       (id, workspace_id, source_video_id, version, status, model, transcript_text, segments_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'processing', ?, '', '[]', ?, ?)`
  ).bind(id, job.workspace_id, job.source_video_id, version, MODEL, now, now).run();
  payload.transcriptId = id;
  payload.chunkIndex = 0;
  await env.DB.prepare("UPDATE processing_jobs SET payload_json = ? WHERE id = ?")
    .bind(JSON.stringify(payload), job.id).run();
  return { id, transcript_text: "", segments_json: "[]" };
}

async function processNextJob(env) {
  if (!env.DB || !env.SOURCE_MEDIA || !env.MEDIA_TRANSFORM || !env.AI) return;
  const job = await claimJob(env);
  if (!job) return;
  if (job.job_type === "discover_clips") {
    try {
      await processClipDiscovery(env, job);
    } catch (error) {
      await failJob(env, job, null, error?.message || "Clip discovery failed.");
    }
    return;
  }
  if (job.job_type !== "analyze_source") {
    await failJob(env, job, null, "Unsupported analysis job type.");
    return;
  }

  let payload = parsePayload(job.payload_json);
  let transcriptId = payload.transcriptId || null;

  try {
    const source = await env.DB.prepare(
      `SELECT id, storage_key, mime_type, size_bytes, duration_seconds
       FROM source_videos WHERE id = ? AND workspace_id = ?`
    ).bind(job.source_video_id, job.workspace_id).first();

    if (!source) throw new Error("Source video no longer exists.");
    if (source.mime_type !== "video/mp4") {
      throw new Error("AI analysis currently requires an MP4 source. MOV, WebM and MKV can be stored, but are not supported by this analysis pipeline yet.");
    }
    const duration = Number(source.duration_seconds || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Video duration could not be read. Re-upload the source so ShortsFlow can capture its duration.");
    }
    if (duration > MAX_SOURCE_SECONDS) {
      throw new Error("AI analysis currently supports videos up to 10 minutes.");
    }
    if (Number(source.size_bytes || 0) >= 100 * 1024 * 1024) {
      throw new Error("Source exceeds the Media Transformations 100 MB input limit.");
    }

    payload.durationSeconds = duration;
    const transcript = await ensureTranscript(env, job, payload);
    transcriptId = transcript.id;
    const chunkIndex = Math.max(0, Number(payload.chunkIndex || 0));
    const startSeconds = chunkIndex * CHUNK_SECONDS;
    const chunkDuration = Math.min(CHUNK_SECONDS, duration - startSeconds);

    if (chunkDuration <= 0) {
      await completeTranscript(env, job, payload, transcriptId);
      return;
    }

    await env.DB.prepare(
      "UPDATE source_videos SET status = 'analyzing', error_message = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?"
    ).bind(new Date().toISOString(), source.id, job.workspace_id).run();

    const object = await env.SOURCE_MEDIA.get(source.storage_key);
    if (!object) throw new Error("Original video is missing from private R2 storage.");

    const extracted = await env.MEDIA_TRANSFORM.input(object.body).output({
      mode: "audio",
      time: startSeconds + "s",
      duration: chunkDuration + "s",
      format: "m4a"
    }).response();

    if (!extracted.ok) throw new Error("Audio extraction failed for this video. Check that it uses H.264 video and AAC or MP3 audio.");
    const audioBytes = new Uint8Array(await extracted.arrayBuffer());
    if (audioBytes.byteLength < 128) {
      if (chunkIndex > 0) {
        await completeTranscript(env, job, payload, transcriptId);
        return;
      }
      throw new Error("No usable audio track was found in this source video.");
    }

    const withinBudget = await reserveAiBudget(env, chunkDuration);
    if (!withinBudget) {
      const nextUtcDay = new Date();
      nextUtcDay.setUTCHours(24, 0, 5, 0);
      await env.DB.prepare(
        `UPDATE processing_jobs SET status = 'queued', available_at = ?, locked_until = NULL,
           locked_by = NULL, last_error = ?, updated_at = ? WHERE id = ?`
      ).bind(nextUtcDay.toISOString(), "Daily AI safety budget reached; this job will resume after the UTC reset.", new Date().toISOString(), job.id).run();
      return;
    }

    const result = await env.AI.run(MODEL, { audio: Array.from(audioBytes) });
    const current = await env.DB.prepare(
      "SELECT transcript_text, segments_json FROM source_transcripts WHERE id = ? AND workspace_id = ?"
    ).bind(transcriptId, job.workspace_id).first();
    const priorText = String(current?.transcript_text || "");
    const language = String(result?.transcription_info?.language || result?.language || "") || null;
    const nextText = [priorText, String(result?.text || "").trim()].filter(Boolean).join(" ").slice(0, 250000);
    let priorWords = [];
    try { priorWords = JSON.parse(current?.segments_json || "[]"); } catch { priorWords = []; }
    const words = Array.isArray(result?.words) ? result.words.map(word => ({
      word: String(word.word || word.text || ""),
      start: Number(word.start || 0) + startSeconds,
      end: Number(word.end || word.start || 0) + startSeconds
    })).filter(word => word.word && Number.isFinite(word.start) && Number.isFinite(word.end)) : [];
    const nextWords = priorWords.concat(words).slice(0, 30000);
    const now = new Date().toISOString();
    const nextIndex = chunkIndex + 1;
    const totalChunks = Math.ceil(duration / CHUNK_SECONDS);
    payload = { ...payload, transcriptId, chunkIndex: nextIndex, totalChunks };

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE source_transcripts SET transcript_text = ?, segments_json = ?, language = COALESCE(?, language), status = 'processing', error_message = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?"
      ).bind(nextText, JSON.stringify(nextWords), language, now, transcriptId, job.workspace_id),
      env.DB.prepare(
        "UPDATE processing_jobs SET status = 'running', payload_json = ?, available_at = ?, locked_until = NULL, locked_by = NULL, last_error = NULL, updated_at = ? WHERE id = ?"
      ).bind(JSON.stringify(payload), now, now, job.id)
    ]);

    if (nextIndex >= totalChunks) {
      await completeTranscript(env, job, payload, transcriptId);
    }
  } catch (error) {
    await failJob(env, job, transcriptId, error?.message || "Unexpected analysis error.");
  }
}

async function processClipDiscovery(env, job) {
  const payload = parsePayload(job.payload_json);
  const transcriptId = payload.transcriptId;
  if (!transcriptId) throw new Error("Transcript reference is missing from this discovery job.");

  const transcript = await env.DB.prepare(
    "SELECT id, language, transcript_text, segments_json, audio_duration_seconds FROM source_transcripts WHERE id = ? AND workspace_id = ? AND source_video_id = ? AND status = 'completed'"
  ).bind(transcriptId, job.workspace_id, job.source_video_id).first();
  if (!transcript) throw new Error("A completed transcript is required before clip discovery.");

  let words = [];
  try { words = JSON.parse(transcript.segments_json || "[]"); } catch { words = []; }
  if (!Array.isArray(words) || words.length < 20) {
    throw new Error("Not enough timestamped speech was found to identify reliable clip boundaries.");
  }

  const duration = Number(transcript.audio_duration_seconds || 0);
  const timeline = words.map(w => "[" + Number(w.start).toFixed(2) + "-" + Number(w.end).toFixed(2) + "] " + String(w.word || "")).join(" ");
  const system = "You are an expert short-form video editor. Identify the strongest self-contained moments from a transcript. Never invent speech or timestamps. Return valid JSON only.";
  const prompt = "Select 5 to 15 distinct short-form clip candidates from this transcript. Each clip must be 15 to 60 seconds, have a strong opening hook, make sense without extra context, and end on a complete thought or payoff. Prefer useful, surprising, emotional, funny, story-driven, or high-retention moments. Avoid long pauses, greetings, repeated content, and clips that need missing context. Choose startSeconds and endSeconds from the supplied word timestamps, not guesses. Do not make candidates overlap substantially. Rank the strongest first. Return this exact JSON shape: {\"candidates\":[{\"startSeconds\":12.3,\"endSeconds\":42.8,\"title\":\"Short title\",\"hook\":\"Opening hook\",\"reason\":\"Why this moment works\",\"caption\":\"Short social caption\",\"hashtags\":[\"#shorts\",\"#topic\"],\"score\":91}]}. Source duration: " + duration.toFixed(2) + " seconds. Transcript language: " + (transcript.language || "auto-detected") + ". Timestamped transcript: " + timeline;

  const estimatedInputTokens = Math.ceil((system.length + prompt.length) / 3);
  const withinBudget = await reserveTextBudget(env, estimatedInputTokens, 2400);
  if (!withinBudget) {
    const nextUtcDay = new Date();
    nextUtcDay.setUTCHours(24, 0, 5, 0);
    await env.DB.prepare(
      "UPDATE processing_jobs SET status = 'queued', available_at = ?, locked_until = NULL, locked_by = NULL, last_error = ?, updated_at = ? WHERE id = ?"
    ).bind(nextUtcDay.toISOString(), "Daily AI safety budget reached; clip discovery will resume after the UTC reset.", new Date().toISOString(), job.id).run();
    return;
  }

  const result = await env.AI.run(CLIP_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    max_tokens: 2400,
    temperature: 0.15,
    response_format: { type: "json_object" }
  });

  let raw = String(result?.response || result?.result || result?.text || "").trim();
  raw = raw.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("AI clip selector returned invalid JSON. Retry discovery."); }
  const candidates = Array.isArray(parsed) ? parsed : parsed?.candidates;
  if (!Array.isArray(candidates)) throw new Error("AI clip selector did not return a candidate list.");

  const existingResult = await env.DB.prepare(
    "SELECT start_seconds, end_seconds FROM clips WHERE discovery_job_id = ?"
  ).bind(job.id).all();
  const existing = (existingResult.results || []).map(row => ({ start: Number(row.start_seconds), end: Number(row.end_seconds) }));
  const accepted = [];
  const nearest = (value, field) => words.reduce((best, word) => {
    const current = Number(word[field]);
    return Math.abs(current - value) < Math.abs(Number(best[field]) - value) ? word : best;
  }, words[0]);

  const ranked = candidates.map(candidate => ({
    candidate,
    score: Math.max(0, Math.min(100, Number(candidate.score ?? candidate.aiScore ?? 0)))
  })).filter(item => Number.isFinite(item.score)).sort((a,b) => b.score - a.score);

  for (const item of ranked) {
    if (accepted.length + existing.length >= 15) break;
    const candidate = item.candidate;
    const rawStart = Number(candidate.startSeconds ?? candidate.start_seconds);
    const rawEnd = Number(candidate.endSeconds ?? candidate.end_seconds);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const startWord = nearest(rawStart, "start");
    const endWord = nearest(rawEnd, "end");
    const start = Number(startWord.start);
    const end = Number(endWord.end);
    const clipDuration = end - start;
    if (Math.abs(start - rawStart) > 3 || Math.abs(end - rawEnd) > 3) continue;
    if (start < 0 || end > duration || clipDuration < 15 || clipDuration > 60) continue;
    const overlaps = [...existing, ...accepted].some(other => {
      const overlap = Math.max(0, Math.min(end, other.end) - Math.max(start, other.start));
      return overlap / Math.min(clipDuration, other.end - other.start) > 0.3;
    });
    if (overlaps) continue;

    const title = String(candidate.title || candidate.hook || "Untitled clip").trim().slice(0, 120);
    const hook = String(candidate.hook || candidate.title || "").trim().slice(0, 220);
    if (!hook) continue;
    const excerpt = words.filter(word => Number(word.start) >= start && Number(word.end) <= end).map(word => String(word.word || "")).join(" ").trim();
    if (!excerpt) continue;
    const hashtags = Array.isArray(candidate.hashtags) ? candidate.hashtags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 12).join(" ") : String(candidate.hashtags || "").slice(0, 500);
    const caption = String(candidate.caption || candidate.reason || "").trim().slice(0, 2000);
    const clipId = crypto.randomUUID();
    const metadataId = crypto.randomUUID();
    const now = new Date().toISOString();
    accepted.push({ start, end, score: item.score });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO clips
         (id, workspace_id, source_video_id, title, start_seconds, end_seconds, hook, ai_score, transcript, status, discovery_job_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?, ?)`
      ).bind(clipId, job.workspace_id, job.source_video_id, title, start, end, hook, item.score, excerpt, job.id, now, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO clip_metadata (id, clip_id, version, title, caption, hashtags, language, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)"
      ).bind(metadataId, clipId, title, caption, hashtags, transcript.language || null, now)
    ]);
  }

  const finalCount = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM clips WHERE discovery_job_id = ?"
  ).bind(job.id).first();
  const count = Number(finalCount?.total || 0);
  if (!count) throw new Error("No valid clip candidates passed timestamp and duration checks. Retry discovery or use a longer source.");

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE processing_jobs SET status = 'succeeded', result_json = ?, completed_at = ?, updated_at = ?, locked_until = NULL, locked_by = NULL, last_error = NULL WHERE id = ?"
    ).bind(JSON.stringify({ transcriptId, candidates: count, model: CLIP_MODEL }), now, now, job.id),
    env.DB.prepare(
      "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'source_video', ?, 'source.clips_discovered', ?, ?)"
    ).bind(crypto.randomUUID(), job.workspace_id, job.source_video_id, JSON.stringify({ jobId: job.id, candidates: count, model: CLIP_MODEL }), now)
  ]);
}

async function completeTranscript(env, job, payload, transcriptId) {
  const now = new Date().toISOString();
  const discoveryJobId = crypto.randomUUID();
  const discoveryKey = "discover_clips:" + job.workspace_id + ":" + job.source_video_id + ":" + transcriptId + ":v1";
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE source_transcripts SET status = 'completed', audio_duration_seconds = COALESCE(?, audio_duration_seconds), error_message = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?"
    ).bind(Number(payload.durationSeconds || 0) || null, now, transcriptId, job.workspace_id),
    env.DB.prepare(
      "UPDATE source_videos SET status = 'ready', error_message = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?"
    ).bind(now, job.source_video_id, job.workspace_id),
    env.DB.prepare(
      "UPDATE processing_jobs SET status = 'succeeded', payload_json = ?, result_json = ?, completed_at = ?, updated_at = ?, locked_until = NULL, locked_by = NULL, last_error = NULL WHERE id = ?"
    ).bind(JSON.stringify({ ...payload, transcriptId }), JSON.stringify({ transcriptId, stage: "transcription_complete" }), now, now, job.id),
    env.DB.prepare(
      `INSERT OR IGNORE INTO processing_jobs
       (id, workspace_id, source_video_id, job_type, status, idempotency_key, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, 'discover_clips', 'queued', ?, ?, ?, ?)`
    ).bind(discoveryJobId, job.workspace_id, job.source_video_id, discoveryKey,
      JSON.stringify({ transcriptId, pipelineVersion: 1 }), now, now),
    env.DB.prepare(
      "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'source_video', ?, 'source.transcribed', ?, ?)"
    ).bind(crypto.randomUUID(), job.workspace_id, job.source_video_id, JSON.stringify({ transcriptId, jobId: job.id, model: MODEL }), now)
  ]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "ShortsFlow Analysis Engine",
        mode: "scheduled",
        bindings: {
          database: Boolean(env.DB),
          sourceStorage: Boolean(env.SOURCE_MEDIA),
          mediaTransformations: Boolean(env.MEDIA_TRANSFORM),
          workersAI: Boolean(env.AI)
        }
      });
    }
    return json({ ok: false, error: "Not found." }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processNextJob(env));
  }
};
