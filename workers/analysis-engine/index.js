const MODEL = "@cf/openai/whisper";
const CLIP_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const CHUNK_SECONDS = 60;
const MAX_SOURCE_SECONDS = 1800;
const DAILY_NEURON_BUDGET = 8000;
const NEURONS_PER_AUDIO_MINUTE = 41.14;
const LOCK_SECONDS = 600;


const TOKEN_KEY_BYTES = 32;
function decodeBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function decryptRefreshToken(value, secret) {
  const raw = decodeBase64(secret);
  if (raw.length !== TOKEN_KEY_BYTES) throw new Error("Invalid YouTube token encryption key.");
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  const [ivText, cipherText] = String(value || "").split(".");
  if (!ivText || !cipherText) throw new Error("Stored YouTube refresh token is invalid.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(ivText) }, key, decodeBase64(cipherText));
  return new TextDecoder().decode(plain);
}
async function processYoutubeJob(env) {
  if (!env.DB || !env.SOURCE_MEDIA || !env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_TOKEN_ENCRYPTION_KEY) return;
  const now = new Date().toISOString();
  const workerId = crypto.randomUUID();
  const job = await env.DB.prepare(`
    UPDATE publishing_jobs SET status='uploading',attempts=attempts+1,updated_at=?
    WHERE id=(SELECT p.id FROM publishing_jobs p JOIN clips c ON c.id=p.clip_id
      WHERE p.platform='youtube' AND p.status='queued' AND COALESCE(p.scheduled_at,p.created_at)<=?
      AND EXISTS(SELECT 1 FROM youtube_connections y WHERE y.workspace_id=c.workspace_id)
      ORDER BY COALESCE(p.scheduled_at,p.created_at),p.created_at LIMIT 1)
    AND status='queued' RETURNING *
  `).bind(now,now).first();
  if (!job) return;
  try {
    const connection = await env.DB.prepare("SELECT * FROM youtube_connections WHERE workspace_id=(SELECT workspace_id FROM clips WHERE id=?)").bind(job.clip_id).first();
    if (!connection) throw new Error("YouTube channel connection is missing.");
    const approved = await env.DB.prepare(`
      SELECT a.storage_key,a.mime_type,a.size_bytes,a.metadata_version,m.version AS current_metadata_version,
        r.id AS review_id
      FROM clip_assets a JOIN clips c ON c.id=a.clip_id
      JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(version) FROM clip_metadata WHERE clip_id=c.id)
      JOIN clip_reviews r ON r.clip_id=c.id AND r.render_asset_id=a.id AND r.metadata_version=m.version AND r.decision='approved'
      WHERE a.id=? AND a.clip_id=? AND a.asset_type='render' AND a.metadata_version=m.version
        AND a.metadata_version=? AND r.id=? AND a.version=(SELECT MAX(version) FROM clip_assets WHERE clip_id=c.id AND asset_type='render')
    `).bind(job.render_asset_id,job.clip_id,job.metadata_version,job.review_id).first();
    if (!approved) throw new Error("Approval no longer matches the latest render. Review the current clip again.");
    const object = await env.SOURCE_MEDIA.get(approved.storage_key);
    if (!object) throw new Error("Approved render file is missing from private R2 storage.");
    const size = Number(approved.size_bytes || object.size || 0);
    if (!size || size > 90 * 1024 * 1024) throw new Error("Render file is empty or exceeds the 90 MB publishing limit.");
    const refreshToken = await decryptRefreshToken(connection.refresh_token_encrypted,env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:"refresh_token"})
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || "Could not refresh YouTube access.");
    const metadata = {
      snippet:{title:String(job.title || "ShortsFlow Short").slice(0,100),description:String(job.description || "").slice(0,5000),tags:JSON.parse(job.tags_json || "[]"),categoryId:"22"},
      status:{privacyStatus:job.privacy_status || "private",selfDeclaredMadeForKids:false}
    };
    const mimeType = approved.mime_type || "video/webm";
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{
      method:"POST",headers:{Authorization:"Bearer "+tokens.access_token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Length":String(size),"X-Upload-Content-Type":mimeType},
      body:JSON.stringify(metadata)
    });
    if (!init.ok) throw new Error("YouTube upload initialization failed ("+init.status+"): "+(await init.text()).slice(0,500));
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength !== size) throw new Error("Render file size changed while preparing upload.");
    const uploaded = await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":mimeType,"Content-Length":String(size)},body:bytes});
    const result = await uploaded.json().catch(()=>({}));
    if (!uploaded.ok || !result.id) throw new Error("YouTube video upload failed ("+uploaded.status+"): "+JSON.stringify(result.error || result).slice(0,500));
    const completedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE publishing_jobs SET status='published',platform_video_id=?,platform_url=?,last_error=NULL,updated_at=? WHERE id=? AND status='uploading'").bind(result.id,"https://www.youtube.com/shorts/"+result.id,completedAt,job.id),
      env.DB.prepare("UPDATE clips SET status='published',updated_at=? WHERE id=?").bind(completedAt,job.clip_id),
      env.DB.prepare("INSERT INTO activity_logs (id,workspace_id,entity_type,entity_id,event,details,created_at) SELECT ?,c.workspace_id,'clip',c.id,'youtube.published',?,? FROM clips c WHERE c.id=?").bind(crypto.randomUUID(),JSON.stringify({jobId:job.id,videoId:result.id,renderAssetId:job.render_asset_id}),completedAt,job.clip_id)
    ]);
  } catch (error) {
    const message=String(error?.message || "YouTube upload failed.").slice(0,1000);
    await env.DB.prepare("UPDATE publishing_jobs SET status='failed',last_error=?,updated_at=? WHERE id=? AND status='uploading'").bind(message,new Date().toISOString(),job.id).run();
    console.error("youtube_upload_failed",job.id,message);
  }
}

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


function parseClipSelectorResponse(result) {
  const values = [result && result.response, result && result.result, result && result.text, result && result.output];
  for (const value of values) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value.candidates)) return value.candidates;
      if (Array.isArray(value)) return value;
    }
    let raw = String(value || '').trim();
    if (!raw) continue;
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const parsed = JSON.parse(raw.slice(first, last + 1).replace(/,\s*([}\]])/g, '$1'));
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.candidates)) return parsed.candidates;
      } catch (error) {}
    }
    const marker = raw.indexOf('"candidates"');
    const arrayStart = marker >= 0 ? raw.indexOf('[', marker) : -1;
    if (arrayStart >= 0) {
      const recovered = []; let depth = 0, objectStart = -1, quoted = false, escaped = false;
      for (let i = arrayStart + 1; i < raw.length; i++) {
        const ch = raw[i];
        if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') quoted = true;
        else if (ch === '{') { if (depth === 0) objectStart = i; depth++; }
        else if (ch === '}') { depth--; if (depth === 0 && objectStart >= 0) {
          try { recovered.push(JSON.parse(raw.slice(objectStart, i + 1))); } catch (error) {}
          objectStart = -1;
        } }
        else if (ch === ']' && depth === 0) break;
      }
      if (recovered.length) return recovered;
    }
  }
  return null;
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
      throw new Error("AI analysis currently supports videos up to 30 minutes.");
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
  const system = "You are an expert short-form video editor. Identify self-contained, high-retention moments from timestamped speech. Never invent speech or timestamps. Return valid JSON only.";
  // Split long transcripts into overlapping windows so one model response cannot crowd out
  // every candidate. Each window independently searches for 1–3 distinct moments.
  const WINDOW_SECONDS = 150;
  const OVERLAP_SECONDS = 30;
  const windows = [];
  for (let from = 0; from < duration; from += WINDOW_SECONDS - OVERLAP_SECONDS) {
    const to = Math.min(duration, from + WINDOW_SECONDS);
    const windowWords = words.filter(w => Number(w.start) >= from && Number(w.start) < to);
    if (windowWords.length >= 12) windows.push({ from, to, words: windowWords });
    if (to >= duration) break;
  }
  const candidates = [];
  const windowDiagnostics = [];
  for (const window of windows) {
    const timeline = window.words.map(w => "[" + Number(w.start).toFixed(2) + "-" + Number(w.end).toFixed(2) + "] " + String(w.word || "")).join(" ");
    const prompt = "Find 1 to 3 of the strongest distinct short-form clips inside this transcript window. Each must be 15–60 seconds, start with a compelling hook, make sense on its own, and end on a complete thought, joke, reveal, or payoff. Prefer meaningful moments; avoid greetings, filler, repeated lines and incomplete sentences. Use ONLY the supplied absolute word timestamps. Return fewer only if this window truly has fewer viable moments. Rank strongest first. Return compact JSON only: {\"candidates\":[{\"startSeconds\":12.3,\"endSeconds\":42.8,\"title\":\"Specific engaging title\",\"hook\":\"Opening line\",\"reason\":\"Why this moment works\",\"caption\":\"Short caption\",\"hashtags\":[\"#shorts\",\"#topic\"],\"score\":91}]}. Full source duration: " + duration.toFixed(2) + " seconds. Search window: " + window.from.toFixed(2) + "–" + window.to.toFixed(2) + " seconds. Transcript language: " + (transcript.language || "auto-detected") + ". Timestamped transcript: " + timeline;
    const inputTokens = Math.ceil((system.length + prompt.length) / 3);
    if (!await reserveTextBudget(env, inputTokens, 1100)) {
      throw new Error("Daily AI safety budget reached during clip discovery. Retry after the UTC reset.");
    }
    let result = await env.AI.run(CLIP_MODEL, {
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: 1100, temperature: 0.15, response_format: { type: "json_object" }
    });
    let parsed = parseClipSelectorResponse(result);
    if (!Array.isArray(parsed) || !parsed.length) {
      const retry = prompt + "\\nReturn only a valid compact JSON object with a candidates array. Keep every field short.";
      if (await reserveTextBudget(env, Math.ceil(retry.length / 3), 700)) {
        result = await env.AI.run(CLIP_MODEL, {
          messages: [{ role: "system", content: system }, { role: "user", content: retry }],
          max_tokens: 700, temperature: 0.1, response_format: { type: "json_object" }
        });
        parsed = parseClipSelectorResponse(result);
      }
    }
    const parsedCount = Array.isArray(parsed) ? parsed.length : 0;
    windowDiagnostics.push({ from: window.from, to: window.to, words: window.words.length, candidates: parsedCount });
    if (Array.isArray(parsed)) candidates.push(...parsed.map(candidate => ({ ...candidate, __windowStart: window.from, __windowEnd: window.to })));
  }
  if (!candidates.length) {
    throw new Error("AI clip selector could not find valid candidates in the transcript windows. Retry discovery.");
  }

  const existingResult = await env.DB.prepare(
    "SELECT start_seconds, end_seconds FROM clips WHERE discovery_job_id = ?"
  ).bind(job.id).all();
  const existing = (existingResult.results || []).map(row => ({ start: Number(row.start_seconds), end: Number(row.end_seconds) }));
  const accepted = [];
  const rejected = { invalidTime: 0, boundary: 0, tooLong: 0, outsideDuration: 0, overlap: 0, missingHook: 0, missingExcerpt: 0 };\n  let expandedShortMoments = 0;
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
    let rawStart = Number(candidate.startSeconds ?? candidate.start_seconds);
    let rawEnd = Number(candidate.endSeconds ?? candidate.end_seconds);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) { rejected.invalidTime++; continue; }
    const windowStart = Number(candidate.__windowStart || 0);
    const windowEnd = Number(candidate.__windowEnd || duration);
    // Some model responses return timestamps relative to their supplied window.
    // Convert those to the source timeline before validating against transcript words.
    if (windowStart > 0 && rawStart < windowStart - 3 && rawEnd <= (windowEnd - windowStart) + 3) {
      rawStart += windowStart;
      rawEnd += windowStart;
    }
    const startWord = nearest(rawStart, "start");
    const endWord = nearest(rawEnd, "end");
    let start = Number(startWord.start);
    let end = Number(endWord.end);
    let clipDuration = end - start;
    if (Math.abs(start - rawStart) > 3 || Math.abs(end - rawEnd) > 3) { rejected.boundary++; continue; }
    // The model often identifies a short spoken highlight rather than the full edit.
    // Expand that highlight with surrounding context so the resulting Short is still 15–60s.
    if (clipDuration < 15) {
      const anchor = (rawStart + rawEnd) / 2;
      const expandedStart = nearest(Math.max(0, anchor - 15), "start");
      const expandedEnd = nearest(Math.min(duration, anchor + 15), "end");
      start = Number(expandedStart.start);
      end = Number(expandedEnd.end);
      clipDuration = end - start;
      if (clipDuration < 15) {
        const widerStart = nearest(Math.max(0, anchor - 22), "start");
        const widerEnd = nearest(Math.min(duration, anchor + 22), "end");
        start = Number(widerStart.start);
        end = Number(widerEnd.end);
        clipDuration = end - start;
      }
      expandedShortMoments++;
    }
    if (start < 0 || end > duration) { rejected.outsideDuration++; continue; }
    if (clipDuration < 15) { rejected.tooLong++; continue; }
    if (clipDuration > 60) { rejected.tooLong++; continue; }
    const overlaps = [...existing, ...accepted].some(other => {
      const overlap = Math.max(0, Math.min(end, other.end) - Math.max(start, other.start));
      return overlap / Math.min(clipDuration, other.end - other.start) > 0.3;
    });
    if (overlaps) { rejected.overlap++; continue; }

    const hook = String(candidate.hook || candidate.title || "").trim().slice(0, 220);
    if (!hook) { rejected.missingHook++; continue; }
    const excerpt = words.filter(word => Number(word.start) >= start && Number(word.end) <= end).map(word => String(word.word || "")).join(" ").trim();
    if (!excerpt) { rejected.missingExcerpt++; continue; }
    const proposedTitle = String(candidate.title || "").trim();
    const genericTitle = /^(yes|yeah|yep|no|okay|ok|wow|oh|hey|look|wait|what|huh|hello|hi)[.!?\s]*$/i.test(proposedTitle);
    const title = String(genericTitle ? (candidate.reason || excerpt.split(/[.!?]/)[0] || candidate.hook) : (proposedTitle || candidate.reason || excerpt.split(/[.!?]/)[0] || "Untitled clip")).trim().slice(0, 120);
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
    ).bind(JSON.stringify({ transcriptId, candidates: count, model: CLIP_MODEL, returned: candidates.length, windows: windowDiagnostics, rejected, expandedShortMoments, returnedSamples: candidates.slice(0, 15).map(candidate => ({ start: candidate.startSeconds ?? candidate.start_seconds, end: candidate.endSeconds ?? candidate.end_seconds, windowStart: candidate.__windowStart })) }), now, now, job.id),
    env.DB.prepare(
      "INSERT INTO activity_logs (id, workspace_id, entity_type, entity_id, event, details, created_at) VALUES (?, ?, 'source_video', ?, 'source.clips_discovered', ?, ?)"
    ).bind(crypto.randomUUID(), job.workspace_id, job.source_video_id, JSON.stringify({ jobId: job.id, candidates: count, model: CLIP_MODEL, returned: candidates.length, windows: windowDiagnostics, rejected, returnedSamples: candidates.slice(0, 15).map(candidate => ({ start: candidate.startSeconds ?? candidate.start_seconds, end: candidate.endSeconds ?? candidate.end_seconds, windowStart: candidate.__windowStart })) }), now)
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
    ctx.waitUntil(Promise.all([processNextJob(env), processYoutubeJob(env)]));
  }
};
