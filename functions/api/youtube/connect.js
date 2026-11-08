import { json, getSessionUser } from "../_lib/auth.js";
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
export async function onRequestGet({request,env}){
 const user=await getSessionUser(request,env);if(!user?.workspace?.id)return json({ok:false,error:"Authentication required."},401);
 if(!env.YOUTUBE_CLIENT_ID||!env.YOUTUBE_REDIRECT_URI)return json({ok:false,error:"YouTube OAuth is not configured yet. Add YOUTUBE_CLIENT_ID and YOUTUBE_REDIRECT_URI first."},503);
 const origin=new URL(request.url).origin;
 if(!env.YOUTUBE_REDIRECT_URI.startsWith(origin+"/"))return json({ok:false,error:"The configured OAuth redirect URI must use this ShortsFlow domain."},503);
 const state=b64(crypto.getRandomValues(new Uint8Array(32))),verifier=b64(crypto.getRandomValues(new Uint8Array(48)));
 const challenge=b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
 const stateHash=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(state)));
 const now=new Date(),expires=new Date(now.getTime()+10*60*1000).toISOString();
 await env.DB.prepare("INSERT INTO youtube_oauth_states (state_hash,workspace_id,code_verifier,redirect_uri,expires_at,created_at) VALUES (?,?,?,?,?,?)").bind(stateHash,user.workspace.id,verifier,env.YOUTUBE_REDIRECT_URI,expires,now.toISOString()).run();
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 for(const [k,v] of Object.entries({client_id:env.YOUTUBE_CLIENT_ID,redirect_uri:env.YOUTUBE_REDIRECT_URI,response_type:"code",scope:"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",access_type:"offline",prompt:"consent",include_granted_scopes:"true",state,code_challenge:challenge,code_challenge_method:"S256"}))url.searchParams.set(k,v);
 return Response.redirect(url.toString(),302);
}