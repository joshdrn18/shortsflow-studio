const MODEL = "@cf/openai/whisper";
const CLIP_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const CHUNK_SECONDS = 60;
const MAX_SOURCE_SECONDS = 1800;
const DAILY_NEURON_BUDGET = 8000;
const NEURONS_PER_AUDIO_MINUTE = 41.14;
const LOCK_SECONDS = 600;

function cleanSpeechToken(value) {
  return String(value ?? "")
    .replace(/<\/?b\d*\s*>|&lt;\/?b\d*\s*&gt;|(?:\\|\/)b\d*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}


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
async function restoreClipAfterYoutubeFailure(env,clipId,now){
 await env.DB.prepare(`UPDATE clips SET status=CASE WHEN EXISTS(
  SELECT 1 FROM clip_metadata m
  JOIN clip_assets a ON a.clip_id=m.clip_id AND a.asset_type='render'
   AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=m.clip_id AND x.asset_type='render')
   AND a.metadata_version=m.version
  JOIN clip_reviews r ON r.id=(SELECT x.id FROM clip_reviews x WHERE x.clip_id=m.clip_id
   AND x.render_asset_id=a.id AND x.metadata_version=m.version ORDER BY x.reviewed_at DESC,x.id DESC LIMIT 1)
   AND r.decision='approved'
  WHERE m.clip_id=clips.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clips.id)
 ) THEN 'approved' ELSE 'editing' END,updated_at=?
 WHERE id=? AND status='publishing'
 AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.clip_id=clips.id AND p.platform='youtube'
  AND p.status IN ('queued','uploading','processing','published'))`).bind(now,clipId).run();
}

async function processYoutubeJob(env) {
  // Pages Functions use MEDIA; the standalone Worker may use SOURCE_MEDIA.
  // Accept either binding so both deployments can point at the same private bucket.
  const mediaBucket = env.SOURCE_MEDIA || env.MEDIA;
  if (!env.DB || !mediaBucket || !env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_TOKEN_ENCRYPTION_KEY) return;
  const now = new Date().toISOString();
  // Do not leave uploads stuck forever after a Worker termination. Avoid an
  // automatic retry because YouTube may have accepted the upload already.
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const stale = await env.DB.prepare(`
    UPDATE publishing_jobs
    SET status='failed',
        last_error='Upload worker stopped before confirming the result. Check YouTube Studio before retrying to avoid duplicate uploads.',
        updated_at=?
    WHERE platform='youtube' AND status='uploading' AND updated_at<?
    RETURNING clip_id
  `).bind(now, staleBefore).all();
  for (const row of (stale.results || [])) {
    await restoreClipAfterYoutubeFailure(env,row.clip_id,now);
  }
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
      JOIN clip_reviews r ON r.id=(SELECT r2.id FROM clip_reviews r2 WHERE r2.clip_id=c.id AND r2.render_asset_id=a.id AND r2.metadata_version=m.version ORDER BY r2.reviewed_at DESC,r2.id DESC LIMIT 1) AND r.decision='approved'
      WHERE a.id=? AND a.clip_id=? AND a.asset_type='render' AND a.metadata_version=m.version
        AND a.metadata_version=? AND a.version=(SELECT MAX(version) FROM clip_assets WHERE clip_id=c.id AND asset_type='render')
    `).bind(job.render_asset_id,job.clip_id,job.metadata_version).first();
    if (!approved) throw new Error("Approval no longer matches the latest render. Review the current clip again.");
    const object = await mediaBucket.get(approved.storage_key);
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
      env.DB.prepare("INSERT INTO activity_logs (id,workspace_id,entity_type,entity_id,event,details,created_at) SELECT ?,c.workspace_id,'clip',c.id,'youtube.published',?,? FROM clips c WHERE c.id=?").bind(crypto.randomUUID(),JSON.stringify({jobId:job.id,videoId:result.id,renderAssetId:job.render_asset_id}),completedAt,job.clip_id),
      env.DB.prepare("UPDATE autopilot_jobs SET status='published',platform_video_id=?,platform_url=?,published_at=?,updated_at=?,last_error=NULL WHERE publishing_job_id=?").bind(result.id,"https://www.youtube.com/shorts/"+result.id,completedAt,completedAt,job.id)
    ]);
  } catch (error) {
    const message=String(error?.message || "YouTube upload failed.").slice(0,1000);
    const failedAt=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE publishing_jobs SET status='failed',last_error=?,updated_at=? WHERE id=? AND status='uploading'").bind(message,failedAt,job.id),
      env.DB.prepare(`UPDATE clips SET status=CASE WHEN EXISTS(
        SELECT 1 FROM clip_metadata m JOIN clip_assets a ON a.clip_id=m.clip_id AND a.asset_type='render'
         AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=m.clip_id AND x.asset_type='render') AND a.metadata_version=m.version
        JOIN clip_reviews r ON r.id=(SELECT x.id FROM clip_reviews x WHERE x.clip_id=m.clip_id AND x.render_asset_id=a.id AND x.metadata_version=m.version ORDER BY x.reviewed_at DESC,x.id DESC LIMIT 1) AND r.decision='approved'
        WHERE m.clip_id=clips.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clips.id)
       ) THEN 'approved' ELSE 'editing' END,updated_at=?
       WHERE id=? AND status='publishing'
       AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.clip_id=clips.id AND p.platform='youtube' AND p.status IN ('queued','uploading','processing','published'))`).bind(failedAt,job.clip_id)
    ]);
    await env.DB.prepare("UPDATE autopilot_jobs SET status='failed',last_error=?,updated_at=? WHERE publishing_job_id=? AND status<>'published'").bind(message,failedAt,job.id).run();
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

async function retryTransientJob(env, job, message) {
  const text = String(message || "Temporary processing error.").slice(0, 1000);
  const transient = /429|rate.?limit|5\d\d|timeout|timed out|network|fetch failed|overloaded|temporarily unavailable|internal error|connection reset|service unavailable/i.test(text);
  const attempts = Number(job.attempts || 0);
  if (!transient || attempts >= 2) return false;
  const delaySeconds = Math.min(300, 30 * (2 ** attempts));
  const now = new Date();
  const availableAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE processing_jobs
     SET status='queued', attempts=attempts+1, available_at=?,
         locked_until=NULL, locked_by=NULL, last_error=?, updated_at=?
     WHERE id=? AND status='running'`
  ).bind(availableAt, text, now.toISOString(), job.id).run();
  return true;
}

async function reserveAiBudget(env, reservationKey, seconds) {
  const usageDate = new Date().toISOString().slice(0, 10);
  const neurons = (seconds / 60) * NEURONS_PER_AUDIO_MINUTE;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO ai_usage_reservations (reservation_key, usage_date, neurons, audio_seconds, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(reservationKey, usageDate, neurons, Math.ceil(seconds), now).run();
  const reservation = await env.DB.prepare(
    "SELECT reservation_key FROM ai_usage_reservations WHERE reservation_key = ?"
  ).bind(reservationKey).first();
  return Boolean(reservation);
}

async function reserveTextBudget(env, reservationKey, inputTokens, outputTokens) {
  const usageDate = new Date().toISOString().slice(0, 10);
  const neurons = (Math.max(0, inputTokens) * 4119 + Math.max(0, outputTokens) * 34868) / 1000000 + 20;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO ai_usage_reservations (reservation_key, usage_date, neurons, audio_seconds, created_at) VALUES (?, ?, ?, 0, ?)"
  ).bind(reservationKey, usageDate, neurons, now).run();
  const reservation = await env.DB.prepare(
    "SELECT reservation_key FROM ai_usage_reservations WHERE reservation_key = ?"
  ).bind(reservationKey).first();
  return Boolean(reservation);
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
  payload.transcriptId = id;
  payload.chunkIndex = 0;
  // Persist the transcript row and its job pointer atomically. If the Worker
  // stops between these writes, a retry could otherwise create a second
  // transcript version for the same analysis job.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO source_transcripts
         (id, workspace_id, source_video_id, version, status, model, transcript_text, segments_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'processing', ?, '', '[]', ?, ?)`
    ).bind(id, job.workspace_id, job.source_video_id, version, MODEL, now, now),
    env.DB.prepare("UPDATE processing_jobs SET payload_json = ? WHERE id = ? AND status = 'running'")
      .bind(JSON.stringify(payload), job.id)
  ]);
  return { id, transcript_text: "", segments_json: "[]" };
}



function autoDecodeXml(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'").replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&nbsp;/gi," ").replace(/&rsquo;/gi,"'").replace(/&lsquo;/gi,"'")
    .replace(/&rdquo;/gi,'"').replace(/&ldquo;/gi,'"').replace(/&mdash;/gi,"—").replace(/&ndash;/gi,"–")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/\s+/g," ").trim();
}
function autoXmlField(block,name) {
  const re=new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i");
  const match=String(block||"").match(re);
  return match?autoDecodeXml(match[1]):"";
}
function textSafe(value,max) { return String(value??"").replace(/\s+/g," ").trim().slice(0,max); }
function parseAutopilotJson(result) {
  const queue=[result];
  const seen=new Set();
  while(queue.length) {
    const candidate=queue.shift();
    if(candidate===null||candidate===undefined)continue;
    if(typeof candidate==="object") {
      if(seen.has(candidate))continue;
      seen.add(candidate);
      if(Array.isArray(candidate)) {
        queue.push(...candidate);
        continue;
      }
      if((candidate.title&&Array.isArray(candidate.scenes))||(candidate.skip===true)||Array.isArray(candidate.translations))return candidate;
      if(candidate.script&&typeof candidate.script==="object")queue.unshift(candidate.script);
      for(const key of ["response","output_text","result","text","output","content","choices","message","data"]) {
        if(candidate[key]!==undefined&&candidate[key]!==null)queue.push(candidate[key]);
      }
      continue;
    }
    if(typeof candidate==="string") {
      const raw=candidate.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/i,"");
      const first=raw.indexOf("{"),last=raw.lastIndexOf("}");
      if(first>=0&&last>first) {
        try {
          const parsed=JSON.parse(raw.slice(first,last+1));
          if(parsed&&typeof parsed==="object")queue.unshift(parsed);
        } catch {}
      }
    }
  }
  throw new Error("Autopilot model did not return a valid script JSON object.");
}
function parseAutopilotScript(result) { return parseAutopilotJson(result); }
function localDayKey(timeZone,date=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timeZone||"Asia/Kuala_Lumpur",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return values.year+"-"+values.month+"-"+values.day;
}

async function discoverAutopilotSources() {
  const feeds=[
    {url:"https://techcrunch.com/feed/",name:"TechCrunch",niche:"Technology"},
    {url:"https://www.sciencedaily.com/rss/top/science.xml",name:"ScienceDaily",niche:"Science"},
    {url:"https://www.engadget.com/rss.xml",name:"Engadget",niche:"Technology"},
    {url:"https://www.wired.com/feed/rss",name:"WIRED",niche:"Technology and culture"},
    {url:"https://www.nasa.gov/feed/",name:"NASA",niche:"Space and science"}
  ];
  const now=Date.now(),minDate=now-7*86400000;
  const feedsFound=await Promise.all(feeds.map(async feed=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5500);
    try {
      const response=await fetch(feed.url,{signal:controller.signal,headers:{
        "user-agent":"Mozilla/5.0 (compatible; ShortsFlowResearch/1.0)",
        "accept":"application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
      }});
      if(!response.ok)return [];
      const xml=await response.text();
      const blocks=xml.includes("<item")?xml.split(/<item(?:\s[^>]*)?>/i).slice(1).map(part=>part.split(/<\/item>/i)[0]):[];
      return blocks.map(block=>{
        const title=autoXmlField(block,"title");
        const link=autoXmlField(block,"link")||((block.match(/<link[^>]+href=["']([^"']+)["']/i)||[])[1]||"");
        const published=autoXmlField(block,"pubDate")||autoXmlField(block,"published")||autoXmlField(block,"updated");
        const raw=autoXmlField(block,"content:encoded")||autoXmlField(block,"description")||autoXmlField(block,"summary");
        const excerpt=autoDecodeXml(raw).replace(/\s+/g," ").trim().slice(0,3800);
        const timestamp=Date.parse(published);
        if(!title||!/^https?:\/\//i.test(link)||excerpt.length<160||!Number.isFinite(timestamp)||timestamp<minDate||timestamp>now+86400000)return null;
        return {title,source:feed.name,niche:feed.niche,link,published,article_url:link,article_excerpt:excerpt,evidence_level:"publisher_rss_excerpt"};
      }).filter(Boolean);
    } catch(error) {
      console.warn("autopilot_feed_unavailable",feed.name,String(error?.message||error).slice(0,180));
      return [];
    } finally {
      clearTimeout(timer);
    }
  }));
  const unique=new Map();
  for(const item of feedsFound.flat()) {
    const key=item.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if(key&&!unique.has(key))unique.set(key,item);
  }
  return [...unique.values()].sort((a,b)=>Date.parse(b.published)-Date.parse(a.published)).slice(0,12);
}


async function normalizeAutopilotNarration(env,job,script,source) {
  let narration=textSafe(script.narration,4000);
  let count=narration.split(/\s+/).filter(Boolean).length;
  if(count<86) {
    const article=textSafe(source?.article_excerpt||"",3600);
    const system=[
      "You are a documentary script editor. Expand an under-length English narration into a complete 40–50 second YouTube Short.",
      "Return 90–105 spoken English words, not including the title or scene labels.",
      "Use only factual information supported by the article excerpt. Never add facts, dates, statistics, causes, quotes, identities, or outcomes that are not explicitly supported.",
      "Build a clear opening, explanation, development, and payoff. Keep sentences short and natural to speak.",
      "Do not add stage directions, timestamps, headings, scene names, or hashtags to the narration.",
      "Return one JSON object with title, topic, narration, and exactly four scenes. Each scene needs scene number, narration segment copied from the full narration, visual_prompt, on_screen_text, and source_ids [1].",
      "The four scene narration segments, in order, must cover the complete narration without omissions or invented sentences.",
      "If the article cannot support 90–105 factual spoken words, return {\"skip\":true,\"skip_reason\":\"article does not contain enough supported detail\"}."
    ].join(" ");
    const prompt="CURRENT TITLE: "+textSafe(script.title,100)+
      "\nCURRENT TOPIC: "+textSafe(script.topic,180)+
      "\nCURRENT SHORT NARRATION (too short; rewrite/expand): "+narration+
      "\nVERIFIED ARTICLE EXCERPT:\n"+article+
      "\nReturn compact valid JSON only, with narration between 90 and 105 words.";
    if(!await reserveTextBudget(env,"autopilot-narration-repair:"+job.id,Math.ceil((system.length+prompt.length)/3),950)) {
      throw new Error("Daily Workers AI safety budget reached before narration repair.");
    }
    const inference=await env.AI.run(CLIP_MODEL,{
      messages:[{role:"system",content:system},{role:"user",content:prompt}],
      max_tokens:1250,temperature:0.1,response_format:{type:"json_object"}
    });
    const repaired=parseAutopilotJson(inference);
    if(repaired.skip)throw new Error(String(repaired.skip_reason||"Article evidence cannot support a complete Short."));
    const repairedNarration=textSafe(repaired.narration,4000);
    const repairedCount=repairedNarration.split(/\s+/).filter(Boolean).length;
    if(repairedCount<86||repairedCount>120) {
      throw new Error("Narration repair QA failed: expected 86–120 supported spoken words, received "+repairedCount+".");
    }
    script.narration=repairedNarration;
    if(Array.isArray(repaired.scenes)&&repaired.scenes.length>=4)script.scenes=repaired.scenes;
    count=repairedCount;
  }
  if(count<80||count>125)throw new Error("Narration length QA failed: expected 80–125 spoken words, received "+count+".");
  return narration===script.narration?narration:script.narration;
}

function splitAutopilotNarration(value) {
  const words=String(value||"").trim().split(/\s+/).filter(Boolean);
  if(words.length<36)throw new Error("Narration is too short for four coherent scenes.");
  const chunks=[];
  let offset=0;
  for(let index=0;index<4;index++) {
    const remaining=words.length-offset;
    const slots=4-index;
    const take=Math.ceil(remaining/slots);
    const end=Math.min(words.length,offset+take);
    chunks.push(words.slice(offset,end).join(" "));
    offset=end;
  }
  return chunks;
}


async function translateAutopilotSubtitles(env,job,scenes) {
  const input=scenes.map(scene=>({scene:scene.scene,english:scene.narration}));
  const system=[
    "You are a professional English-to-Indonesian subtitle translator.",
    "Translate each full English spoken line into natural, fluent Bahasa Indonesia.",
    "Return a complete sentence or natural spoken phrase, not a label, topic, slug, keyword, filename, or identifier.",
    "Never return underscores, IDs, or shortened names in place of a translation. Preserve the meaning, facts, numbers, proper names, and tone.",
    "Keep each translation concise enough for a 40–50 second vertical video. Do not add new facts.",
    "Return only JSON in this exact shape: {\"translations\":[{\"scene\":1,\"text\":\"Kalimat terjemahan Bahasa Indonesia yang lengkap.\"}]}"
  ].join(" ");
  const prompt="Translate the following narration lines into Bahasa Indonesia. Return exactly one translation for each scene and preserve the scene numbers:\n"+JSON.stringify(input);
  if(!await reserveTextBudget(env,"autopilot-translation:"+job.id,Math.ceil((system.length+prompt.length)/3),700)) {
    throw new Error("Daily Workers AI safety budget reached before subtitle translation.");
  }
  const inference=await env.AI.run(CLIP_MODEL,{
    messages:[{role:"system",content:system},{role:"user",content:prompt}],
    max_tokens:850,temperature:0.1,response_format:{type:"json_object"}
  });
  const translated=parseAutopilotJson(inference);
  const rows=Array.isArray(translated?.translations)?translated.translations:[];
  const byScene=new Map(rows.map((row,index)=>[
    Number(row.scene)||index+1,
    textSafe(row.text||row.translation||row.subtitle||row.subtitle_text||row.indonesian,350)
  ]));
  return scenes.map((scene,index)=>{
    const value=byScene.get(Number(scene.scene))||textSafe(rows[index]?.text||rows[index]?.translation||rows[index]?.subtitle||rows[index]?.subtitle_text||rows[index]?.indonesian,350);
    const words=value.split(/\s+/).filter(Boolean);
    const looksLikeIdentifier=value.includes("_")||/^(?:scene|subtitle|segment)[-_]?\d+$/i.test(value)||/^\d+$/.test(value);
    if(value.length<4||words.length>40||looksLikeIdentifier) {
      throw new Error("Subtitle translation QA failed for scene "+scene.scene+". A readable Indonesian phrase was not returned ("+JSON.stringify(value.slice(0,60))+").");
    }
    return {...scene,subtitle_indonesian:value};
  });
}

async function generateAutopilotScript(env,job,bucket) {
  const sources=await discoverAutopilotSources();
  if(sources.length<1)throw new Error("No recent publisher RSS article with a substantive excerpt could be verified. This slot was skipped.");
  const previous=await env.DB.prepare("SELECT title,topic FROM autopilot_jobs WHERE workspace_id=? AND created_at>? ORDER BY created_at DESC LIMIT 20")
    .bind(job.workspace_id,new Date(Date.now()-30*86400000).toISOString()).all();
  const avoid=(previous.results||[]).map(item=>item.title+" — "+item.topic).join("\n");
  const sourceBrief=sources.map((item,index)=>
    "["+(index+1)+"] TITLE: "+item.title+
    " | PUBLISHER: "+item.source+
    " | PUBLISHED: "+item.published+
    " | EVIDENCE LEVEL: "+item.evidence_level+
    " | ARTICLE EXCERPT: "+item.article_excerpt+
    " | URL: "+item.article_url
  ).join("\n\n");
  const system=[
    "You are the editorial producer for a professional original YouTube Shorts channel.",
    "Create one compelling 40–50 second mini-documentary from a single specific current story with strong audience interest and a clear factual payoff. The complete spoken English narration MUST contain 90–105 words. Optimize for curiosity, retention and shareability; never promise virality or invent popularity signals.",
    "The supplied material includes actual publisher article text excerpts, not just headlines. Use only facts explicitly supported by those excerpts. Do not invent statistics, quotations, dates, results, causes, locations, identities, or context. If the excerpts do not support a coherent story, return {\"skip\":true,\"skip_reason\":\"article evidence is insufficient\"}.",
    "Choose exactly one supplied publisher article as the source for this Short. Do not combine unrelated stories or claim facts beyond that article excerpt.",
    "Every factual scene must be traceable to one or more supplied source IDs. The source_notes array must contain objects with numeric source_id and a short used_for description. Each scene must include source_ids as an array of those same numeric IDs.",
    "Narration is English, natural to speak and suitable for a global audience. Do not return translations in this script; subtitles are generated separately by a dedicated translator.",
    "Use exactly four scenes. The four scene narration segments together MUST cover the complete 90–105-word narration. Each scene needs a concrete factual narration, an original cinematic visual prompt, and brief on_screen_text of at most 6 words.",
    "Visuals must be original AI-generated illustrative scenes only. Do not recreate third-party footage, named creators, celebrities, logos, broadcast clips, or recognizable fictional characters. No text, captions, logos, or watermarks inside generated images.",
    "Use a specific non-generic title and first-two-second hook, a satisfying factual payoff, and a concise caption. Avoid generic clickbait, false urgency, and unsupported superlatives.",
    "Return only compact valid JSON in this exact shape:",
    "{\"title\":\"Specific title\",\"niche\":\"Science, technology, gaming, sports, or culture\",\"topic\":\"Specific story\",\"hook\":\"Opening hook\",\"narration\":\"Full English narration\",\"caption\":\"Short caption\",\"hashtags\":[\"#Shorts\"],\"source_notes\":[{\"source_id\":1,\"used_for\":\"The fact this source supports\"}],\"scenes\":[{\"scene\":1,\"narration\":\"English narration sentence\",\"visual_prompt\":\"Detailed original scene visual prompt\",\"on_screen_text\":\"Short words\",\"source_ids\":[1]}]}"
  ].join(" ");
  const prompt="CURRENT PUBLISHER ARTICLE EVIDENCE:\n"+sourceBrief+
    "\n\nRECENT CHANNEL TOPICS TO AVOID REPEATING:\n"+(avoid||"None.")+
    "\n\nCreate one original Short. Voice: English. Subtitles will be separately translated to Bahasa Indonesia. Target length: about 45 seconds. Return compact valid JSON only.";
  if(!await reserveTextBudget(env,"autopilot-script:"+job.id,Math.ceil((system.length+prompt.length)/3),1500)) {
    throw new Error("Daily Workers AI safety budget reached.");
  }
  const inference=await env.AI.run(CLIP_MODEL,{
    messages:[{role:"system",content:system},{role:"user",content:prompt}],
    max_tokens:1800,temperature:0.15,response_format:{type:"json_object"}
  });
  const script=parseAutopilotScript(inference);
  if(script.skip)throw new Error(String(script.skip_reason||"Article evidence was not strong enough."));
  if(!script.title||!script.topic||!script.narration) {
    const keys=script&&typeof script==="object"?Object.keys(script).slice(0,16).join(","):"not-an-object";
    throw new Error("Generated Short script is missing title, topic, or narration (fields: "+keys+").");
  }
  const allowedIds=new Set(sources.map((source,index)=>index+1));
  const sourceNotes=(Array.isArray(script.source_notes)?script.source_notes:[])
    .filter(note=>Number.isInteger(Number(note.source_id))&&allowedIds.has(Number(note.source_id)))
    .slice(0,1)
    .map(note=>({source_id:Number(note.source_id),used_for:textSafe(note.used_for,220)}));
  if(!sourceNotes.length)throw new Error("Research QA failed: the script did not cite a valid publisher article.");
  const sourceForNarration=sources[sourceNotes[0].source_id-1];
  script.narration=await normalizeAutopilotNarration(env,job,script,sourceForNarration);
  const selectedIds=new Set(sourceNotes.map(note=>note.source_id));
  let sceneDrafts=Array.isArray(script.scenes)?script.scenes.slice(0,4):[];
  const draftWordCount=sceneDrafts.reduce((total,scene)=>total+String(scene?.narration||"").split(/\\s+/).filter(Boolean).length,0);
  if(sceneDrafts.length<4||draftWordCount<75) {
    const narrationParts=splitAutopilotNarration(script.narration);
    const firstDraft=sceneDrafts[0]||{};
    const baseVisual=textSafe(firstDraft.visual_prompt,1300)||("Original cinematic documentary visuals illustrating "+textSafe(script.topic,180)+" using only the supplied source article context.");
    const shotDirections=[
      "Opening establishing wide shot, clear visual setting and strongest story subject.",
      "Medium documentary shot focusing on the main development described in this narration segment.",
      "Close-up or detailed process shot illustrating this narration segment without adding factual details.",
      "Final cinematic wide shot that visually resolves the same story and supports the factual takeaway."
    ];
    const existingDrafts=sceneDrafts.slice();
    sceneDrafts=narrationParts.map((part,index)=>({
      scene:index+1,narration:part,
      visual_prompt:textSafe(existingDrafts[index]?.visual_prompt,1300)||baseVisual+" Shot direction: "+shotDirections[index]+" Keep the exact same subject, setting and factual context; do not introduce additional people, objects, numbers or events.",
      on_screen_text:textSafe(existingDrafts[index]?.on_screen_text,60)||part.split(/\s+/).slice(0,5).join(" "),
      source_ids:Array.isArray(existingDrafts[index]?.source_ids)?existingDrafts[index].source_ids:[...selectedIds]
    }));
  }
  const scenes=sceneDrafts.slice(0,4).map((scene,index)=>{
    const sourceIds=(Array.isArray(scene.source_ids)?scene.source_ids.map(Number).filter(id=>selectedIds.has(id)):[]);
    if(!sourceIds.length)sourceIds.push(...selectedIds);
    return {
      scene:index+1,
      narration:textSafe(scene.narration,500),
      visual_prompt:textSafe(scene.visual_prompt,1800),
      on_screen_text:textSafe(scene.on_screen_text,60),
      source_ids:sourceIds,
      image_key:null
    };
  });
  if(scenes.some(scene=>!scene.narration||!scene.visual_prompt||!scene.source_ids.length)) {
    throw new Error("Research QA failed: a scene is missing its source reference, narration, or visual direction.");
  }
  const narration=scenes.map(scene=>scene.narration).join(" ");
  const spokenWordCount=narration.split(/\\s+/).filter(Boolean).length;
  if(spokenWordCount<80||spokenWordCount>125||narration.length>1900)throw new Error("Narration length QA failed: expected 80–125 spoken words, received "+spokenWordCount+".");
  const selectedSources=sources.filter((source,index)=>selectedIds.has(index+1));
  const sourceCorpus=selectedSources.map(source=>source.title+" "+source.article_excerpt).join(" ").toLowerCase();
  const numericClaims=narration.match(/\b\d[\d,]*(?:\.\d+)?\b/g)||[];
  for(const claim of numericClaims) {
    const normalized=claim.replace(/,/g,"");
    if(!sourceCorpus.includes(claim.toLowerCase())&&!sourceCorpus.includes(normalized)) {
      throw new Error("Research QA rejected an unsupported number in the narration: "+claim);
    }
  }
  const translatedScenes=await translateAutopilotSubtitles(env,job,scenes);
  const voiceResult=await env.AI.run("@cf/deepgram/aura-2-en",{text:narration,speaker:"luna",encoding:"mp3"});
  let audioBytes;
  if(voiceResult instanceof ReadableStream)audioBytes=await new Response(voiceResult).arrayBuffer();
  else if(voiceResult?.audio instanceof ReadableStream)audioBytes=await new Response(voiceResult.audio).arrayBuffer();
  else if(voiceResult?.audio instanceof ArrayBuffer)audioBytes=voiceResult.audio;
  else if(voiceResult?.audio instanceof Uint8Array)audioBytes=voiceResult.audio.buffer.slice(voiceResult.audio.byteOffset,voiceResult.audio.byteOffset+voiceResult.audio.byteLength);
  else throw new Error("English voice generation returned no playable audio.");
  if(!audioBytes.byteLength||audioBytes.byteLength>18*1024*1024)throw new Error("Generated voice audio is empty or too large.");
  const audioKey="workspaces/"+job.workspace_id+"/autopilot/"+job.id+"/voice.mp3";
  await bucket.put(audioKey,audioBytes,{httpMetadata:{contentType:"audio/mpeg"},customMetadata:{workspaceId:job.workspace_id,autopilotJobId:job.id}});
  const output={
    title:textSafe(script.title,100),niche:textSafe(script.niche,80)||"Trending stories",
    topic:textSafe(script.topic,180),hook:textSafe(script.hook,260),narration,
    caption:textSafe(script.caption,1200),
    hashtags:Array.isArray(script.hashtags)?script.hashtags.slice(0,8).map(x=>textSafe(x,50)):[],
    source_notes:sourceNotes,scenes:translatedScenes
  };
  const now=new Date().toISOString();
  await env.DB.prepare("UPDATE autopilot_jobs SET status='generating_scenes',niche=?,topic=?,title=?,hook=?,narration=?,voice_language='en',subtitle_language='id',script_json=?,sources_json=?,audio_key=?,scenes_json=?,next_scene_number=1,duration_seconds=45,updated_at=? WHERE id=? AND status='generating'")
    .bind(output.niche,output.topic,output.title,output.hook,narration,JSON.stringify(output),JSON.stringify(selectedSources),audioKey,JSON.stringify(translatedScenes),now,job.id).run();
}
async function makeAutopilotReport(env,workspaceId,dayKey) {
  const rows=await env.DB.prepare("SELECT id,title,topic,status,platform_url,platform_video_id,last_error,created_at,published_at FROM autopilot_jobs WHERE workspace_id=? AND day_key=? ORDER BY created_at")
    .bind(workspaceId,dayKey).all();
  const jobs=rows.results||[];
  const report={
    date:dayKey,
    produced:jobs.filter(j=>["render_queued","rendering","queued_publish","published"].includes(j.status)).length,
    published:jobs.filter(j=>j.status==="published").length,
    failed:jobs.filter(j=>j.status==="failed").length,
    pending:jobs.filter(j=>["queued","generating","generating_scenes","render_queued","rendering","queued_publish"].includes(j.status)).length,
    videos:jobs.map(j=>({title:j.title,topic:j.topic,status:j.status,url:j.platform_url||null,error:j.last_error||null,createdAt:j.created_at,publishedAt:j.published_at||null}))
  };
  const now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO autopilot_daily_reports (workspace_id,report_date,produced_count,published_count,failed_count,pending_count,report_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,report_date) DO UPDATE SET produced_count=excluded.produced_count,published_count=excluded.published_count,failed_count=excluded.failed_count,pending_count=excluded.pending_count,report_json=excluded.report_json,updated_at=excluded.updated_at")
    .bind(workspaceId,dayKey,report.produced,report.published,report.failed,report.pending,JSON.stringify(report),now,now).run();
  return report;
}


async function processAutopilot(env) {
  const bucket=env.SOURCE_MEDIA||env.MEDIA;
  if(!env.DB||!env.AI||!bucket)return;
  const settings=await env.DB.prepare("SELECT s.* FROM autopilot_settings s JOIN youtube_connections y ON y.workspace_id=s.workspace_id WHERE s.enabled=1 ORDER BY s.updated_at ASC LIMIT 1").first();
  if(!settings)return;
  const workspaceId=settings.workspace_id,dayKey=localDayKey(settings.timezone);
  await makeAutopilotReport(env,workspaceId,dayKey);
  let job=await env.DB.prepare("SELECT * FROM autopilot_jobs WHERE workspace_id=? AND status IN ('queued','generating','generating_scenes') ORDER BY created_at LIMIT 1").bind(workspaceId).first();
  if(!job) {
    const target=Math.min(5,Math.max(1,Number(settings.daily_target||3)));
    const totals=await env.DB.prepare("SELECT COUNT(*) AS attempts,SUM(CASE WHEN status IN ('render_queued','rendering','queued_publish','published') THEN 1 ELSE 0 END) AS produced FROM autopilot_jobs WHERE workspace_id=? AND day_key=?").bind(workspaceId,dayKey).first();
    if(Number(totals?.produced||0)>=target||Number(totals?.attempts||0)>=target*3)return;
    const blocked=await env.DB.prepare("SELECT COUNT(*) AS total FROM autopilot_jobs WHERE workspace_id=? AND status IN ('render_queued','rendering','queued_publish')").bind(workspaceId).first();
    if(Number(blocked?.total||0)>0)return;
    const now=new Date().toISOString(),id=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO autopilot_jobs (id,workspace_id,day_key,status,voice_language,subtitle_language,created_at,updated_at) VALUES (?,?,?,'queued','en','id',?,?)").bind(id,workspaceId,dayKey,now,now).run();
    job=await env.DB.prepare("SELECT * FROM autopilot_jobs WHERE id=?").bind(id).first();
  }
  try {
    if(job.status==="generating" && Date.now()-Date.parse(job.updated_at||"")>15*60*1000) {
      await env.DB.prepare("UPDATE autopilot_jobs SET status='failed',last_error='Generation timed out before a script and voice were saved.',updated_at=? WHERE id=? AND status='generating'")
        .bind(new Date().toISOString(),job.id).run();
      return;
    }
    if(job.status==="queued") {
      await env.DB.prepare("UPDATE autopilot_jobs SET status='generating',updated_at=? WHERE id=? AND status='queued'").bind(new Date().toISOString(),job.id).run();
      job=await env.DB.prepare("SELECT * FROM autopilot_jobs WHERE id=?").bind(job.id).first();
      await generateAutopilotScript(env,job,bucket);
      return;
    }
    if(job.status==="generating_scenes") {
      const scenes=JSON.parse(job.scenes_json||"[]"),next=scenes.find(scene=>!scene.image_key);
      if(!next) {
        await env.DB.prepare("UPDATE autopilot_jobs SET status='render_queued',updated_at=? WHERE id=? AND status='generating_scenes'").bind(new Date().toISOString(),job.id).run();
        return;
      }
      const flux=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{
        prompt:textSafe(next.visual_prompt,1800)+" — vertical 9:16 original documentary illustration, cinematic natural lighting, no text, no logos, no watermark.",
        steps:4,seed:Math.floor(Math.random()*2147483647)
      });
      if(!flux?.image)throw new Error("Image model returned no generated image.");
      const binary=Uint8Array.from(atob(flux.image),char=>char.charCodeAt(0));
      if(!binary.byteLength||binary.byteLength>12*1024*1024)throw new Error("Generated scene image is empty or too large.");
      const key="workspaces/"+workspaceId+"/autopilot/"+job.id+"/scene-"+next.scene+".jpg";
      await bucket.put(key,binary,{httpMetadata:{contentType:"image/jpeg"},customMetadata:{workspaceId,autopilotJobId:job.id,scene:String(next.scene)}});
      const updatedScenes=scenes.map(scene=>scene.scene===next.scene?{...scene,image_key:key}:scene);
      const done=updatedScenes.every(scene=>scene.image_key);
      await env.DB.prepare("UPDATE autopilot_jobs SET scenes_json=?,next_scene_number=?,status=?,updated_at=? WHERE id=? AND status='generating_scenes'")
        .bind(JSON.stringify(updatedScenes),done?5:next.scene+1,done?"render_queued":"generating_scenes",new Date().toISOString(),job.id).run();
      return;
    }
  } catch(error) {
    const message=String(error?.message||"Autopilot production failed.").slice(0,900);
    await env.DB.prepare("UPDATE autopilot_jobs SET status='failed',last_error=?,updated_at=? WHERE id=? AND status IN ('generating','generating_scenes','queued')")
      .bind(message,new Date().toISOString(),job.id).run();
    console.error("autopilot_generation_failed",job.id,message);
  }
}

async function processNextJob(env) {
  // Pages uses MEDIA while the standalone Worker may use SOURCE_MEDIA.
  const sourceBucket = env.SOURCE_MEDIA || env.MEDIA;
  if (!env.DB || !sourceBucket || !env.MEDIA_TRANSFORM || !env.AI) return;
  const job = await claimJob(env);
  if (!job) return;
  if (job.job_type === "discover_clips") {
    try {
      await processClipDiscovery(env, job);
    } catch (error) {
      const message = error?.message || "Clip discovery failed.";
      if (!await retryTransientJob(env, job, message)) {
        await failJob(env, job, null, message);
      }
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

    const object = await sourceBucket.get(source.storage_key);
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

    const withinBudget = await reserveAiBudget(env, `audio:${job.id}:${Number(job.attempts || 0)}:${chunkIndex}`, chunkDuration);
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
    const nextText = [cleanSpeechToken(priorText), cleanSpeechToken(result?.text || "")].filter(Boolean).join(" ").slice(0, 250000);
    let priorWords = [];
    try { priorWords = JSON.parse(current?.segments_json || "[]"); } catch { priorWords = []; }
    if (!Array.isArray(priorWords)) priorWords = [];
    const words = Array.isArray(result?.words) ? result.words.map(word => {
      const token = cleanSpeechToken(word?.word || word?.text || "");
      const localStart = Number(word?.start);
      const localEnd = Number(word?.end);
      if (!token || !Number.isFinite(localStart) || !Number.isFinite(localEnd) || localEnd <= localStart) return null;
      const start = Math.max(0, Math.min(chunkDuration, localStart)) + startSeconds;
      const end = Math.max(0, Math.min(chunkDuration, localEnd)) + startSeconds;
      return end > start ? { word: token, start, end } : null;
    }).filter(Boolean) : [];
    const orderedWords = priorWords.concat(words).filter(word =>
      word && typeof word.word === "string" && Number.isFinite(Number(word.start)) &&
      Number.isFinite(Number(word.end)) && Number(word.end) > Number(word.start)
    ).sort((a, b) => Number(a.start) - Number(b.start));
    const nextWords = orderedWords.filter((word, index, all) => {
      const previous = all[index - 1];
      return !previous || (
        String(previous.word).trim().toLowerCase() !== String(word.word).trim().toLowerCase() ||
        Math.abs(Number(previous.start) - Number(word.start)) > 0.025 ||
        Math.abs(Number(previous.end) - Number(word.end)) > 0.04
      );
    }).slice(0, 30000);
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
    const message = error?.message || "Unexpected analysis error.";
    if (!await retryTransientJob(env, job, message)) {
      await failJob(env, job, transcriptId, message);
    }
  }
}

async function loadWorkspaceWinnerPatterns(env, workspaceId) {
  try {
  const result = await env.DB.prepare(`
    SELECT c.title,c.hook,p.updated_at AS published_at,
      (SELECT m.views FROM youtube_video_metric_snapshots m WHERE m.publishing_job_id=p.id ORDER BY m.fetched_at DESC LIMIT 1) AS views,
      (SELECT a.average_view_percentage FROM youtube_video_analytics_snapshots a WHERE a.publishing_job_id=p.id ORDER BY a.fetched_at DESC LIMIT 1) AS average_view_percentage
    FROM publishing_jobs p JOIN clips c ON c.id=p.clip_id
    WHERE c.workspace_id=? AND p.platform='youtube' AND p.status='published'
      AND p.platform_video_id IS NOT NULL AND p.updated_at >= datetime('now','-90 days')
    ORDER BY p.updated_at DESC LIMIT 100
  `).bind(workspaceId).all();
  const measured=(result.results||[]).filter(row=>row.views!==null&&row.views!==undefined&&row.published_at);
  if(measured.length<3)return {patterns:[],confidence:0,sampleSize:measured.length};
  const scored=measured.map(row=>({...row,velocity:Number(row.views||0)/Math.max(1,(Date.now()-new Date(row.published_at).getTime())/86400000)}));
  const byVelocity=[...scored].sort((a,b)=>b.velocity-a.velocity);
  const retentionMeasured=scored.filter(row=>row.average_view_percentage!==null&&row.average_view_percentage!==undefined&&Number.isFinite(Number(row.average_view_percentage)));
  const retentionReady=retentionMeasured.length>=3;
  const byRetention=retentionReady?[...retentionMeasured].sort((a,b)=>Number(b.average_view_percentage)-Number(a.average_view_percentage)):[];
  const percentile=(ordered,row,key)=>{const index=ordered.findIndex(item=>item===row);return ordered.length<=1?1:1-index/(ordered.length-1);};
  for(const row of scored){
    const velocityRank=percentile(byVelocity,row,"velocity");
    const retentionRank=retentionReady&&row.average_view_percentage!==null&&row.average_view_percentage!==undefined?percentile(byRetention,row,"average_view_percentage"):velocityRank;
    row.winnerScore=retentionReady&&row.average_view_percentage!==null&&row.average_view_percentage!==undefined
      ? velocityRank*0.75+retentionRank*0.25
      : velocityRank;
  }
  const winners=scored.sort((a,b)=>b.winnerScore-a.winnerScore||b.velocity-a.velocity).slice(0,Math.max(1,Math.ceil(scored.length*0.3))).slice(0,5);
  return {patterns:winners.map(row=>({title:String(row.title||"").slice(0,120),hook:String(row.hook||"").slice(0,180),viewsPerDay:Math.round(row.velocity),averageViewed:row.average_view_percentage===null||row.average_view_percentage===undefined?null:Number(row.average_view_percentage)})),confidence:Math.min(1,measured.length/8),sampleSize:measured.length,retentionSampleSize:retentionMeasured.length};
  } catch (error) {
    // Keep discovery operational before the optional performance-snapshot migration is applied.
    console.warn("workspace_winner_learning_unavailable", error?.message || "unknown");
    return {patterns:[],confidence:0,sampleSize:0};
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
  const duration = Number(transcript.audio_duration_seconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Transcript duration is missing or invalid. Re-run source analysis before clip discovery.");
  }
  // Normalize transcript input once. Bad or unsorted word timestamps can otherwise
  // make nearest-word snapping select the wrong boundary or produce invalid clips.
  words = (Array.isArray(words) ? words : []).map(word => ({
    word: String(word?.word || "").replace(/\\s+/g, " ").trim(),
    start: Number(word?.start),
    end: Number(word?.end)
  })).filter(word =>
    word.word && Number.isFinite(word.start) && Number.isFinite(word.end) &&
    word.start >= 0 && word.end > word.start && word.start < duration &&
    word.end <= duration + 1
  ).sort((a, b) => a.start - b.start);
  if (words.length < 20) {
    throw new Error("Not enough valid timestamped speech was found to identify reliable clip boundaries.");
  }
  const source = await env.DB.prepare("SELECT title FROM source_videos WHERE id = ? AND workspace_id = ?").bind(job.source_video_id, job.workspace_id).first();
  const sourceTitle = String(source?.title || "");
  const winnerLearning = await loadWorkspaceWinnerPatterns(env, job.workspace_id);
  const winnerGuidance = winnerLearning.patterns.length
    ? " Workspace performance learning from this channel's published Shorts (a light creative hint, not a guarantee): " + winnerLearning.patterns.map((item,index)=>"#"+(index+1)+" title="+item.title+"; hook="+item.hook+"; approx views/day="+item.viewsPerDay+(item.averageViewed===null?"":"; average viewed="+Math.round(item.averageViewed)+"%")).join(" | ") + ". Look for similarly clear hooks and payoff structures only when they genuinely fit this source. Never copy titles or force unrelated topics."
    : "";
  const system = "You are an elite YouTube Shorts packaging editor focused on earning the right click from the exact audience for THIS clip. Find self-contained moments with a fast opening, clear context, and satisfying payoff. Never invent speech, events, character actions, facts, or timestamps. Write ALL metadata in the transcript language. Metadata rules are strict: (1) TITLE: write a punchy, natural 4–9-word title with one clear curiosity gap, specific subject/action, tension, surprise, contrast, or outcome when supported. Prefer concrete wording and active verbs; make viewers wonder what happens or why, but do not hide the subject behind vague bait. Avoid generic labels, filler reactions, ALL CAPS, excessive punctuation, fake stakes, and claims not proven by the clip. Do not add #Shorts to the title. (2) HOOK: use the strongest actual opening line from the selected moment, lightly cleaned only; never fabricate a teaser. (3) REASON: explain the specific story/payoff in one concise sentence. (4) CAPTION: write 2 short, conversational sentences that add context and tease the payoff without repeating the title or copying transcript verbatim. End with a natural, relevant question only when the moment invites discussion; do not force engagement bait. (5) HASHTAGS: choose 3–5 distinct, searchable topic/entity/niche tags grounded in what is actually said or shown. Mix broad niche + specific subject/entity where justified. No generic #viral, #fyp, #trending, #funny, #wow, or irrelevant tags. #shorts is optional and should be used at most once, preferably last. Never infer topics from the source filename alone. Optimize for relevance and viewer expectation, not keyword stuffing. Return valid compact JSON only." + winnerGuidance;
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
  for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
    const window = windows[windowIndex];
    const timeline = window.words.map(w => "[" + Number(w.start).toFixed(2) + "-" + Number(w.end).toFixed(2) + "] " + String(w.word || "")).join(" ");
    const prompt = "Find 1 to 3 strongest DISTINCT Shorts moments in this transcript window. Each clip must be 15–60 seconds, open with a real compelling line, include enough context to understand it, and end on a complete thought, reveal, joke, useful tip, or payoff. Prioritize surprising specifics, emotional turns, clear demonstrations, strong opinions, useful explanations, and memorable story beats. Reject greetings, filler, repeated content, weak setup-only sections, and incomplete sentences. Use ONLY supplied absolute word timestamps. For every candidate, write metadata in the transcript language: a punchy 4–9-word title with a clear curiosity gap and concrete subject/action; an authentic opening hook grounded in the first seconds; a one-sentence reason explaining the actual payoff; a conversational 2-sentence caption that adds context and optionally invites a genuine comment; and 3–5 searchable niche/entity hashtags grounded only in the transcript. Titles must make the right viewer curious without misleading them. No generic clickbait, keyword stuffing, #viral or #fyp. Do not infer topics from the filename and do not invent context. Return fewer candidates rather than padding weak moments. Rank strongest first. Return compact JSON only: {\"candidates\":[{\"startSeconds\":12.3,\"endSeconds\":42.8,\"title\":\"Specific subject and payoff\",\"hook\":\"Actual opening line\",\"reason\":\"Specific reason this moment pays off.\",\"caption\":\"Natural post caption with useful context.\",\"hashtags\":[\"#SpecificTopic\",\"#SpecificEntity\",\"#shorts\"],\"score\":91}]}. Full source duration: " + duration.toFixed(2) + " seconds. Search window: " + window.from.toFixed(2) + "–" + window.to.toFixed(2) + " seconds. Transcript language: " + (transcript.language || "auto-detected") + ". Timestamped transcript: " + timeline;
    const inputTokens = Math.ceil((system.length + prompt.length) / 3);
    if (!await reserveTextBudget(env, `discovery:${job.id}:${Number(job.attempts || 0)}:${windowIndex}`, inputTokens, 1100)) {
      throw new Error("Daily AI safety budget reached during clip discovery. Retry after the UTC reset.");
    }
    let result = await env.AI.run(CLIP_MODEL, {
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: 1100, temperature: 0.15, response_format: { type: "json_object" }
    });
    let parsed = parseClipSelectorResponse(result);
    if (!Array.isArray(parsed) || !parsed.length) {
      const retry = prompt + "\\nReturn only a valid compact JSON object with a candidates array. Keep every field short.";
      if (await reserveTextBudget(env, `discovery-repair:${job.id}:${Number(job.attempts || 0)}:${windowIndex}`, Math.ceil(retry.length / 3), 700)) {
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
    "SELECT start_seconds, end_seconds, transcript, title, hook FROM clips WHERE discovery_job_id = ?"
  ).bind(job.id).all();
  const existing = (existingResult.results || []).map(row => ({
    start: Number(row.start_seconds), end: Number(row.end_seconds),
    transcript: String(row.transcript || ""), title: String(row.title || ""), hook: String(row.hook || "")
  }));
  const accepted = [];
  const rejected = { invalidTime: 0, boundary: 0, tooShort: 0, tooLong: 0, outsideDuration: 0, overlap: 0, duplicateContent: 0, missingHook: 0, missingExcerpt: 0 };
  const contentTokens = value => new Set(String(value || "").toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]/gu, " ").split(/\\s+/)
    .filter(token => token.length >= 3 && !/^(the|and|that|this|with|from|then|when|what|where|which|have|will|your|you|are|was|were|for|but|not|can|just|like|they|them|their|there|into|about|because|jadi|yang|dan|atau|untuk|dari|dengan|ini|itu|kamu|aku|dia|ada|bisa|akan|kalau|karena|pada|dalam)$/i.test(token)));
  const contentSimilarity = (left, right) => {
    const a = contentTokens(left), b = contentTokens(right);
    if (a.size < 5 || b.size < 5) return 0;
    let common = 0;
    for (const token of a) if (b.has(token)) common++;
    return common / Math.min(a.size, b.size);
  };
  let expandedShortMoments = 0;
  const nearest = (value, field) => words.reduce((best, word) => {
    const current = Number(word[field]);
    return Math.abs(current - value) < Math.abs(Number(best[field]) - value) ? word : best;
  }, words[0]);

  const ranked = candidates.map(candidate => {
    const scoreValue = Number(candidate.score ?? candidate.aiScore ?? 0);
    const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, scoreValue)) : 0;
    const title = String(candidate.title || "").trim();
    const hook = String(candidate.hook || "").trim();
    const reason = String(candidate.reason || "").trim();
    const caption = String(candidate.caption || "").trim();
    const titleWords = title.split(/\\s+/).filter(Boolean).length;
    const genericTitle = /^(yes|yeah|yep|no|okay|ok|wow|whoa|oh|hey|look|wait|what|huh|hello|hi)[.!?\\s]*$/i.test(title);
    const normalizedHook = hook.toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, " ").replace(/\\s+/g, " ").trim();
    const normalizedTitle = title.toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, " ").replace(/\\s+/g, " ").trim();
    const payoffPattern = /\\b(reveal|reveals|revealed|secret|surprise|unexpected|finally|turns out|plot twist|the truth|lesson|mistake|because|until|ternyata|akhirnya|rahasia|kejutan|faktanya|justru|malah|alasannya|kesalahan|pelajaran|solusinya)\\b/i;
    const hookWords = hook.split(/\\s+/).filter(Boolean);
    const curiosityPattern = /\\b(why|how|what|never|secret|truth|mistake|nobody|everyone|until|before|after|instead|because|impossible|hidden|actually|turns out|ternyata|kenapa|mengapa|rahasia|fakta|kesalahan|ternyata|akhirnya|justru|malah|bagaimana)\\b/i;
    const specificityPattern = /\\b\\d+\\b|\\b(first|last|only|exactly|every|one|dua|tiga|pertama|terakhir|satu)\\b/i;
    const hookLengthQuality = hookWords.length >= 5 && hookWords.length <= 14 ? 1 :
      hookWords.length >= 3 && hookWords.length <= 18 ? 0.7 : 0.35;
    const hookQuality = !hook ? 0 : Math.min(1, hook.length / 65) * 0.25 +
      hookLengthQuality * 0.25 +
      (/[?!:]/.test(hook) ? 0.15 : 0) +
      (curiosityPattern.test(hook) ? 0.2 : 0) +
      (specificityPattern.test(hook) ? 0.1 : 0) +
      (normalizedHook && normalizedHook !== normalizedTitle ? 0.05 : 0);
    const contextQuality = !reason ? 0 : Math.min(1, reason.length / 110) * 0.7 +
      (/[.!?]/.test(reason) ? 0.15 : 0) +
      (payoffPattern.test(reason) ? 0.15 : 0);
    const titleQuality = genericTitle || titleWords < 3 ? 0.15 :
      titleWords >= 4 && titleWords <= 10 ? 1 :
      titleWords <= 13 ? 0.75 : 0.5;
    const captionQuality = !caption ? 0 : Math.min(1, caption.length / 120) * 0.65 +
      (/[.!?]/.test(caption) ? 0.15 : 0) +
      (caption.toLowerCase().includes(normalizedTitle) && normalizedTitle.length > 0 ? 0 : 0.2);
    const payoffQuality = payoffPattern.test([hook, reason, caption].join(" ")) ? 1 : 0.35;
    // Score the actual timestamped transcript too. This discourages clips that
    // look attractive in metadata but contain too little speech, excessive
    // repetition, or an abrupt ending with no complete thought.
    let transcriptQuality = 0.5;
    let retentionQuality = 0.5;
    let continuityQuality = 0.65;
    let durationFitQuality = 0.65;
    let specificityQuality = 0.5;
    let storyArcQuality = 0.45;
    const rawStart = Number(candidate.startSeconds ?? candidate.start_seconds);
    const rawEnd = Number(candidate.endSeconds ?? candidate.end_seconds);
    if (Number.isFinite(rawStart) && Number.isFinite(rawEnd) && rawEnd > rawStart) {
      const windowStart = Number(candidate.__windowStart || 0);
      const windowEnd = Number(candidate.__windowEnd || duration);
      const absoluteStart = windowStart > 0 && rawStart < windowStart - 3 && rawEnd <= (windowEnd - windowStart) + 3
        ? rawStart + windowStart : rawStart;
      const absoluteEnd = absoluteStart === rawStart ? rawEnd : rawEnd + windowStart;
      const spokenWords = words.filter(word => word.start >= absoluteStart && word.end <= absoluteEnd);
      const spokenText = spokenWords.map(word => word.word).join(" ").trim();
      const wordCount = spokenWords.length;
      const clipSeconds = absoluteEnd - absoluteStart;
      const wordsPerSecond = wordCount / Math.max(1, clipSeconds);
      // Penalize long dead-air gaps using actual word timestamps; a clip with
      // a strong transcript but several silent stretches is less likely to retain viewers.
      let silentGap = 0;
      for (let i = 1; i < spokenWords.length; i++) {
        silentGap += Math.max(0, Number(spokenWords[i].start) - Number(spokenWords[i - 1].end) - 0.35);
      }
      const gapRatio = silentGap / Math.max(1, clipSeconds);
      continuityQuality = gapRatio <= 0.04 ? 1 : gapRatio <= 0.10 ? 0.8 : gapRatio <= 0.18 ? 0.55 : 0.25;
      durationFitQuality = clipSeconds >= 24 && clipSeconds <= 42 ? 1 :
        clipSeconds >= 20 && clipSeconds <= 48 ? 0.82 :
        clipSeconds >= 15 && clipSeconds <= 55 ? 0.62 : 0.4;
      const concreteTerms = new Set((spokenWords.map(w => w.word).join(" ").match(/\\b[A-Z][\\p{L}\\p{N}_-]{2,}\\b|\\b\\d+(?:[.,]\\d+)?%?\\b/gu) || []).map(v => v.toLowerCase()));
      specificityQuality = Math.min(1, 0.35 + concreteTerms.size * 0.12);
      const storySignals = /\\b(but|however|because|so|then|until|instead|finally|turns out|which means|therefore|ternyata|tetapi|tapi|karena|sehingga|sampai|akhirnya|justru|malah|akibatnya|ternyata)\\b/i;
      const contrastSignals = /\\b(but|however|although|instead|surprisingly|unexpected|ternyata|tetapi|tapi|justru|malah|ternyata)\\b/i;
      const densityQuality = wordsPerSecond >= 1.2 && wordsPerSecond <= 4.5
        ? 1 : wordsPerSecond >= 0.7 && wordsPerSecond <= 5.5 ? 0.65 : 0.25;
      const normalizedWords = spokenWords.map(word => word.word.toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, "")).filter(Boolean);
      const uniqueRatio = normalizedWords.length
        ? new Set(normalizedWords).size / normalizedWords.length : 0;
      const repetitionQuality = uniqueRatio >= 0.48 ? 1 : uniqueRatio >= 0.32 ? 0.65 : 0.3;
      const firstWords = spokenWords.slice(0, 12).map(word => word.word).join(" ");
      const lastWords = spokenWords.slice(-12).map(word => word.word).join(" ");
      const openingWords = spokenWords.filter(word => Number(word.start) < absoluteStart + 3);
      const openingRate = openingWords.length / 3;
      const hasOpeningSignal = /[?!:]|\\b(why|how|what|never|because|secret|watch|look|imagine|wait|but|suddenly|ternyata|kenapa|bagaimana|mengapa|rahasia|lihat|bayangkan|tiba-tiba)\\b/i.test(firstWords);
      const hasClosingSignal = /[.!?…]["')\\]]?\\s*$/.test(lastWords) ||
        /\\b(so|therefore|that's why|in the end|finally|turns out|which means|jadi|makanya|akhirnya|ternyata|kesimpulannya)\\b/i.test(lastWords);
      storyArcQuality = (storySignals.test(spokenText) ? 0.55 : 0.3) + (contrastSignals.test(spokenText) ? 0.25 : 0) + (hasClosingSignal ? 0.2 : 0);
      const openingQuality = hasOpeningSignal ? 1 : 0.55;
      const closingQuality = hasClosingSignal ? 1 : 0.4;
      const lengthQuality = wordCount >= 28 ? 1 : wordCount >= 18 ? 0.7 : 0.3;
      const openingPaceQuality = openingRate >= 1.0 && openingRate <= 5 ? 1 :
        openingRate >= 0.5 && openingRate <= 6 ? 0.65 : 0.3;
      const completionQuality = hasClosingSignal ? 1 : 0.4;
      retentionQuality = openingPaceQuality * 0.35 + densityQuality * 0.25 +
        repetitionQuality * 0.15 + completionQuality * 0.25;
      transcriptQuality = densityQuality * 0.20 + repetitionQuality * 0.15 +
        openingQuality * 0.20 + closingQuality * 0.20 + lengthQuality * 0.10 +
        openingPaceQuality * 0.15;
    }
    // Explainable editorial score: metadata cannot outweigh the actual spoken
    // moment. The strongest signals are the opening, story payoff, pacing and completion.
    const metadataQuality = titleQuality * 0.45 + captionQuality * 0.35 + contextQuality * 0.20;
    const qualityScore = 100 * (
      hookQuality * 0.18 +
      retentionQuality * 0.14 +
      storyArcQuality * 0.14 +
      continuityQuality * 0.10 +
      durationFitQuality * 0.08 +
      specificityQuality * 0.08 +
      transcriptQuality * 0.12 +
      payoffQuality * 0.10 +
      metadataQuality * 0.06
    );
    // Keep the model's score as the persisted AI score, but rank with a blended
    // score so transcript substance and a self-contained ending influence selection.
    const candidateTokens = new Set([title,hook,reason].join(" ").toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu," ").split(/\\s+/).filter(token=>token.length>=3));
    let winnerSimilarity = 0;
    if (winnerLearning.confidence > 0 && candidateTokens.size >= 3) {
      for (const winner of winnerLearning.patterns) {
        const winnerTokens = new Set([winner.title,winner.hook].join(" ").toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu," ").split(/\\s+/).filter(token=>token.length>=3));
        if (winnerTokens.size < 3) continue;
        let overlap = 0;
        for (const token of candidateTokens) if (winnerTokens.has(token)) overlap++;
        winnerSimilarity = Math.max(winnerSimilarity,overlap/Math.min(candidateTokens.size,winnerTokens.size));
      }
    }
    const learningBonus = Math.round(winnerSimilarity * 5 * winnerLearning.confidence * 10) / 10;
    // Blend the model's initial opinion with transcript-derived editorial signals.
    // Channel history is only a small tie-breaker, never a promise of virality.
    const rankScore = score * 0.25 + qualityScore * 0.75 + Math.min(2.5, learningBonus);
    const scoreBreakdown = {
      hook: Math.round(hookQuality * 100),
      retention: Math.round(retentionQuality * 100),
      storyArc: Math.round(storyArcQuality * 100),
      continuity: Math.round(continuityQuality * 100),
      durationFit: Math.round(durationFitQuality * 100),
      specificity: Math.round(specificityQuality * 100),
      transcript: Math.round(transcriptQuality * 100),
      payoff: Math.round(payoffQuality * 100),
      metadata: Math.round(metadataQuality * 100),
      channelLearning: Math.round(Math.min(100, learningBonus / 2.5 * 100)),
      learningBonus: Math.round(learningBonus * 10) / 10,
      learningConfidence: Math.round(winnerLearning.confidence * 100),
      learningSampleSize: winnerLearning.sampleSize,
      retentionSampleSize: winnerLearning.retentionSampleSize || 0
    };
    return { candidate, score, qualityScore: Math.round(qualityScore), scoreBreakdown,
      transcriptQuality: Math.round(transcriptQuality * 100),
      retentionQuality: Math.round(retentionQuality * 100),
      continuityQuality: Math.round(continuityQuality * 100),
      durationFitQuality: Math.round(durationFitQuality * 100),
      storyArcQuality: Math.round(storyArcQuality * 100),
      learningBonus, rankScore: Math.max(0, Math.min(100, Math.round(rankScore))) };
  }).sort((a,b) => b.rankScore - a.rankScore || b.score - a.score);

  for (const item of ranked) {
    if (accepted.length + existing.length >= 15) break;
    const candidate = item.candidate;
    let rawStart = Number(candidate.startSeconds ?? candidate.start_seconds);
    let rawEnd = Number(candidate.endSeconds ?? candidate.end_seconds);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) { rejected.invalidTime++; continue; }
    const windowStart = Number(candidate.__windowStart || 0);
    const windowEnd = Number(candidate.__windowEnd || duration);
    // Some model responses return timestamps relative to their supplied window.
    // Convert those to the source timeline before validating against transcript words.
    if (windowStart > 0 && rawStart < windowStart - 3 && rawEnd <= (windowEnd - windowStart) + 3) {
      rawStart += windowStart;
      rawEnd += windowStart;
    }
    // Reject hallucinated timestamps outside the exact transcript window instead of
    // silently snapping them to a distant word elsewhere in the source.
    if (rawStart < windowStart - 2 || rawEnd > windowEnd + 2 || rawEnd - rawStart > 75) {
      rejected.boundary++;
      continue;
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
    if (clipDuration < 15) { rejected.tooShort++; continue; }
    if (clipDuration > 60) { rejected.tooLong++; continue; }
    const excerpt = words.filter(word => Number(word.start) >= start && Number(word.end) <= end).map(word => String(word.word || "")).join(" ").trim();
    if (!excerpt) { rejected.missingExcerpt++; continue; }
    const priorCandidates = [...existing, ...accepted];
    const overlaps = priorCandidates.some(other => {
      const otherDuration = Math.max(1, other.end - other.start);
      const overlap = Math.max(0, Math.min(end, other.end) - Math.max(start, other.start));
      const overlapRatio = overlap / Math.min(clipDuration, otherDuration);
      const nearSameMoment = Math.abs(start - other.start) <= 8 && Math.abs(end - other.end) <= 12;
      return overlapRatio > 0.3 || nearSameMoment;
    });
    if (overlaps) { rejected.overlap++; continue; }
    const duplicateContent = priorCandidates.some(other => {
      const otherText = [other.transcript, other.title, other.hook].filter(Boolean).join(" ");
      return contentSimilarity(excerpt, otherText) >= 0.72;
    });
    if (duplicateContent) { rejected.duplicateContent++; continue; }

    const hook = String(candidate.hook || excerpt.split(/(?<=[.!?])\\s+/)[0] || excerpt.split(/\\s+/).slice(0, 14).join(" ")).trim().slice(0, 220);
    if (!hook) { rejected.missingHook++; continue; }
    const proposedTitle = String(candidate.title || "").trim();
    const genericTitle = /^(yes|yeah|yep|no|okay|ok|wow|whoa|oh|hey|look|wait|what|huh|hello|hi)[.!?\s]*$/i.test(proposedTitle);
    const title = String(genericTitle ? (candidate.reason || excerpt.split(/[.!?]/)[0] || candidate.hook) : (proposedTitle || candidate.reason || excerpt.split(/[.!?]/)[0] || "Untitled clip")).trim().slice(0, 120);
    let hashtagList = Array.isArray(candidate.hashtags) ? candidate.hashtags : String(candidate.hashtags || "").split(/\\s+/);
    hashtagList = hashtagList.map(tag => String(tag).trim().replace(/^#?/, "#").replace(/[^#\\p{L}\\p{N}_]/gu, ""))
      .filter(tag => tag.length > 2 && !/^#(topic|viral|fyp|shorts|trending|funny|wow)$/i.test(tag));
    if (hashtagList.length < 3) {
      // Derive fallback tags from the selected transcript, not just the uploaded
      // filename, which is often generic or unrelated to the clip itself.
      const stop = new Set("the and for that with this from have your you are was were what when where who why how then than into about there their they them his her she him its our out but not can could would should just like really very will all one two three a an to of in on at as is it be or if we i me my he do did does so up down".split(" "));
      const counts = new Map();
      for (const token of excerpt.toLowerCase().match(/[\\p{L}\\p{N}]{4,}/gu) || []) {
        if (stop.has(token) || /^\\d+$/.test(token)) continue;
        counts.set(token, (counts.get(token) || 0) + 1);
      }
      const derived = [...counts.entries()].sort((a,b) => b[1]-a[1] || b[0].length-a[0].length)
        .slice(0, 5).map(([word]) => "#" + word);
      hashtagList = [...new Set([...hashtagList, ...derived])];
    }
    if (hashtagList.length < 3 && !hashtagList.includes("#shorts")) hashtagList.push("#shorts");
    const hashtags = [...new Set(hashtagList)].slice(0, 6).join(" ");
    let caption = String(candidate.caption || "").trim();
    const genericCaption = !caption || caption.length < 35 || caption.toLowerCase() === title.toLowerCase() || /^(whoa|wow|yes|yeah|okay|ok|oh)[.!?\s]*$/i.test(caption);
    if (genericCaption) caption = String(candidate.reason || hook || excerpt).trim();
    if (caption.length < 35) caption = "A memorable moment from " + (sourceTitle || "this video") + ": " + caption;
    caption = caption.slice(0, 2000);
    const clipId = crypto.randomUUID();
    const metadataId = crypto.randomUUID();
    const now = new Date().toISOString();
    accepted.push({ start, end, score: item.rankScore, transcript: excerpt, title, hook });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO clips
         (id, workspace_id, source_video_id, title, start_seconds, end_seconds, hook, ai_score, transcript, score_breakdown_json, status, discovery_job_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?, ?)`
      ).bind(clipId, job.workspace_id, job.source_video_id, title, start, end, hook, item.rankScore, excerpt, JSON.stringify(item.scoreBreakdown), job.id, now, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO clip_metadata (id, clip_id, version, title, caption, hashtags, language, created_at)
         SELECT ?, c.id, 1, ?, ?, ?, ?, ?
         FROM clips c
         WHERE c.discovery_job_id = ? AND c.start_seconds = ? AND c.end_seconds = ?
         AND NOT EXISTS (SELECT 1 FROM clip_metadata m WHERE m.clip_id = c.id AND m.version = 1)`
      ).bind(metadataId, title, caption, hashtags, transcript.language || null, now, job.id, start, end)
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


async function processBrowserAudioChunk(request, env) {
  if (!env.DB || !env.AI || !env.YOUTUBE_TOKEN_ENCRYPTION_KEY) return json({ok:false,error:"Browser transcription service is not configured."},503);
  const supplied=request.headers.get("X-ShortsFlow-Internal")||"";
  const key=await crypto.subtle.importKey("raw",decodeBase64(env.YOUTUBE_TOKEN_ENCRYPTION_KEY),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode("shortsflow-browser-transcription-ingest-v1"));
  const expected=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,"0")).join("");
  const a=new TextEncoder().encode(supplied),b=new TextEncoder().encode(expected);
  if(a.length!==b.length)return json({ok:false,error:"Unauthorized."},401);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)return json({ok:false,error:"Unauthorized."},401);
  const sourceId=request.headers.get("X-Source-Id")||"",workspaceId=request.headers.get("X-Workspace-Id")||"";
  const chunkIndex=Number(request.headers.get("X-Chunk-Index")),totalChunks=Number(request.headers.get("X-Total-Chunks")),duration=Number(request.headers.get("X-Source-Duration"));
  const transcriptId=request.headers.get("X-Transcript-Id")||"";
  if(!/^[0-9a-f-]{36}$/i.test(sourceId)||!workspaceId||!Number.isInteger(chunkIndex)||chunkIndex<0||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>30||chunkIndex>=totalChunks||!Number.isFinite(duration)||duration<=0||duration>1800)return json({ok:false,error:"Invalid transcription chunk details."},400);
  const source=await env.DB.prepare("SELECT id,duration_seconds,size_bytes FROM source_videos WHERE id=? AND workspace_id=?").bind(sourceId,workspaceId).first();
  if(!source)return json({ok:false,error:"Source video was not found in this workspace."},404);
  if(Number(source.duration_seconds||0)>1800||Number(source.size_bytes||0)>200*1024*1024)return json({ok:false,error:"Source exceeds the 30-minute or 200 MB analysis limit."},413);
  const audio=new Uint8Array(await request.arrayBuffer());
  if(audio.byteLength<128||audio.byteLength>8*1024*1024)return json({ok:false,error:"Audio chunk is empty or exceeds the 8 MB chunk limit."},413);
  let transcript;
  if(chunkIndex===0){
    const latest=await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM source_transcripts WHERE source_video_id=?").bind(sourceId).first();
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.prepare("INSERT INTO source_transcripts (id,workspace_id,source_video_id,version,status,model,transcript_text,segments_json,created_at,updated_at) VALUES (?,?,?,?,'processing',?,'','[]',?,?)").bind(id,workspaceId,sourceId,Number(latest?.version||0)+1,MODEL,now,now).run();
    transcript={id};
  } else {
    transcript=await env.DB.prepare("SELECT id FROM source_transcripts WHERE id=? AND workspace_id=? AND source_video_id=? AND status='processing'").bind(transcriptId,workspaceId,sourceId).first();
    if(!transcript)return json({ok:false,error:"Transcription session expired. Start analysis again."},409);
  }
  const withinBudget=await reserveAiBudget(env,`browser-audio:${transcript.id}:${chunkIndex}`,Math.min(60,Math.max(1,duration-chunkIndex*60)));
  if(!withinBudget)return json({ok:false,error:"Daily AI safety budget reached. Retry after the UTC reset."},429);
  const result=await env.AI.run(MODEL,{audio:Array.from(audio)});
  const current=await env.DB.prepare("SELECT transcript_text,segments_json FROM source_transcripts WHERE id=? AND workspace_id=?").bind(transcript.id,workspaceId).first();
   const offset=chunkIndex*60,nextText=[cleanSpeechToken(current?.transcript_text||""),cleanSpeechToken(result?.text||"")].filter(Boolean).join(" ").slice(0,250000);
  let prior=[];try{prior=JSON.parse(current?.segments_json||"[]");}catch{}
  const words=Array.isArray(result?.words)?result.words.map(w=>({word:cleanSpeechToken(w.word||w.text||""),start:Number(w.start||0)+offset,end:Number(w.end||w.start||0)+offset})).filter(w=>w.word&&Number.isFinite(w.start)&&Number.isFinite(w.end)):[];
  const combined=prior.concat(words).slice(0,30000),now=new Date().toISOString();
  await env.DB.prepare("UPDATE source_transcripts SET transcript_text=?,segments_json=?,language=COALESCE(?,language),updated_at=? WHERE id=? AND workspace_id=?").bind(nextText,JSON.stringify(combined),String(result?.transcription_info?.language||result?.language||"")||null,now,transcript.id,workspaceId).run();
  if(chunkIndex===totalChunks-1){
    if(combined.length<1)return json({ok:false,error:"No timestamped speech was detected in this video."},422);
    const now2=new Date().toISOString(),discoveryJobId=crypto.randomUUID(),key="discover_clips:"+workspaceId+":"+sourceId+":"+transcript.id;
    await env.DB.batch([
      env.DB.prepare("UPDATE source_transcripts SET status='completed',audio_duration_seconds=?,updated_at=? WHERE id=? AND workspace_id=?").bind(duration,now2,transcript.id,workspaceId),
      env.DB.prepare("UPDATE source_videos SET status='ready',error_message=NULL,updated_at=? WHERE id=? AND workspace_id=?").bind(now2,sourceId,workspaceId),
      env.DB.prepare("INSERT OR IGNORE INTO processing_jobs (id,workspace_id,source_video_id,job_type,status,idempotency_key,payload_json,created_at,updated_at) VALUES (?,?,?,'discover_clips','queued',?,?,?,?)").bind(discoveryJobId,workspaceId,sourceId,key,JSON.stringify({transcriptId:transcript.id,pipelineVersion:2}),now2,now2),
      env.DB.prepare("INSERT INTO activity_logs (id,workspace_id,entity_type,entity_id,event,details,created_at) VALUES (?,?,'source_video',?,'source.transcribed',?,?)").bind(crypto.randomUUID(),workspaceId,sourceId,JSON.stringify({transcriptId:transcript.id,model:MODEL,pipeline:"browser-ffmpeg"}),now2)
    ]);
    return json({ok:true,transcriptId:transcript.id,completed:true,words:combined.length});
  }
  return json({ok:true,transcriptId:transcript.id,completed:false,words:combined.length});
}


const RENDER_REPOSITORY="joshdrn18/shortsflow-studio";
const RENDER_WORKFLOW="joshdrn18/shortsflow-studio/.github/workflows/background-render.yml@refs/heads/main";
let githubJwksCache=null,githubJwksFetchedAt=0;
function decodeJwtPart(value){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4)),c=>c.charCodeAt(0))));}
async function verifyRenderRunner(request){
 const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return null;
 try{
  const parts=token.split(".");if(parts.length!==3)return null;
  const header=decodeJwtPart(parts[0]),claims=decodeJwtPart(parts[1]);
  if(header.alg!=="RS256"||!header.kid||claims.iss!=="https://token.actions.githubusercontent.com")return null;
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!audiences.includes("shortsflow-render")||claims.repository!==RENDER_REPOSITORY||claims.ref!=="refs/heads/main"||claims.workflow_ref!==RENDER_WORKFLOW)return null;
  const now=Math.floor(Date.now()/1000);if(Number(claims.exp)<now||Number(claims.nbf||0)>now+30)return null;
  if(!githubJwksCache||Date.now()-githubJwksFetchedAt>3600000){
   const response=await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");if(!response.ok)return null;
   githubJwksCache=await response.json();githubJwksFetchedAt=Date.now();
  }
  const jwk=githubJwksCache.keys?.find(key=>key.kid===header.kid);if(!jwk)return null;
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,Uint8Array.from(atob(parts[2].replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-parts[2].length%4)%4)),c=>c.charCodeAt(0)),new TextEncoder().encode(parts[0]+"."+parts[1]));
  return valid?{runnerId:String(claims.run_id||claims.jti||"runner")}:null;
 }catch(error){console.error("render_runner_oidc_failed",String(error));return null;}
}
async function handleBackgroundRender(request,env,url){
 const runner=await verifyRenderRunner(request);if(!runner)return json({ok:false,error:"Unauthorized render runner."},401);
 const bucket=env.SOURCE_MEDIA||env.MEDIA;
 if(!env.DB||!bucket)return json({ok:false,error:"Render database or R2 binding is missing."},503);
 const route=url.pathname;
 if(request.method==="POST"&&route==="/internal/render/claim"){
  const now=new Date(),iso=now.toISOString(),lockUntil=new Date(now.getTime()+45*60*1000).toISOString();
  await env.DB.prepare("UPDATE clip_render_jobs SET status='cancelled',last_error='Clip settings changed before the background render started.',updated_at=? WHERE status='queued' AND EXISTS(SELECT 1 FROM clip_metadata m WHERE m.clip_id=clip_render_jobs.clip_id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clip_render_jobs.clip_id) AND m.version<>clip_render_jobs.metadata_version)").bind(iso).run();
  const claimed=await env.DB.prepare(`UPDATE clip_render_jobs SET status='running',runner_id=?,locked_until=?,attempts=attempts+1,updated_at=?
   WHERE id=(SELECT j.id FROM clip_render_jobs j WHERE j.status IN ('queued','running') AND (j.locked_until IS NULL OR j.locked_until<?)
    AND j.attempts<3 AND EXISTS(SELECT 1 FROM clips c JOIN clip_metadata m ON m.clip_id=c.id AND m.version=j.metadata_version AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id) WHERE c.id=j.clip_id)
    ORDER BY j.created_at LIMIT 1)
   AND (status='queued' OR locked_until IS NULL OR locked_until<?) RETURNING *`).bind(runner.runnerId,lockUntil,iso,iso,iso).first();
  if(!claimed)return json({ok:true,job:null});
  const data=await env.DB.prepare(`SELECT j.id,j.workspace_id,j.clip_id,j.source_video_id,j.metadata_version,
    c.start_seconds,c.end_seconds,s.storage_key AS source_key,s.mime_type AS source_mime,s.size_bytes AS source_size,
    m.title,m.caption,m.hashtags,m.language,m.subtitle_config_json,
    t.segments_json,t.language AS transcript_language,
    ws.watermark_enabled,ws.watermark_text,ws.watermark_position,ws.watermark_opacity,ws.watermark_scale
   FROM clip_render_jobs j JOIN clips c ON c.id=j.clip_id JOIN source_videos s ON s.id=j.source_video_id
   JOIN clip_metadata m ON m.clip_id=c.id AND m.version=j.metadata_version
   LEFT JOIN source_transcripts t ON t.source_video_id=j.source_video_id AND t.workspace_id=j.workspace_id
    AND t.version=(SELECT MAX(t2.version) FROM source_transcripts t2 WHERE t2.source_video_id=t.source_video_id)
   LEFT JOIN workspace_settings ws ON ws.workspace_id=j.workspace_id
   WHERE j.id=? AND j.runner_id=? AND j.status='running'`).bind(claimed.id,runner.runnerId).first();
  if(!data||!data.source_key){await env.DB.batch([
   env.DB.prepare("UPDATE clip_render_jobs SET status='failed',last_error='Private source video is missing.',runner_id=NULL,locked_until=NULL,updated_at=? WHERE id=? AND runner_id=?").bind(iso,claimed.id,runner.runnerId),
   env.DB.prepare("UPDATE clips SET status='editing',updated_at=? WHERE id=? AND workspace_id=? AND status='rendering'").bind(iso,claimed.clip_id,claimed.workspace_id)
  ]);return json({ok:false,error:"Source video is missing."},404);}
  let words=[];try{words=JSON.parse(data.segments_json||"[]");}catch{}
  words=(Array.isArray(words)?words:[]).filter(w=>w&&typeof w.word==="string"&&Number.isFinite(Number(w.start))&&Number.isFinite(Number(w.end))&&Number(w.end)>Number(data.start_seconds)&&Number(w.start)<Number(data.end_seconds)).slice(0,10000).map(w=>({word:cleanSpeechToken(w.word),start:Math.max(0,Number(w.start)-Number(data.start_seconds)),end:Math.max(0,Number(w.end)-Number(data.start_seconds))}));
  let config={};try{config=JSON.parse(data.subtitle_config_json||"{}");}catch{}
  return json({ok:true,job:{id:data.id,workspaceId:data.workspace_id,clipId:data.clip_id,sourceId:data.source_video_id,metadataVersion:Number(data.metadata_version),sourceKey:data.source_key,sourceMime:data.source_mime,sourceSize:Number(data.source_size||0),startSeconds:Number(data.start_seconds),endSeconds:Number(data.end_seconds),title:data.title||"",caption:data.caption||"",hashtags:data.hashtags||"",language:data.language||"",words,subtitleConfig:config,watermark:{watermarkEnabled:data.watermark_enabled===null?true:Boolean(data.watermark_enabled),watermarkText:data.watermark_text||"YOUR BRAND",watermarkPosition:data.watermark_position||"bottom-right",watermarkOpacity:Number(data.watermark_opacity??0.72),watermarkScale:data.watermark_scale||"medium"}}});
 }
 const jobId=url.searchParams.get("jobId")||"";
 if(!/^[0-9a-f-]{36}$/i.test(jobId))return json({ok:false,error:"Invalid render job ID."},400);
 const job=await env.DB.prepare("SELECT * FROM clip_render_jobs WHERE id=? AND status='running' AND runner_id=?").bind(jobId,runner.runnerId).first();
 if(!job)return json({ok:false,error:"Render job is no longer owned by this runner."},409);
 if(request.method==="GET"&&route==="/internal/render/source"){
  const row=await env.DB.prepare("SELECT storage_key FROM source_videos WHERE id=? AND workspace_id=?").bind(job.source_video_id,job.workspace_id).first();
  const object=row?.storage_key?await bucket.get(row.storage_key):null;if(!object)return json({ok:false,error:"Source video is missing from R2."},404);
  return new Response(object.body,{headers:{"Content-Type":object.httpMetadata?.contentType||"application/octet-stream","Content-Length":String(object.size),"Cache-Control":"no-store"}});
 }
 if(request.method==="POST"&&route==="/internal/render/complete"){
  const type=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  const size=Number(request.headers.get("Content-Length")||0);
  if(type!=="video/mp4"||!Number.isSafeInteger(size)||size<1024||size>90*1024*1024||!request.body)return json({ok:false,error:"Render must be a valid MP4 between 1 KB and 90 MB."},413);
  const latest=await env.DB.prepare("SELECT MAX(version) AS version FROM clip_metadata WHERE clip_id=?").bind(job.clip_id).first();
  if(Number(latest?.version)!==Number(job.metadata_version))return json({ok:false,error:"Clip metadata changed. Queue a new render."},409);
  const assetId=crypto.randomUUID(),key=`workspaces/${job.workspace_id}/clips/${job.clip_id}/renders/${assetId}.mp4`,now=new Date().toISOString();
  await bucket.put(key,request.body,{httpMetadata:{contentType:"video/mp4"},customMetadata:{workspaceId:job.workspace_id,clipId:job.clip_id,metadataVersion:String(job.metadata_version),assetId,renderJobId:job.id}});
  const stored=await bucket.head(key);if(!stored||Number(stored.size)!==size){await bucket.delete(key);return json({ok:false,error:"R2 background render verification failed."},500);}
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO clip_assets(id,clip_id,asset_type,storage_key,mime_type,size_bytes,version,metadata_version,created_at)
    SELECT ?,?,'render',?,'video/mp4',?,(SELECT COALESCE(MAX(version),0)+1 FROM clip_assets WHERE clip_id=? AND asset_type='render'),?,?
    WHERE (SELECT MAX(version) FROM clip_metadata WHERE clip_id=?)=?`).bind(assetId,job.clip_id,key,size,job.clip_id,job.metadata_version,now,job.clip_id,job.metadata_version),
   env.DB.prepare("UPDATE clip_render_jobs SET status='completed',asset_id=?,last_error=NULL,locked_until=NULL,runner_id=NULL,completed_at=?,updated_at=? WHERE id=? AND status='running' AND runner_id=? AND EXISTS(SELECT 1 FROM clip_assets WHERE id=?)").bind(assetId,now,now,job.id,runner.runnerId,assetId),
   env.DB.prepare("UPDATE clips SET status='rendered',updated_at=? WHERE id=? AND workspace_id=? AND (SELECT MAX(version) FROM clip_metadata WHERE clip_id=?)=? AND EXISTS(SELECT 1 FROM clip_assets WHERE id=?)").bind(now,job.clip_id,job.workspace_id,job.clip_id,job.metadata_version,assetId),
   env.DB.prepare("INSERT INTO activity_logs(id,workspace_id,entity_type,entity_id,event,details,created_at) VALUES(?,?, 'clip',?,'clip_rendered',?,?)").bind(crypto.randomUUID(),job.workspace_id,job.clip_id,JSON.stringify({jobId:job.id,assetId,metadataVersion:Number(job.metadata_version),sizeBytes:size,format:"mp4",engine:"background-ffmpeg"}),now)
  ]);
  if(Number(result[0]?.meta?.changes||0)!==1){
   await bucket.delete(key);
   await env.DB.prepare("UPDATE clip_render_jobs SET status='failed',last_error='Clip metadata changed before the render could be saved.',runner_id=NULL,locked_until=NULL,updated_at=? WHERE id=? AND status='running' AND runner_id=?").bind(now,job.id,runner.runnerId).run();
   return json({ok:false,error:"Clip changed while saving the background render."},409);
  }
  return json({ok:true,assetId,sizeBytes:size,mimeType:"video/mp4"});
 }
 if(request.method==="POST"&&route==="/internal/render/fail"){
  const body=await request.json().catch(()=>({})),message=String(body.error||"Background rendering failed.").slice(0,1000),now=new Date().toISOString();
  const retry=Number(job.attempts||0)<3;
  const retryAt=retry?new Date(Date.now()+2*60*1000).toISOString():null;
  await env.DB.batch([
   env.DB.prepare("UPDATE clip_render_jobs SET status=?,last_error=?,locked_until=?,runner_id=NULL,updated_at=? WHERE id=? AND status='running' AND runner_id=?").bind(retry?"queued":"failed",message,retryAt,now,job.id,runner.runnerId),
   env.DB.prepare("UPDATE clips SET status=?,updated_at=? WHERE id=? AND workspace_id=? AND status='rendering'").bind(retry?"rendering":"editing",now,job.clip_id,job.workspace_id)
  ]);
  return json({ok:true,retryScheduled:retry,attempts:Number(job.attempts||0),maxAttempts:3});
 }
 return json({ok:false,error:"Not found."},404);
}


async function handleAutopilotRender(request,env,url){
 const runner=await verifyRenderRunner(request);
 if(!runner)return json({ok:false,error:"Unauthorized autopilot render runner."},401);
 const bucket=env.SOURCE_MEDIA||env.MEDIA;
 if(!env.DB||!bucket)return json({ok:false,error:"Autopilot database or R2 binding is missing."},503);
 const route=url.pathname;
 if(request.method==="POST"&&route==="/internal/autopilot/claim"){
  const now=new Date(),iso=now.toISOString(),lockUntil=new Date(now.getTime()+60*60*1000).toISOString();
  const claimed=await env.DB.prepare("UPDATE autopilot_jobs SET status='rendering',runner_id=?,locked_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM autopilot_jobs WHERE status='render_queued' AND (locked_until IS NULL OR locked_until<?) AND attempts<3 ORDER BY created_at LIMIT 1) AND status='render_queued' AND (locked_until IS NULL OR locked_until<?) RETURNING *")
   .bind(runner.runnerId,lockUntil,iso,iso,iso).first();
  if(!claimed)return json({ok:true,job:null});
  const settings=await env.DB.prepare("SELECT s.watermark_enabled,s.watermark_text,ws.watermark_enabled AS workspace_watermark_enabled,ws.watermark_text AS workspace_watermark_text,ws.watermark_position,ws.watermark_opacity,ws.watermark_scale FROM autopilot_settings s LEFT JOIN workspace_settings ws ON ws.workspace_id=s.workspace_id WHERE s.workspace_id=?").bind(claimed.workspace_id).first();
  const script=parsePayload(claimed.script_json),scenes=parsePayload(claimed.scenes_json);
  if(!Array.isArray(scenes)||scenes.length!==4||scenes.some(scene=>!scene.image_key)){
   await env.DB.prepare("UPDATE autopilot_jobs SET status='failed',runner_id=NULL,locked_until=NULL,last_error='Scene image set is incomplete.',updated_at=? WHERE id=? AND runner_id=?").bind(iso,claimed.id,runner.runnerId).run();
   return json({ok:false,error:"Autopilot scene image set is incomplete."},409);
  }
  return json({ok:true,job:{
   id:claimed.id,workspaceId:claimed.workspace_id,runnerId:runner.runnerId,title:claimed.title,topic:claimed.topic,
   narration:claimed.narration,voiceLanguage:claimed.voice_language,subtitleLanguage:claimed.subtitle_language,
   audioKey:claimed.audio_key,scenes:scenes.map(scene=>({scene:Number(scene.scene),imageKey:scene.image_key,narration:scene.narration,subtitle:scene.subtitle_indonesian})),
   durationSeconds:Number(claimed.duration_seconds||45),
   watermark:{
    enabled:settings?.workspace_watermark_enabled===null?settings?.watermark_enabled!==0:Boolean(settings?.workspace_watermark_enabled??settings?.watermark_enabled??1),
    text:String(settings?.workspace_watermark_text||settings?.watermark_text||"@Clippers2K26"),
    position:String(settings?.watermark_position||"center"),
    opacity:Number(settings?.watermark_opacity??0.72),scale:String(settings?.watermark_scale||"medium")
   }
  }});
 }
 const jobId=url.searchParams.get("jobId")||"";
 if(!/^[0-9a-f-]{36}$/i.test(jobId))return json({ok:false,error:"Invalid autopilot job ID."},400);
 const job=await env.DB.prepare("SELECT * FROM autopilot_jobs WHERE id=? AND status='rendering' AND runner_id=?").bind(jobId,runner.runnerId).first();
 if(!job)return json({ok:false,error:"Autopilot job is no longer owned by this runner."},409);
 if(request.method==="GET"&&route==="/internal/autopilot/asset"){
  const kind=url.searchParams.get("kind")||"",sceneNumber=Number(url.searchParams.get("scene")||0);
  let key="";
  if(kind==="audio")key=String(job.audio_key||"");
  else if(kind==="image"){
   const scenes=parsePayload(job.scenes_json);
   key=String(scenes.find(scene=>Number(scene.scene)===sceneNumber)?.image_key||"");
  }
  const requiredPrefix="workspaces/"+job.workspace_id+"/autopilot/"+job.id+"/";
  if(!key||!key.startsWith(requiredPrefix))return json({ok:false,error:"Requested autopilot asset is not available."},404);
  const object=await bucket.get(key);
  if(!object)return json({ok:false,error:"Autopilot asset is missing from R2."},404);
  return new Response(object.body,{headers:{"Content-Type":object.httpMetadata?.contentType||"application/octet-stream","Content-Length":String(object.size),"Cache-Control":"no-store"}});
 }
 if(request.method==="POST"&&route==="/internal/autopilot/complete"){
  const type=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  const size=Number(request.headers.get("Content-Length")||0),duration=Number(request.headers.get("X-Video-Duration")||job.duration_seconds||45);
  if(type!=="video/mp4"||!Number.isSafeInteger(size)||size<1024||size>45*1024*1024||!request.body||!Number.isFinite(duration)||duration<15||duration>60)return json({ok:false,error:"Autopilot render must be a 15–60 second MP4 under 45 MB."},413);
  const script=parsePayload(job.script_json),now=new Date().toISOString();
  const assetId=crypto.randomUUID(),sourceId=crypto.randomUUID(),clipId=crypto.randomUUID(),metadataId=crypto.randomUUID(),reviewId=crypto.randomUUID(),publishId=crypto.randomUUID();
  const key="workspaces/"+job.workspace_id+"/autopilot/"+job.id+"/final.mp4";
  const bytes=await request.arrayBuffer();
  if(bytes.byteLength!==size)return json({ok:false,error:"Render byte count does not match Content-Length."},400);
  await bucket.put(key,bytes,{httpMetadata:{contentType:"video/mp4"},customMetadata:{workspaceId:job.workspace_id,autopilotJobId:job.id,assetId}});
  const stored=await bucket.head(key);
  if(!stored||Number(stored.size)!==size){await bucket.delete(key);return json({ok:false,error:"R2 autopilot render verification failed."},500);}
  const sources=parsePayload(job.sources_json);
  const sourceNotes=Array.isArray(script.source_notes)?script.source_notes:[];
  const ids=sourceNotes.map(note=>Number(note.source_id)).filter(n=>Number.isInteger(n)&&n>=1);
  const sourceLinks=(Array.isArray(sources)?sources:[]).filter((source,index)=>!ids.length||ids.includes(index+1)).slice(0,5);
  const sourceText=sourceLinks.map(source=>source.source+": "+source.link).join("\n");
  const description=[String(script.caption||""),String(Array.isArray(script.hashtags)?script.hashtags.join(" "):""),sourceText?"Sources:\n"+sourceText:""].filter(Boolean).join("\n\n").slice(0,5000);
  const tags=[...(Array.isArray(script.hashtags)?script.hashtags:[]),"Shorts"].map(x=>String(x).replace(/^#/,"").trim()).filter(Boolean).slice(0,30);
  const settings=await env.DB.prepare("SELECT privacy_status FROM autopilot_settings WHERE workspace_id=?").bind(job.workspace_id).first();
  const privacy=["public","unlisted","private"].includes(settings?.privacy_status)?settings.privacy_status:"public";
  const title=String(script.title||job.title||"Original Short").slice(0,100);
  try{
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO source_videos(id,workspace_id,title,source_type,source_url,storage_key,mime_type,size_bytes,duration_seconds,status,created_at,updated_at) VALUES(?,?,?,'upload',NULL,?,'video/mp4',?,?,'ready',?,?)").bind(sourceId,job.workspace_id,"AI Original: "+title,key,size,duration,now,now),
    env.DB.prepare("INSERT INTO clips(id,workspace_id,source_video_id,title,start_seconds,end_seconds,hook,ai_score,transcript,status,created_at,updated_at) VALUES(?,?,?,?,0,?,?,95,?,'rendered',?,?)").bind(clipId,job.workspace_id,sourceId,title,duration,String(script.hook||""),String(job.narration||""),now,now),
    env.DB.prepare("INSERT INTO clip_metadata(id,clip_id,version,title,caption,hashtags,language,created_at,subtitle_config_json) VALUES(?,?,1,?,?,?,?,?,?)").bind(metadataId,clipId,title,String(script.caption||""),String(Array.isArray(script.hashtags)?script.hashtags.join(" "):""),String(job.voice_language||"en"),now,JSON.stringify({enabled:true,mode:"burned_in",voiceLanguage:job.voice_language,subtitleLanguage:job.subtitle_language})),
    env.DB.prepare("INSERT INTO clip_assets(id,clip_id,asset_type,storage_key,mime_type,size_bytes,version,created_at,metadata_version) VALUES(?,?,'render',?,'video/mp4',?,1,?,1)").bind(assetId,clipId,key,size,now),
    env.DB.prepare("INSERT INTO clip_reviews(id,clip_id,asset_version,metadata_version,decision,notes,reviewed_at,render_asset_id) VALUES(?,?,1,1,'approved',?,?,?)").bind(reviewId,clipId,"Automated QA passed: MP4 verified, duration in range, four original AI scenes and bilingual voice/subtitle mapping present.",now,assetId),
    env.DB.prepare("INSERT INTO publishing_jobs(id,clip_id,review_id,platform,status,scheduled_at,created_at,updated_at,render_asset_id,metadata_version,title,description,privacy_status,tags_json) VALUES(?,?,?,'youtube','queued',?,?,?,?,?,?,?,?,?)").bind(publishId,clipId,reviewId,now,now,now,assetId,1,title,description,privacy,JSON.stringify(tags)),
    env.DB.prepare("UPDATE clips SET status='publishing',updated_at=? WHERE id=? AND workspace_id=?").bind(now,clipId,job.workspace_id),
    env.DB.prepare("UPDATE autopilot_jobs SET status='queued_publish',runner_id=NULL,locked_until=NULL,output_key=?,output_size_bytes=?,clip_id=?,publishing_job_id=?,updated_at=? WHERE id=? AND status='rendering' AND runner_id=?").bind(key,size,clipId,publishId,now,job.id,runner.runnerId),
    env.DB.prepare("INSERT INTO activity_logs(id,workspace_id,entity_type,entity_id,event,details,created_at) VALUES(?,?, 'clip',?,'autopilot_rendered',?,?)").bind(crypto.randomUUID(),job.workspace_id,clipId,JSON.stringify({autopilotJobId:job.id,assetId,publishingJobId:publishId,durationSeconds:duration}),now)
   ]);
   if(Number(result[7]?.meta?.changes||0)!==1)throw new Error("Autopilot job changed before the render could be saved.");
  }catch(error){
   await bucket.delete(key);
   throw error;
  }
  return json({ok:true,clipId,assetId,publishingJobId:publishId,sizeBytes:size,durationSeconds:duration,privacyStatus:privacy});
 }
 if(request.method==="POST"&&route==="/internal/autopilot/fail"){
  const body=await request.json().catch(()=>({})),message=String(body.error||"Autopilot FFmpeg render failed.").slice(0,1000),now=new Date().toISOString();
  const retry=Number(job.attempts||0)<2;
  await env.DB.prepare("UPDATE autopilot_jobs SET status=?,last_error=?,runner_id=NULL,locked_until=NULL,updated_at=? WHERE id=? AND status='rendering' AND runner_id=?")
   .bind(retry?"render_queued":"failed",message,now,job.id,runner.runnerId).run();
  return json({ok:true,retryScheduled:retry,attempts:Number(job.attempts||0),maxAttempts:2});
 }
 return json({ok:false,error:"Not found."},404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal/autopilot/")) return handleAutopilotRender(request, env, url);
    if (url.pathname.startsWith("/internal/render/")) return handleBackgroundRender(request, env, url);
    if (request.method === "POST" && url.pathname === "/internal/transcribe-chunk") return processBrowserAudioChunk(request, env);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "ShortsFlow Analysis Engine",
        mode: "scheduled",
        bindings: {
          database: Boolean(env.DB),
          sourceStorage: Boolean(env.SOURCE_MEDIA || env.MEDIA),
          sourceMediaBinding: Boolean(env.SOURCE_MEDIA),
          mediaBinding: Boolean(env.MEDIA),
          mediaTransformations: Boolean(env.MEDIA_TRANSFORM),
          workersAI: Boolean(env.AI),
          youtubePublishingConfigured: Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_TOKEN_ENCRYPTION_KEY),
          backgroundRenderRunner: Boolean(env.DB && (env.SOURCE_MEDIA || env.MEDIA))
        }
      });
    }
    return json({ ok: false, error: "Not found." }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([processNextJob(env), processYoutubeJob(env), processAutopilot(env)]));
  }
};
