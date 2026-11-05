import { json, getSessionUser, readJson } from "../_lib/auth.js";

const positions = new Set(["top-left","top-right","bottom-left","bottom-right"]);
const scales = new Set(["small","medium","large"]);
export async function onRequestGet({request,env}) {
  if(!env.DB) return json({ok:false,error:"Database is not configured."},503);
  const user=await getSessionUser(request,env);
  if(!user?.workspace?.id) return json({ok:false,error:"Authentication required."},401);
  try {
    const row=await env.DB.prepare("SELECT watermark_enabled,watermark_text,watermark_position,watermark_opacity,watermark_scale FROM workspace_settings WHERE workspace_id=?").bind(user.workspace.id).first();
    return json({ok:true,settings:row?{watermarkEnabled:!!row.watermark_enabled,watermarkText:row.watermark_text,watermarkPosition:row.watermark_position,watermarkOpacity:row.watermark_opacity,watermarkScale:row.watermark_scale}:{watermarkEnabled:true,watermarkText:"YOUR BRAND",watermarkPosition:"bottom-right",watermarkOpacity:0.72,watermarkScale:"medium"}});
  } catch { return json({ok:false,error:"Could not load workspace settings. Apply migration 0003."},503); }
}
export async function onRequestPut({request,env}) {
  if(!env.DB) return json({ok:false,error:"Database is not configured."},503);
  const user=await getSessionUser(request,env);
  if(!user?.workspace?.id) return json({ok:false,error:"Authentication required."},401);
  const body=await readJson(request);
  if(!body||typeof body!=="object") return json({ok:false,error:"Invalid settings payload."},400);
  const text=typeof body.watermarkText==="string"?body.watermarkText.trim().slice(0,40):"YOUR BRAND";
  const position=positions.has(body.watermarkPosition)?body.watermarkPosition:"bottom-right";
  const scale=scales.has(body.watermarkScale)?body.watermarkScale:"medium";
  const opacity=Math.min(1,Math.max(0.1,Number(body.watermarkOpacity)||0.72));
  const enabled=body.watermarkEnabled===false?0:1;
  try {
    await env.DB.prepare(`INSERT INTO workspace_settings (workspace_id,watermark_enabled,watermark_text,watermark_position,watermark_opacity,watermark_scale,updated_at)
      VALUES (?,?,?,?,?,?,datetime('now')) ON CONFLICT(workspace_id) DO UPDATE SET watermark_enabled=excluded.watermark_enabled,watermark_text=excluded.watermark_text,watermark_position=excluded.watermark_position,watermark_opacity=excluded.watermark_opacity,watermark_scale=excluded.watermark_scale,updated_at=datetime('now')`)
      .bind(user.workspace.id,enabled,text||"YOUR BRAND",position,opacity,scale).run();
    return json({ok:true});
  } catch { return json({ok:false,error:"Could not save watermark settings. Apply migration 0003."},503); }
}
