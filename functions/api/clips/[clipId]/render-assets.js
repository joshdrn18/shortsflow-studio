import { json, getSessionUser } from "../../_lib/auth.js";
const ID=/^[0-9a-f-]{36}$/i;

async function getWorkspace(request,env){
 if(!env.DB||!env.MEDIA)return {response:json({ok:false,error:"Database or private storage is not configured."},503)};
 const user=await getSessionUser(request,env);
 if(!user?.workspace?.id)return {response:json({ok:false,error:"Authentication required."},401)};
 return {workspaceId:user.workspace.id};
}

export async function onRequestGet({request,env,params}){
 const auth=await getWorkspace(request,env);if(auth.response)return auth.response;
 const clipId=String(params?.clipId||"");if(!ID.test(clipId))return json({ok:false,error:"Invalid clip ID."},400);
 try{
  const clip=await env.DB.prepare("SELECT id FROM clips WHERE id=? AND workspace_id=?").bind(clipId,auth.workspaceId).first();
  if(!clip)return json({ok:false,error:"Clip not found in this workspace."},404);
  const result=await env.DB.prepare(`
   SELECT a.id,a.version,a.size_bytes,a.created_at
   FROM clip_assets a
   WHERE a.clip_id=? AND a.asset_type='render'
    AND a.version<(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=a.clip_id AND x.asset_type='render')
    AND NOT EXISTS(SELECT 1 FROM clip_reviews r WHERE r.render_asset_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.render_asset_id=a.id)
   ORDER BY a.version ASC
  `).bind(clipId).all();
  const items=(result.results||[]).map(row=>({id:row.id,version:Number(row.version),sizeBytes:Number(row.size_bytes||0),createdAt:row.created_at}));
  return json({ok:true,items,totalBytes:items.reduce((sum,item)=>sum+item.sizeBytes,0)});
 }catch(error){console.error("render_asset_cleanup_list",error);return json({ok:false,error:"Could not load unused old renders."},503);}
}

export async function onRequestDelete({request,env,params}){
 const auth=await getWorkspace(request,env);if(auth.response)return auth.response;
 const clipId=String(params?.clipId||""),url=new URL(request.url),assetId=url.searchParams.get("assetId")||"";
 if(!ID.test(clipId)||!ID.test(assetId))return json({ok:false,error:"Invalid clip or render asset ID."},400);
 try{
  const asset=await env.DB.prepare(`
   SELECT a.id,a.storage_key,a.version,a.size_bytes
   FROM clip_assets a JOIN clips c ON c.id=a.clip_id
   WHERE a.id=? AND a.clip_id=? AND c.workspace_id=? AND a.asset_type='render'
    AND a.version<(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=a.clip_id AND x.asset_type='render')
    AND NOT EXISTS(SELECT 1 FROM clip_reviews r WHERE r.render_asset_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.render_asset_id=a.id)
   LIMIT 1
  `).bind(assetId,clipId,auth.workspaceId).first();
  if(!asset)return json({ok:false,error:"This render is latest, reviewed, queued, published, or no longer eligible for cleanup."},409);
  await env.MEDIA.delete(asset.storage_key);
  const deleted=await env.DB.prepare(`
   DELETE FROM clip_assets
   WHERE id=? AND clip_id=? AND asset_type='render'
    AND version<(SELECT MAX(x.version) FROM clip_assets x WHERE x.clip_id=clip_assets.clip_id AND x.asset_type='render')
    AND NOT EXISTS(SELECT 1 FROM clip_reviews r WHERE r.render_asset_id=clip_assets.id)
    AND NOT EXISTS(SELECT 1 FROM publishing_jobs p WHERE p.render_asset_id=clip_assets.id)
  `).bind(assetId,clipId).run();
  if(Number(deleted.meta?.changes||0)!==1)return json({ok:false,error:"The render changed while cleaning up. Refresh the list before retrying."},409);
  return json({ok:true,deleted:true,assetId,sizeBytes:Number(asset.size_bytes||0)});
 }catch(error){console.error("render_asset_cleanup_failed",error);return json({ok:false,error:"Could not delete this unused render. Please retry."},503);}
}
