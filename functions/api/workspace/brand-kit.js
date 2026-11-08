import { json, getSessionUser, readJson } from "../_lib/auth.js";

function validObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function parseObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return validObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function shape(row) {
  return {
    id: row.id,
    name: row.profile_name,
    subtitle: parseObject(row.subtitle_config_json),
    watermark: parseObject(row.watermark_config_json),
    metadata: parseObject(row.metadata_config_json),
    updatedAt: row.updated_at
  };
}
async function context(request, env) {
  if (!env.DB) return { response: json({ok:false,error:"Database is not configured."},503) };
  const user = await getSessionUser(request, env);
  if (!user?.workspace?.id) return { response: json({ok:false,error:"Authentication required."},401) };
  return { workspaceId: user.workspace.id };
}
async function setLegacyActive(db, workspaceId, profile) {
  await db.prepare(`INSERT INTO workspace_brand_kits
    (workspace_id,kit_name,subtitle_config_json,watermark_config_json,active_profile_id,updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_id) DO UPDATE SET
      kit_name=excluded.kit_name,
      subtitle_config_json=excluded.subtitle_config_json,
      watermark_config_json=excluded.watermark_config_json,
      active_profile_id=excluded.active_profile_id,
      updated_at=datetime('now')`)
    .bind(workspaceId, profile.name, JSON.stringify(profile.subtitle), JSON.stringify(profile.watermark), profile.id).run();
}
async function getOwnedProfile(db, workspaceId, id) {
  const row = await db.prepare("SELECT id,profile_name,subtitle_config_json,watermark_config_json,metadata_config_json,updated_at FROM workspace_brand_profiles WHERE workspace_id=? AND id=?")
    .bind(workspaceId,id).first();
  return row ? shape(row) : null;
}
export async function onRequestGet({request,env}) {
  const ctx = await context(request,env);
  if (ctx.response) return ctx.response;
  try {
    const [rows, legacy] = await Promise.all([
      env.DB.prepare("SELECT id,profile_name,subtitle_config_json,watermark_config_json,metadata_config_json,updated_at FROM workspace_brand_profiles WHERE workspace_id=? ORDER BY updated_at DESC,created_at DESC").bind(ctx.workspaceId).all(),
      env.DB.prepare("SELECT kit_name,subtitle_config_json,watermark_config_json,active_profile_id,updated_at FROM workspace_brand_kits WHERE workspace_id=?").bind(ctx.workspaceId).first()
    ]);
    const profiles = (rows.results || []).map(shape);
    const activeId = legacy?.active_profile_id && profiles.some(p=>p.id===legacy.active_profile_id)
      ? legacy.active_profile_id : (profiles[0]?.id || null);
    const active = profiles.find(p=>p.id===activeId) || null;
    const fallback = !profiles.length && legacy ? {
      id:null,name:legacy.kit_name,subtitle:parseObject(legacy.subtitle_config_json),
      watermark:parseObject(legacy.watermark_config_json),metadata:{},updatedAt:legacy.updated_at
    } : null;
    return json({ok:true,profiles,activeProfileId:activeId,kit:active||fallback});
  } catch (error) {
    console.error("brand_profiles_load_failed",error);
    return json({ok:false,error:"Could not load Brand Profiles. Apply migrations 0016 and 0017."},503);
  }
}
export async function onRequestPost({request,env}) {
  const ctx = await context(request,env);
  if (ctx.response) return ctx.response;
  const body = await readJson(request);
  if (!validObject(body)) return json({ok:false,error:"Invalid Brand Profile payload."},400);
  const name = String(body.name || "New Brand").trim().slice(0,40) || "New Brand";
  const subtitle = validObject(body.subtitle) ? body.subtitle : {};
  const watermark = validObject(body.watermark) ? body.watermark : {};
  const metadata = validObject(body.metadata) ? body.metadata : {};
  const subtitleJson=JSON.stringify(subtitle),watermarkJson=JSON.stringify(watermark),metadataJson=JSON.stringify(metadata);
  if (subtitleJson.length>12000 || watermarkJson.length>3000 || metadataJson.length>8000) return json({ok:false,error:"Brand Profile settings are too large."},413);
  try {
    const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM workspace_brand_profiles WHERE workspace_id=?").bind(ctx.workspaceId).first();
    if(Number(count?.total||0)>=20)return json({ok:false,error:"A workspace can have up to 20 Brand Profiles."},409);
    const id=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO workspace_brand_profiles (id,workspace_id,profile_name,subtitle_config_json,watermark_config_json,metadata_config_json) VALUES (?,?,?,?,?,?)")
      .bind(id,ctx.workspaceId,name,subtitleJson,watermarkJson,metadataJson).run();
    const profile={id,name,subtitle,watermark,metadata};
    await setLegacyActive(env.DB,ctx.workspaceId,profile);
    return json({ok:true,profile},201);
  } catch(error) {
    console.error("brand_profile_create_failed",error);
    return json({ok:false,error:"Could not create Brand Profile. Check migrations 0016 and 0017."},503);
  }
}
export async function onRequestPut({request,env}) {
  const ctx=await context(request,env);
  if(ctx.response)return ctx.response;
  const body=await readJson(request);
  if(!validObject(body))return json({ok:false,error:"Invalid Brand Profile payload."},400);
  try {
    if(body.action==="activate") {
      const profile=await getOwnedProfile(env.DB,ctx.workspaceId,String(body.profileId||""));
      if(!profile)return json({ok:false,error:"Brand Profile not found."},404);
      await setLegacyActive(env.DB,ctx.workspaceId,profile);
      return json({ok:true,profile});
    }
    const id=String(body.profileId||"");
    if(body.action==="metadata") {
      if(!id)return json({ok:false,error:"Choose a Brand Profile first."},400);
      if(!validObject(body.metadata))return json({ok:false,error:"Metadata template must be an object."},400);
      const metadataJson=JSON.stringify(body.metadata);
      if(metadataJson.length>8000)return json({ok:false,error:"Metadata template is too large."},413);
      const result=await env.DB.prepare("UPDATE workspace_brand_profiles SET metadata_config_json=?,updated_at=datetime('now') WHERE workspace_id=? AND id=?")
        .bind(metadataJson,ctx.workspaceId,id).run();
      if(!result.meta?.changes)return json({ok:false,error:"Brand Profile not found."},404);
      const profile=await getOwnedProfile(env.DB,ctx.workspaceId,id);
      return json({ok:true,profile});
    }
    const name=String(body.name||"My Brand").trim().slice(0,40)||"My Brand";
    if(!validObject(body.subtitle)||!validObject(body.watermark))return json({ok:false,error:"Subtitle and watermark settings are required."},400);
    const subtitleJson=JSON.stringify(body.subtitle),watermarkJson=JSON.stringify(body.watermark);
    if(subtitleJson.length>12000||watermarkJson.length>3000)return json({ok:false,error:"Brand Profile settings are too large."},413);
    let metadata={};
    if(id) {
      const existing=await getOwnedProfile(env.DB,ctx.workspaceId,id);
      if(!existing)return json({ok:false,error:"Brand Profile not found."},404);
      metadata=validObject(body.metadata)?body.metadata:existing.metadata;
      const metadataJson=JSON.stringify(metadata);
      if(metadataJson.length>8000)return json({ok:false,error:"Metadata template is too large."},413);
      await env.DB.prepare("UPDATE workspace_brand_profiles SET profile_name=?,subtitle_config_json=?,watermark_config_json=?,metadata_config_json=?,updated_at=datetime('now') WHERE workspace_id=? AND id=?")
        .bind(name,subtitleJson,watermarkJson,metadataJson,ctx.workspaceId,id).run();
    } else {
      id=crypto.randomUUID();
      metadata=validObject(body.metadata)?body.metadata:{};
      await env.DB.prepare("INSERT INTO workspace_brand_profiles (id,workspace_id,profile_name,subtitle_config_json,watermark_config_json,metadata_config_json) VALUES (?,?,?,?,?,?)")
        .bind(id,ctx.workspaceId,name,subtitleJson,watermarkJson,JSON.stringify(metadata)).run();
    }
    const profile={id,name,subtitle:body.subtitle,watermark:body.watermark,metadata};
    await setLegacyActive(env.DB,ctx.workspaceId,profile);
    return json({ok:true,profile});
  } catch(error) {
    console.error("brand_profile_save_failed",error);
    return json({ok:false,error:"Could not save Brand Profile. Check migrations 0016 and 0017."},503);
  }
}
export async function onRequestDelete({request,env}) {
  const ctx=await context(request,env);
  if(ctx.response)return ctx.response;
  const id=new URL(request.url).searchParams.get("profileId")||"";
  if(!id)return json({ok:false,error:"Profile ID is required."},400);
  try {
    const row=await env.DB.prepare("SELECT id FROM workspace_brand_profiles WHERE workspace_id=? AND id=?").bind(ctx.workspaceId,id).first();
    if(!row)return json({ok:false,error:"Brand Profile not found."},404);
    const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM workspace_brand_profiles WHERE workspace_id=?").bind(ctx.workspaceId).first();
    if(Number(count?.total||0)<=1)return json({ok:false,error:"Keep at least one Brand Profile. Create another before deleting this one."},409);
    await env.DB.prepare("DELETE FROM workspace_brand_profiles WHERE workspace_id=? AND id=?").bind(ctx.workspaceId,id).run();
    const active=await env.DB.prepare("SELECT id,profile_name,subtitle_config_json,watermark_config_json,metadata_config_json,updated_at FROM workspace_brand_profiles WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 1").bind(ctx.workspaceId).first();
    const profile=shape(active);
    await setLegacyActive(env.DB,ctx.workspaceId,profile);
    return json({ok:true,activeProfile:profile});
  } catch(error) {
    console.error("brand_profile_delete_failed",error);
    return json({ok:false,error:"Could not delete Brand Profile."},503);
  }
}
