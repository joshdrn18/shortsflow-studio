import { json, getSessionUser } from "../../_lib/auth.js";
const ID=/^[0-9a-f-]{36}$/i, MAX=90*1024*1024;
function rangeOf(h,size){if(!h)return null;const m=/^bytes=(\d*)-(\d*)$/.exec(h.trim());if(!m||(!m[1]&&!m[2]))return{invalid:true};let a,b;if(!m[1]){const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<1)return{invalid:true};a=Math.max(0,size-n);b=size-1;}else{a=Number(m[1]);b=m[2]?Number(m[2]):size-1;}if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<a||a>=size)return{invalid:true};b=Math.min(b,size-1);return{start:a,end:b,length:b-a+1};}
export async function onRequestGet({request,env,params}){
 if(!env.DB||!env.MEDIA)return json({ok:false,error:"Render storage is not configured."},503);
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const id=String(params?.clipId||"");if(!ID.test(id))return json({ok:false,error:"Invalid clip ID."},400);
 try{
  const row=await env.DB.prepare(`SELECT a.storage_key,a.mime_type,a.version,a.metadata_version,m.version AS current_version FROM clip_assets a JOIN clips c ON c.id=a.clip_id LEFT JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id) WHERE a.clip_id=? AND c.workspace_id=? AND a.asset_type='render' ORDER BY a.version DESC LIMIT 1`).bind(id,user.workspace.id).first();
  if(!row)return json({ok:false,error:"No rendered video exists for this clip yet."},404);
  if(Number(row.metadata_version)!==Number(row.current_version))return json({ok:false,error:"This render belongs to an older edit. Render the latest version again."},409);
  const head=await env.MEDIA.head(row.storage_key);if(!head)return json({ok:false,error:"Rendered video is missing."},404);
  const h=new Headers({"Content-Type":row.mime_type||"video/webm","Content-Disposition":'inline; filename="shortsflow-render.webm"',"Accept-Ranges":"bytes","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
  const r=rangeOf(request.headers.get("Range"),head.size);if(r?.invalid){h.set("Content-Range",`bytes */${head.size}`);return new Response(null,{status:416,headers:h});}
  const obj=r?await env.MEDIA.get(row.storage_key,{range:{offset:r.start,length:r.length}}):await env.MEDIA.get(row.storage_key);if(!obj)return json({ok:false,error:"Rendered video is missing."},404);
  if(r){h.set("Content-Range",`bytes ${r.start}-${r.end}/${head.size}`);h.set("Content-Length",String(r.length));return new Response(obj.body,{status:206,headers:h});}
  h.set("Content-Length",String(head.size));return new Response(obj.body,{headers:h});
 }catch(e){console.error("render_read_failed",e);return json({ok:false,error:"Could not load rendered video."},500);}
}
export async function onRequestPost({request,env,params}){
 if(!env.DB||!env.MEDIA)return json({ok:false,error:"Render storage is not configured."},503);
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 const id=String(params?.clipId||"");if(!ID.test(id))return json({ok:false,error:"Invalid clip ID."},400);
 if((request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase()!=="video/webm")return json({ok:false,error:"Only WebM render output is accepted in this browser-rendering version."},415);
 const mv=Number(request.headers.get("X-Metadata-Version"));if(!Number.isSafeInteger(mv)||mv<1)return json({ok:false,error:"Render metadata version is missing."},400);
 const declaredSize=Number(request.headers.get("Content-Length")||0);
 if(!Number.isSafeInteger(declaredSize)||declaredSize<1024)return json({ok:false,error:"A valid Content-Length is required for secure R2 streaming."},411);
 if(declaredSize>MAX)return json({ok:false,error:"Rendered file exceeds the 90 MB storage limit."},413);
 if(!request.body)return json({ok:false,error:"Rendered file is empty."},400);
 let key=null;
 try{
  const clip=await env.DB.prepare(`SELECT c.id,m.version AS metadata_version FROM clips c LEFT JOIN clip_metadata m ON m.clip_id=c.id AND m.version=(SELECT MAX(x.version) FROM clip_metadata x WHERE x.clip_id=c.id) WHERE c.id=? AND c.workspace_id=?`).bind(id,user.workspace.id).first();
  if(!clip)return json({ok:false,error:"Clip not found in this workspace."},404);
  if(Number(clip.metadata_version)!==mv)return json({ok:false,error:"Clip settings changed. Refresh the editor and render the latest version."},409);
  const size=declaredSize,fixed=new FixedLengthStream(size);
  const assetId=crypto.randomUUID();key=`workspaces/${user.workspace.id}/clips/${id}/renders/${assetId}.webm`;
  const pipePromise=request.body.pipeTo(fixed.writable);
  const putPromise=env.MEDIA.put(key,fixed.readable,{httpMetadata:{contentType:"video/webm"},customMetadata:{workspaceId:user.workspace.id,clipId:id,metadataVersion:String(mv),assetId}});
  await Promise.all([pipePromise,putPromise]);
  const latest=await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM clip_assets WHERE clip_id=? AND asset_type='render'").bind(id).first();
  const version=Number(latest?.version||0)+1,now=new Date().toISOString();
  const saved = await env.DB.batch([
   env.DB.prepare("INSERT INTO clip_assets (id,clip_id,asset_type,storage_key,mime_type,size_bytes,version,metadata_version,created_at) SELECT ?,?,'render',?,'video/webm',?,?,?,? WHERE (SELECT MAX(version) FROM clip_metadata WHERE clip_id=?)=?").bind(assetId,id,key,size,version,mv,now,id,mv),
   env.DB.prepare("UPDATE clips SET status='rendered',updated_at=? WHERE id=? AND workspace_id=? AND (SELECT MAX(version) FROM clip_metadata WHERE clip_id=?)=?").bind(now,id,user.workspace.id,id,mv),
   env.DB.prepare("INSERT INTO activity_logs (id,workspace_id,entity_type,entity_id,event,details,created_at) SELECT ?,?, 'clip',?,'clip_rendered',?,? WHERE EXISTS (SELECT 1 FROM clip_assets WHERE id=?)").bind(crypto.randomUUID(),user.workspace.id,id,JSON.stringify({assetVersion:version,metadataVersion:mv,sizeBytes:size,format:"webm"}),now,assetId)
  ]);
  if (Number(saved[0]?.meta?.changes || 0) !== 1) throw new Error("Clip settings changed while rendering. Please render the latest version again.");
  return json({ok:true,asset:{id:assetId,version,metadataVersion:mv,sizeBytes:size,mimeType:"video/webm",url:`/api/clips/${id}/render`}},201);
 }catch(e){if(key){try{await env.MEDIA.delete(key);}catch{}}console.error("render_upload_failed",e);const msg=String(e?.message||"");return json({ok:false,error:msg.includes("90 MB")?msg:"Could not save the rendered video. Please retry."},msg.includes("90 MB")?413:500);}
}