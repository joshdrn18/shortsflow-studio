import { json, getSessionUser } from "../../_lib/auth.js";

export async function onRequestPost({ request, env, params }) {
  if (!env.DB || !env.ANALYSIS_ENGINE || !env.YOUTUBE_TOKEN_ENCRYPTION_KEY) {
    return json({ ok:false, error:"Browser transcription service is not configured yet." },503);
  }
  const user=await getSessionUser(request,env);
  if(!user)return json({ok:false,error:"Authentication required."},401);
  const workspaceId=user.workspace?.id;
  if(!workspaceId)return json({ok:false,error:"No workspace is assigned to this account."},403);
  const sourceId=String(params?.sourceId||"");
  if(!/^[0-9a-f-]{36}$/i.test(sourceId))return json({ok:false,error:"Invalid source video ID."},400);
  const source=await env.DB.prepare("SELECT id,duration_seconds,size_bytes FROM source_videos WHERE id=? AND workspace_id=?").bind(sourceId,workspaceId).first();
  if(!source)return json({ok:false,error:"Source video was not found in this workspace."},404);
  const duration=Number(source.duration_seconds||0);
  if(!Number.isFinite(duration)||duration<=0||duration>1800||Number(source.size_bytes||0)>200*1024*1024)return json({ok:false,error:"Analysis supports MP4 videos up to 30 minutes and 200 MB."},413);
  const chunkIndex=Number(request.headers.get("X-Chunk-Index"));
  const totalChunks=Number(request.headers.get("X-Total-Chunks"));
  const transcriptId=request.headers.get("X-Transcript-Id")||"";
  if(!Number.isInteger(chunkIndex)||chunkIndex<0||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>30||chunkIndex>=totalChunks||totalChunks!==Math.ceil(duration/60))return json({ok:false,error:"Invalid audio chunk sequence."},400);
  if(chunkIndex>0&&!/^[0-9a-f-]{36}$/i.test(transcriptId))return json({ok:false,error:"Transcription session is missing. Restart analysis."},409);
  const headers=new Headers({
    "Content-Type":request.headers.get("Content-Type")||"application/octet-stream",
    "X-ShortsFlow-Internal":await (async()=>{const key=await crypto.subtle.importKey("raw",Uint8Array.from(atob((env.YOUTUBE_TOKEN_ENCRYPTION_KEY.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-env.YOUTUBE_TOKEN_ENCRYPTION_KEY.length%4)%4))),c=>c.charCodeAt(0)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode("shortsflow-browser-transcription-ingest-v1"));return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,"0")).join("");})(),
    "X-Source-Id":sourceId,
    "X-Workspace-Id":workspaceId,
    "X-Chunk-Index":String(chunkIndex),
    "X-Total-Chunks":String(totalChunks),
    "X-Source-Duration":String(duration),
    "X-Transcript-Id":transcriptId
  });
  try {
    const upstream=await env.ANALYSIS_ENGINE.fetch(new Request("https://analysis.internal/internal/transcribe-chunk",{method:"POST",headers,body:request.body}));
    const body=await upstream.text();
    return new Response(body,{status:upstream.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  } catch {
    return json({ok:false,error:"Could not reach the analysis engine. Retry this chunk."},502);
  }
}
