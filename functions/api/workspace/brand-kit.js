import { json, getSessionUser, readJson } from "../_lib/auth.js";

function validObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
export async function onRequestGet({request,env}) {
  if(!env.DB) return json({ok:false,error:"Database is not configured."},503);
  const user=await getSessionUser(request,env);
  if(!user?.workspace?.id) return json({ok:false,error:"Authentication required."},401);
  try {
    const row=await env.DB.prepare("SELECT kit_name,subtitle_config_json,watermark_config_json,updated_at FROM workspace_brand_kits WHERE workspace_id=?").bind(user.workspace.id).first();
    if(!row) return json({ok:true,kit:null});
    let subtitle={},watermark={};
    try{subtitle=JSON.parse(row.subtitle_config_json||"{}");}catch{}
    try{watermark=JSON.parse(row.watermark_config_json||"{}");}catch{}
    return json({ok:true,kit:{name:row.kit_name,subtitle,watermark,updatedAt:row.updated_at}});
  } catch { return json({ok:false,error:"Could not load Brand Kit. Apply migration 0015."},503); }
}
export async function onRequestPut({request,env}) {
  if(!env.DB) return json({ok:false,error:"Database is not configured."},503);
  const user=await getSessionUser(request,env);
  if(!user?.workspace?.id) return json({ok:false,error:"Authentication required."},401);
  const body=await readJson(request);
  if(!validObject(body)||!validObject(body.subtitle)||!validObject(body.watermark)) return json({ok:false,error:"Invalid Brand Kit payload."},400);
  const name=String(body.name||"My Brand").trim().slice(0,40)||"My Brand";
  const subtitle=JSON.stringify(body.subtitle),watermark=JSON.stringify(body.watermark);
  if(subtitle.length>12000||watermark.length>3000) return json({ok:false,error:"Brand Kit settings are too large."},413);
  try {
    await env.DB.prepare(`INSERT INTO workspace_brand_kits (workspace_id,kit_name,subtitle_config_json,watermark_config_json,updated_at)
      VALUES (?,?,?,?,datetime('now')) ON CONFLICT(workspace_id) DO UPDATE SET kit_name=excluded.kit_name,subtitle_config_json=excluded.subtitle_config_json,watermark_config_json=excluded.watermark_config_json,updated_at=datetime('now')`)
      .bind(user.workspace.id,name,subtitle,watermark).run();
    return json({ok:true,name});
  } catch { return json({ok:false,error:"Could not save Brand Kit. Apply migration 0015."},503); }
}
