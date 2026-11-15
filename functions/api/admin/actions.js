import { json, getSessionUser, readJson } from "../_lib/auth.js";

const UUID = /^[0-9a-f-]{36}$/i;
const ACTIONS = new Set(["suspend_member","activate_member","retry_job","cancel_job","set_autopilot"]);

export async function onRequestPost({request,env}) {
  if (!env.DB) return json({ok:false,error:"Database is not configured."},503);
  const admin=await getSessionUser(request,env);
  if (!admin) return json({ok:false,error:"Authentication required."},401);
  if (admin.systemRole !== "admin") return json({ok:false,error:"Global administrator access is required."},403);
  const body=await readJson(request);
  if (!body || !ACTIONS.has(body.action)) return json({ok:false,error:"Unsupported admin action."},400);
  const now=new Date().toISOString();
  const db=env.DB;
  try {
    let targetType="", targetId="", details={};
    if (body.action==="suspend_member" || body.action==="activate_member") {
      const id=String(body.userId||"");
      if (!UUID.test(id)) return json({ok:false,error:"Invalid member ID."},400);
      if (id===admin.id) return json({ok:false,error:"You cannot change your own account status here."},409);
      const target=await db.prepare("SELECT id,email,status,system_role FROM users WHERE id=?").bind(id).first();
      if (!target) return json({ok:false,error:"Member not found."},404);
      if (target.system_role==="admin") return json({ok:false,error:"Global administrator accounts cannot be changed from member management."},403);
      const status=body.action==="suspend_member"?"suspended":"active";
      const result=await db.prepare("UPDATE users SET status=?,updated_at=? WHERE id=? AND system_role='member' AND status<>?").bind(status,now,id,status).run();
      if (!result.meta?.changes) return json({ok:true,status:target.status});
      targetType="member";targetId=id;details={email:target.email,status};
    } else if (body.action==="retry_job" || body.action==="cancel_job") {
      const id=String(body.jobId||""), type=String(body.jobType||"");
      if (!UUID.test(id) || !["processing","render"].includes(type)) return json({ok:false,error:"Invalid job reference."},400);
      const cancel=body.action==="cancel_job";
      if(type==="processing") {
        const job=await db.prepare("SELECT id,workspace_id,status,attempts FROM processing_jobs WHERE id=?").bind(id).first();
        if(!job)return json({ok:false,error:"Processing job not found."},404);
        if(cancel && job.status!=="queued")return json({ok:false,error:"Only queued jobs can be cancelled safely."},409);
        if(!cancel && job.status!=="failed")return json({ok:false,error:"Only failed jobs can be retried."},409);
        const result=cancel
          ? await db.prepare("UPDATE processing_jobs SET status='cancelled',updated_at=?,completed_at=?,locked_until=NULL,locked_by=NULL WHERE id=? AND status='queued'").bind(now,now,id).run()
          : await db.prepare("UPDATE processing_jobs SET status='queued',attempts=0,available_at=?,updated_at=?,completed_at=NULL,locked_until=NULL,locked_by=NULL,last_error=NULL,result_json=NULL WHERE id=? AND status='failed' AND NOT EXISTS(SELECT 1 FROM processing_jobs p WHERE p.workspace_id=processing_jobs.workspace_id AND p.source_video_id=processing_jobs.source_video_id AND p.job_type=processing_jobs.job_type AND p.status IN ('queued','claimed','running'))").bind(now,now,id).run();
        if(!result.meta?.changes)return json({ok:false,error:"Job changed or an active duplicate exists. Refresh the queue."},409);
        targetType="processing_job";targetId=id;details={workspaceId:job.workspace_id,action:body.action,previousStatus:job.status};
      } else {
        const job=await db.prepare("SELECT id,workspace_id,clip_id,status,attempts FROM clip_render_jobs WHERE id=?").bind(id).first();
        if(!job)return json({ok:false,error:"Render job not found."},404);
        if(cancel && job.status!=="queued")return json({ok:false,error:"Only queued render jobs can be cancelled safely."},409);
        if(!cancel && job.status!=="failed")return json({ok:false,error:"Only failed render jobs can be retried."},409);
        const result=cancel
          ? await db.prepare("UPDATE clip_render_jobs SET status='cancelled',updated_at=?,completed_at=? WHERE id=? AND status='queued'").bind(now,now,id).run()
          : await db.prepare("UPDATE clip_render_jobs SET status='queued',attempts=0,updated_at=?,completed_at=NULL,runner_id=NULL,locked_until=NULL,last_error=NULL WHERE id=? AND status='failed' AND NOT EXISTS(SELECT 1 FROM clip_render_jobs x WHERE x.clip_id=clip_render_jobs.clip_id AND x.metadata_version=clip_render_jobs.metadata_version AND x.status IN ('queued','running'))").bind(now,id).run();
        if(!result.meta?.changes)return json({ok:false,error:"Render job changed or an active duplicate exists. Refresh the queue."},409);
        if(!cancel) await db.prepare("UPDATE clips SET status='rendering',updated_at=? WHERE id=?").bind(now,job.clip_id).run();
        targetType="render_job";targetId=id;details={workspaceId:job.workspace_id,clipId:job.clip_id,action:body.action,previousStatus:job.status};
      }
    } else {
      const workspaceId=String(body.workspaceId||"");
      if(!UUID.test(workspaceId) || typeof body.enabled!=="boolean")return json({ok:false,error:"Invalid workspace or autopilot setting."},400);
      const workspace=await db.prepare("SELECT id FROM workspaces WHERE id=?").bind(workspaceId).first();
      if(!workspace)return json({ok:false,error:"Workspace not found."},404);
      await db.prepare(`INSERT INTO autopilot_settings(workspace_id,enabled,daily_target,voice_language,subtitle_language,privacy_status,watermark_enabled,watermark_text,timezone,created_at,updated_at)
        VALUES(?,?,3,'en','id','private',1,'@ShortsFlow','Asia/Kuala_Lumpur',?,?)
        ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`)
        .bind(workspaceId,body.enabled?1:0,now,now).run();
      targetType="workspace_autopilot";targetId=workspaceId;details={enabled:body.enabled};
    }
    await db.prepare("INSERT INTO admin_audit_logs(id,admin_user_id,action,target_type,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),admin.id,body.action,targetType,targetId,JSON.stringify(details),now).run();
    return json({ok:true,action:body.action,targetId,updatedAt:now});
  } catch(error) {
    console.error("admin_action_failed",error);
    return json({ok:false,error:"Admin action failed. Refresh and try again."},503);
  }
}
