import { json, getSessionUser, readJson } from "../_lib/auth.js";
const ID=/^[0-9a-f-]{36}$/i;
async function restoreClipAfterPublishing(env,clipId,workspaceId,now){
 return env.DB.prepare(`UPDATE clips SET status=CASE WHEN EXISTS(
  SELECT 1 FROM clip_metadata m
  JOIN clip_assets a ON a.clip_id=m.clip_id AND a.asset_type='render'
   AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=m.clip_id AND x.asset_type='render')
   AND a.metadata_version=m.version
  JOIN clip_reviews r ON r.id=(SELECT x.id FROM clip_reviews x WHERE x.clip_id=m.clip_id
   AND x.render_asset_id=a.id AND x.metadata_version=m.version ORDER BY x.reviewed_at DESC,x.id DESC LIMIT 1)
   AND r.decision='approved'
  WHERE m.clip_id=clips.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clips.id)
 ) THEN 'approved' ELSE 'editing' END,updated_at=?
 WHERE id=? AND workspace_id=? AND status='publishing'
 AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.clip_id=clips.id AND p.platform='youtube'
  AND p.status IN ('queued','uploading','processing','published'))`).bind(now,clipId,workspaceId).run();
}

export async function onRequestGet({request,env}){
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 try{
  const connection=await env.DB.prepare("SELECT channel_id,channel_title,channel_thumbnail_url,connected_at FROM youtube_connections WHERE workspace_id=?").bind(user.workspace.id).first();
  const jobs=await env.DB.prepare(`SELECT p.id,p.clip_id,p.status,p.scheduled_at,p.platform_video_id,p.platform_url,p.title,p.description,p.privacy_status,p.attempts,p.last_error,p.created_at,p.render_asset_id,p.metadata_version,c.title AS clip_title FROM publishing_jobs p JOIN clips c ON c.id=p.clip_id WHERE c.workspace_id=? AND p.platform='youtube' ORDER BY COALESCE(p.scheduled_at,p.created_at) DESC LIMIT 100`).bind(user.workspace.id).all();
  const approved=await env.DB.prepare(`SELECT COUNT(*) AS count FROM clips c JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(version) FROM clip_metadata WHERE clip_id=c.id) JOIN clip_assets a ON a.clip_id=c.id AND a.asset_type='render' AND a.version=(SELECT MAX(version) FROM clip_assets WHERE clip_id=c.id AND asset_type='render') JOIN clip_reviews r ON r.id=(SELECT r2.id FROM clip_reviews r2 WHERE r2.clip_id=c.id AND r2.render_asset_id=a.id AND r2.metadata_version=m.version ORDER BY r2.reviewed_at DESC LIMIT 1) AND r.decision='approved' WHERE c.workspace_id=? AND a.metadata_version=m.version AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.clip_id=c.id AND p.render_asset_id=a.id AND p.status IN ('queued','uploading','processing','published'))`).bind(user.workspace.id).first();
  return json({ok:true,connection:connection?{connected:true,channelId:connection.channel_id,channelTitle:connection.channel_title,thumbnailUrl:connection.channel_thumbnail_url,connectedAt:connection.connected_at}:{connected:false},jobs:jobs.results||[],eligibleCount:Number(approved?.count||0)});
 }catch(e){console.error("youtube_publisher_list",e);return json({ok:false,error:"Could not load publisher data."},503);}
}
export async function onRequestPost({request,env}){
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const body=await readJson(request),clipId=String(body?.clipId||""),title=String(body?.title||"").trim(),description=String(body?.description||"").trim(),privacy=String(body?.privacyStatus||"private");
 const scheduledAt=body?.scheduledAt?new Date(body.scheduledAt):null;
 if(!ID.test(clipId))return json({ok:false,error:"Choose a valid clip."},400);
 if(!title||title.length>100)return json({ok:false,error:"YouTube title must contain 1–100 characters."},400);
 if(description.length>5000)return json({ok:false,error:"Description must be 5,000 characters or fewer."},400);
 if(body?.tags!==undefined&&!Array.isArray(body.tags))return json({ok:false,error:"Tags must be sent as a list."},400);
 const tags=[],seenTags=new Set();let tagLength=0;
 for(const value of (Array.isArray(body?.tags)?body.tags:[])){
  if(typeof value!=="string")return json({ok:false,error:"Each tag must be text."},400);
  const tag=value.trim().replace(/\s+/g," ");if(!tag)continue;
  const key=tag.toLocaleLowerCase();if(seenTags.has(key))continue;
  const addedLength=tag.length+(tags.length?1:0);
  if(tags.length>=30)return json({ok:false,error:"YouTube allows up to 30 tags per video."},400);
  if(tagLength+addedLength>500)return json({ok:false,error:"Combined tags must be 500 characters or fewer."},400);
  seenTags.add(key);tags.push(tag);tagLength+=addedLength;
 }
 if(!["private","unlisted","public"].includes(privacy))return json({ok:false,error:"Invalid privacy setting."},400);
 if(body?.scheduledAt&&(!scheduledAt||!Number.isFinite(scheduledAt.getTime())||scheduledAt.getTime()<Date.now()+60000))return json({ok:false,error:"Choose a schedule at least one minute in the future."},400);
 try{
  const channel=await env.DB.prepare("SELECT id FROM youtube_connections WHERE workspace_id=?").bind(user.workspace.id).first();
  if(!channel)return json({ok:false,error:"Connect a YouTube channel before scheduling uploads."},409);
  const clip=await env.DB.prepare(`SELECT c.id,c.status,m.version AS metadata_version,a.id AS asset_id,a.version AS asset_version,a.metadata_version AS asset_metadata_version,r.id AS review_id
   FROM clips c JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(version) FROM clip_metadata WHERE clip_id=c.id)
   JOIN clip_assets a ON a.clip_id=c.id AND a.asset_type='render' AND a.version=(SELECT MAX(version) FROM clip_assets WHERE clip_id=c.id AND asset_type='render')
   JOIN clip_reviews r ON r.id=(SELECT r2.id FROM clip_reviews r2 WHERE r2.clip_id=c.id AND r2.render_asset_id=a.id AND r2.metadata_version=m.version ORDER BY r2.reviewed_at DESC LIMIT 1) AND r.decision='approved'
   WHERE c.id=? AND c.workspace_id=? AND a.metadata_version=m.version LIMIT 1`).bind(clipId,user.workspace.id).first();
  if(!clip)return json({ok:false,error:"This clip has no approval for its latest render. Review and approve the current version first."},409);
  const duplicate=await env.DB.prepare("SELECT id FROM publishing_jobs WHERE clip_id=? AND render_asset_id=? AND status IN ('queued','uploading','processing','published') LIMIT 1").bind(clipId,clip.asset_id).first();
  if(duplicate)return json({ok:false,error:"This exact render already has a publishing job."},409);
  const id=crypto.randomUUID(),now=new Date().toISOString(),when=scheduledAt?scheduledAt.toISOString():now;
  await env.DB.prepare(`INSERT INTO publishing_jobs (id,clip_id,review_id,platform,status,scheduled_at,created_at,updated_at,render_asset_id,metadata_version,title,description,privacy_status,tags_json)
   VALUES (?,?,?,'youtube','queued',?,?,?,?,?,?,?,?,?)`).bind(id,clipId,clip.review_id,when,now,now,clip.asset_id,clip.metadata_version,title,description,privacy,JSON.stringify(tags)).run();
  await env.DB.prepare("UPDATE clips SET status='publishing',updated_at=? WHERE id=? AND workspace_id=?").bind(now,clipId,user.workspace.id).run();
  await env.DB.prepare("INSERT INTO activity_logs (id,workspace_id,entity_type,entity_id,event,details,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),user.workspace.id,"clip",clipId,"youtube_publish_queued",JSON.stringify({jobId:id,assetId:clip.asset_id,scheduledAt:when,privacyStatus:privacy}),now).run();
  return json({ok:true,job:{id,clipId,renderAssetId:clip.asset_id,status:"queued",scheduledAt:when,privacyStatus:privacy}},201);
 }catch(e){console.error("youtube_publish_queue",e);return json({ok:false,error:"Could not schedule this YouTube upload."},503);}
}
export async function onRequestDelete({request,env}){
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const url=new URL(request.url),id=url.searchParams.get("id");if(!ID.test(id||""))return json({ok:false,error:"Invalid publishing job ID."},400);
 const job=await env.DB.prepare("SELECT p.id,p.status FROM publishing_jobs p JOIN clips c ON c.id=p.clip_id WHERE p.id=? AND p.platform='youtube' AND c.workspace_id=?").bind(id,user.workspace.id).first();
 if(!job)return json({ok:false,error:"Publishing job not found."},404);
 if(job.status==="queued"){
  const now=new Date().toISOString();
  const results=await env.DB.batch([
   env.DB.prepare("UPDATE publishing_jobs SET status='cancelled',updated_at=? WHERE id=? AND status='queued' AND platform='youtube'").bind(now,id),
   env.DB.prepare(`UPDATE clips SET status=CASE WHEN EXISTS(
    SELECT 1 FROM clip_metadata m JOIN clip_assets a ON a.clip_id=m.clip_id AND a.asset_type='render'
     AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=m.clip_id AND x.asset_type='render') AND a.metadata_version=m.version
    JOIN clip_reviews r ON r.id=(SELECT x.id FROM clip_reviews x WHERE x.clip_id=m.clip_id AND x.render_asset_id=a.id AND x.metadata_version=m.version ORDER BY x.reviewed_at DESC,x.id DESC LIMIT 1) AND r.decision='approved'
    WHERE m.clip_id=clips.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clips.id)
   ) THEN 'approved' ELSE 'editing' END,updated_at=?
   WHERE id=(SELECT clip_id FROM publishing_jobs WHERE id=? AND status='cancelled') AND workspace_id=?
    AND status='publishing' AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.clip_id=clips.id AND p.platform='youtube' AND p.status IN ('queued','uploading','processing','published'))`).bind(now,id,user.workspace.id)
  ]);
  if(!results[0]?.meta?.changes)return json({ok:false,error:"This job changed state. Refresh the queue and try again."},409);
  return json({ok:true,cancelled:true});
 }
 if(job.status==="failed"){
  const now=new Date().toISOString();
  const results=await env.DB.batch([
   env.DB.prepare("DELETE FROM publishing_jobs WHERE id=? AND status='failed' AND platform='youtube'").bind(id),
   env.DB.prepare(`UPDATE clips SET status=CASE WHEN EXISTS(
    SELECT 1 FROM clip_metadata m JOIN clip_assets a ON a.clip_id=m.clip_id AND a.asset_type='render'
     AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=m.clip_id AND x.asset_type='render') AND a.metadata_version=m.version
    JOIN clip_reviews r ON r.id=(SELECT x.id FROM clip_reviews x WHERE x.clip_id=m.clip_id AND x.render_asset_id=a.id AND x.metadata_version=m.version ORDER BY x.reviewed_at DESC,x.id DESC LIMIT 1) AND r.decision='approved'
    WHERE m.clip_id=clips.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=clips.id)
   ) THEN 'approved' ELSE 'editing' END,updated_at=?
   WHERE id=(SELECT clip_id FROM clips c JOIN publishing_jobs p ON p.clip_id=c.id WHERE p.id=? AND p.platform='youtube') AND workspace_id=?
    AND status='publishing' AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.clip_id=clips.id AND p.platform='youtube' AND p.status IN ('queued','uploading','processing','published'))`).bind(now,id,user.workspace.id)
  ]);
  if(!results[0]?.meta?.changes)return json({ok:false,error:"This job changed state. Refresh the queue and try again."},409);
  return json({ok:true,deleted:true});
 }
 return json({ok:false,error:"Only queued jobs can be cancelled or failed jobs can be deleted."},409);
}