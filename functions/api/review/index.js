import { json, getSessionUser } from "../_lib/auth.js";
const ID=/^[0-9a-f-]{36}$/i;
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database is not configured."},503);
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 try{
  const rows=await env.DB.prepare(`
   SELECT c.id AS clip_id,c.title AS clip_title,c.start_seconds,c.end_seconds,c.status AS clip_status,
    s.title AS source_title,m.title,m.caption,m.hashtags,m.version AS metadata_version,
    a.id AS asset_id,a.version AS asset_version,a.metadata_version AS asset_metadata_version,a.size_bytes,a.mime_type,a.created_at AS rendered_at,
    (SELECT r.decision FROM clip_reviews r WHERE r.clip_id=c.id AND r.render_asset_id=a.id AND r.metadata_version=m.version ORDER BY r.reviewed_at DESC LIMIT 1) AS decision,
    (SELECT r.notes FROM clip_reviews r WHERE r.clip_id=c.id AND r.render_asset_id=a.id AND r.metadata_version=m.version ORDER BY r.reviewed_at DESC LIMIT 1) AS review_notes
   FROM clips c JOIN source_videos s ON s.id=c.source_video_id AND s.workspace_id=c.workspace_id
   JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id)
   JOIN clip_assets a ON a.clip_id=c.id AND a.asset_type='render' AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=c.id AND x.asset_type='render')
   WHERE c.workspace_id=? AND a.metadata_version=m.version
   ORDER BY a.created_at DESC LIMIT 100
  `).bind(user.workspace.id).all();
  return json({ok:true,items:(rows.results||[]).map(r=>({clipId:r.clip_id,title:r.title||r.clip_title||"Untitled clip",caption:r.caption||"",hashtags:r.hashtags||"",sourceTitle:r.source_title,startSeconds:Number(r.start_seconds),endSeconds:Number(r.end_seconds),durationSeconds:Math.max(0,Number(r.end_seconds)-Number(r.start_seconds)),metadataVersion:Number(r.metadata_version),assetId:r.asset_id,assetVersion:Number(r.asset_version),sizeBytes:Number(r.size_bytes||0),mimeType:r.mime_type||"video/webm",renderedAt:r.rendered_at,decision:r.decision||"pending",notes:r.review_notes||"",previewUrl:`/api/clips/${r.clip_id}/render?assetId=${encodeURIComponent(r.asset_id)}`,downloadUrl:`/api/clips/${r.clip_id}/render?assetId=${encodeURIComponent(r.asset_id)}&download=1`}))});
 }catch(e){console.error("review_queue_failed",e);return json({ok:false,error:"Could not load review queue."},503);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database is not configured."},503);
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 let body;try{body=await request.json();}catch{return json({ok:false,error:"Invalid JSON body."},400);}
 const clipId=String(body.clipId||""),assetId=String(body.assetId||""),decision=String(body.decision||""),notes=String(body.notes||"").trim().slice(0,2000);
 if(!ID.test(clipId)||!ID.test(assetId))return json({ok:false,error:"Invalid clip or render asset ID."},400);
 if(!["approved","rejected","changes_requested"].includes(decision))return json({ok:false,error:"Invalid review decision."},400);
 if(decision!=="approved"&&!notes)return json({ok:false,error:"Add a note explaining the rejection or requested changes."},400);
 try{
  const current=await env.DB.prepare(`
   SELECT c.id,c.status,m.version AS metadata_version,a.id AS asset_id,a.version AS asset_version,a.metadata_version AS asset_metadata_version
   FROM clips c JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id)
   JOIN clip_assets a ON a.clip_id=c.id AND a.asset_type='render' AND a.version=(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=c.id AND x.asset_type='render')
   WHERE c.id=? AND c.workspace_id=?
  `).bind(clipId,user.workspace.id).first();
  if(!current)return json({ok:false,error:"Clip or render not found."},404);
  if(current.asset_id!==assetId||Number(current.metadata_version)!==Number(current.asset_metadata_version))return json({ok:false,error:"This render is no longer the latest version. Refresh the review queue and review the newest render."},409);
  const reviewId=crypto.randomUUID(),now=new Date().toISOString();
  const status=decision==="approved"?"approved":decision==="rejected"?"rejected":"editing";
  const results=await env.DB.batch([
   env.DB.prepare("INSERT INTO clip_reviews (id,clip_id,asset_version,metadata_version,render_asset_id,decision,notes,reviewed_at) VALUES (?,?,?,?,?,?,?,?)").bind(reviewId,clipId,current.asset_version,current.metadata_version,assetId,decision,notes,now),
   env.DB.prepare("UPDATE clips SET status=?,updated_at=? WHERE id=? AND workspace_id=? AND (SELECT MAX(version) FROM clip_metadata WHERE clip_id=?)=? AND EXISTS (SELECT 1 FROM clip_assets WHERE id=? AND clip_id=? AND metadata_version=?)").bind(status,now,clipId,user.workspace.id,clipId,current.metadata_version,assetId,clipId,current.metadata_version),
   env.DB.prepare("INSERT INTO activity_logs (id,workspace_id,entity_type,entity_id,event,details,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),user.workspace.id,"clip",clipId,"clip_review_"+decision,JSON.stringify({reviewId,assetId,assetVersion:current.asset_version,metadataVersion:current.metadata_version}),now)
  ]);
  if(Number(results[1]?.meta?.changes||0)!==1)return json({ok:false,error:"The clip changed while saving this review. Refresh and try again."},409);
  return json({ok:true,review:{id:reviewId,clipId,assetId,assetVersion:Number(current.asset_version),metadataVersion:Number(current.metadata_version),decision,notes,reviewedAt:now}},201);
 }catch(e){console.error("review_decision_failed",e);return json({ok:false,error:"Could not save review decision."},500);}
}