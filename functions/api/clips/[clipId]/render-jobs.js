import { json, getSessionUser } from "../../_lib/auth.js";
const ID=/^[0-9a-f-]{36}$/i;
async function wakeRenderRunner(env){
 const token=env.GITHUB_ACTIONS_TOKEN||env.GITHUB_DISPATCH_TOKEN;
 if(!token)return false;
 try{
  const response=await fetch("https://api.github.com/repos/joshdrn18/shortsflow-studio/actions/workflows/background-render.yml/dispatches",{
   method:"POST",
   headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"},
   body:JSON.stringify({ref:"main"})
  });
  if(!response.ok){
   console.error("background_render_dispatch_failed",{status:response.status});
   return false;
  }
  return true;
 }catch(error){
  console.error("background_render_dispatch_failed",String(error?.message||error));
  return false;
 }
}
export async function onRequestPost({request,env,params}){
 if(!env.DB||!env.MEDIA)return json({ok:false,error:"Render queue storage is not configured."},503);
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const clipId=String(params?.clipId||"");if(!ID.test(clipId))return json({ok:false,error:"Invalid clip ID."},400);
 try{
  const clip=await env.DB.prepare(`SELECT c.id,c.source_video_id,c.start_seconds,c.end_seconds,s.storage_key,s.size_bytes,
    m.version,m.title,m.caption,m.hashtags,m.language
   FROM clips c JOIN source_videos s ON s.id=c.source_video_id
   JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id)
   WHERE c.id=? AND c.workspace_id=?`).bind(clipId,user.workspace.id).first();
  if(!clip?.storage_key)return json({ok:false,error:"Clip or private source video was not found."},404);
  const duration=Number(clip.end_seconds)-Number(clip.start_seconds);
  if(duration<1||duration>180)return json({ok:false,error:"Clip duration must be between 1 and 180 seconds."},400);
  if(Number(clip.size_bytes||0)>200*1024*1024)return json({ok:false,error:"Source exceeds the 200 MB background render limit."},413);
  const active=await env.DB.prepare("SELECT * FROM clip_render_jobs WHERE clip_id=? AND metadata_version=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").bind(clipId,clip.version).first();
  if(active){
   const runnerWakeRequested=active.status==="queued"?await wakeRenderRunner(env):false;
   return json({ok:true,job:{id:active.id,status:active.status,metadataVersion:Number(active.metadata_version),createdAt:active.created_at},reused:true,runnerWakeRequested},200);
  }
  const now=new Date().toISOString(),jobId=crypto.randomUUID();
  const result=await env.DB.prepare(`INSERT INTO clip_render_jobs(id,workspace_id,clip_id,source_video_id,metadata_version,status,created_at,updated_at)
   SELECT ?,?,?,?,?, 'queued',?,? WHERE (SELECT MAX(version) FROM clip_metadata WHERE clip_id=?)=?`)
   .bind(jobId,user.workspace.id,clipId,clip.source_video_id,clip.version,now,now,clipId,clip.version).run();
  if(Number(result.meta?.changes||0)!==1)return json({ok:false,error:"Clip changed while the render was being queued. Refresh and retry."},409);
  await env.DB.batch([
   env.DB.prepare("UPDATE clips SET status='rendering',updated_at=? WHERE id=? AND workspace_id=?").bind(now,clipId,user.workspace.id),
   env.DB.prepare("INSERT INTO activity_logs(id,workspace_id,entity_type,entity_id,event,details,created_at) VALUES(?,?, 'clip',?,'clip_render_queued',?,?)").bind(crypto.randomUUID(),user.workspace.id,clipId,JSON.stringify({jobId,metadataVersion:Number(clip.version),engine:"background-ffmpeg"}),now)
  ]);
  const runnerWakeRequested=await wakeRenderRunner(env);
  return json({ok:true,job:{id:jobId,status:"queued",metadataVersion:Number(clip.version),createdAt:now},runnerWakeRequested},202);
 }catch(error){console.error("background_render_enqueue_failed",error);return json({ok:false,error:"Could not queue background render. Please retry."},503);}
}
export async function onRequestGet({request,env,params}){
 if(!env.DB)return json({ok:false,error:"Database is not configured."},503);
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const clipId=String(params?.clipId||"");if(!ID.test(clipId))return json({ok:false,error:"Invalid clip ID."},400);
 try{
  const row=await env.DB.prepare(`SELECT j.id,j.status,j.metadata_version,j.last_error,j.created_at,j.updated_at,j.completed_at,
   a.id AS asset_id,a.version AS asset_version,a.size_bytes,a.mime_type
   FROM clip_render_jobs j LEFT JOIN clip_assets a ON a.id=j.asset_id
   WHERE j.clip_id=? AND j.workspace_id=? ORDER BY j.created_at DESC LIMIT 1`).bind(clipId,user.workspace.id).first();
  if(!row)return json({ok:true,job:null});
  return json({ok:true,job:{id:row.id,status:row.status,metadataVersion:Number(row.metadata_version),error:row.last_error||null,createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at,asset:row.asset_id?{id:row.asset_id,version:Number(row.asset_version),sizeBytes:Number(row.size_bytes||0),mimeType:row.mime_type||"video/mp4",url:`/api/clips/${clipId}/render?assetId=${encodeURIComponent(row.asset_id)}`}:null}});
 }catch(error){console.error("background_render_status_failed",error);return json({ok:false,error:"Could not load background render status."},503);}
}
