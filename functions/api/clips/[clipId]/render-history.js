import { json, getSessionUser } from "../../_lib/auth.js";
const ID=/^[0-9a-f-]{36}$/i;

export async function onRequestGet({request,env,params}){
 if(!env.DB)return json({ok:false,error:"Database is not configured."},503);
 const user=await getSessionUser(request,env);
 if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const clipId=String(params?.clipId||"");
 if(!ID.test(clipId))return json({ok:false,error:"Invalid clip ID."},400);
 try{
  const rows=await env.DB.prepare(`
   SELECT a.id,a.version,a.metadata_version,a.size_bytes,a.mime_type,a.created_at,
    CASE WHEN a.id=(SELECT latest.id FROM clip_assets latest WHERE latest.clip_id=a.clip_id AND latest.asset_type='render' ORDER BY latest.version DESC LIMIT 1) THEN 1 ELSE 0 END AS is_latest,
    CASE WHEN EXISTS(SELECT 1 FROM clip_reviews r WHERE r.render_asset_id=a.id OR (r.render_asset_id IS NULL AND r.clip_id=a.clip_id AND r.asset_version=a.version)) THEN 1 ELSE 0 END AS has_review,
    CASE WHEN EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.render_asset_id=a.id OR (p.render_asset_id IS NULL AND p.clip_id=a.clip_id)) THEN 1 ELSE 0 END AS has_publish
   FROM clip_assets a JOIN clips c ON c.id=a.clip_id
   WHERE a.clip_id=? AND c.workspace_id=? AND a.asset_type='render'
   ORDER BY a.version DESC LIMIT 100
  `).bind(clipId,user.workspace.id).all();
  const items=(rows.results||[]).map(r=>{
   const latest=Number(r.is_latest)===1,review=Number(r.has_review)===1,publish=Number(r.has_publish)===1;
   return {id:r.id,version:Number(r.version),metadataVersion:Number(r.metadata_version),sizeBytes:Number(r.size_bytes||0),mimeType:r.mime_type||"video/webm",createdAt:r.created_at,isLatest:latest,isProtected:latest||review||publish,protectedReasons:[...(latest?["Latest render"]:[]),...(review?["Review Center"]:[]),...(publish?["YouTube publishing"]:[])],previewUrl:`/api/clips/${clipId}/render?assetId=${encodeURIComponent(r.id)}`,downloadUrl:`/api/clips/${clipId}/render?assetId=${encodeURIComponent(r.id)}&download=1`};
  });
  return json({ok:true,items,total:items.length,totalBytes:items.reduce((sum,x)=>sum+x.sizeBytes,0)});
 }catch(error){console.error("render_history_list_failed",error);return json({ok:false,error:"Could not load render history."},503);}
}
