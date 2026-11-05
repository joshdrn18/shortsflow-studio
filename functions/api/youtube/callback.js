import { json } from "../_lib/auth.js";
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const safeCode=value=>String(value||"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,60)||"unknown";
function redirect(base,reason){const target=new URL("/",base);target.searchParams.set("youtube",reason==="denied"?"denied":"error");if(reason&&reason!=="denied")target.searchParams.set("reason",reason);return Response.redirect(target.toString(),302);}
async function encrypt(value,secret){
 const normalized=secret.replace(/-/g,"+").replace(/_/g,"/"),padded=normalized+"=".repeat((4-normalized.length%4)%4);
 const raw=Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
 if(raw.length!==32)throw new Error("invalid_encryption_key");
 const key=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));
 return b64(iv)+"."+b64(cipher);
}
export async function onRequestGet({request,env}){
 const url=new URL(request.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),oauthError=url.searchParams.get("error");
 const base=url.origin;
 if(oauthError)return redirect(base,"denied");
 if(!code||!state||!env.DB||!env.YOUTUBE_CLIENT_ID||!env.YOUTUBE_CLIENT_SECRET||!env.YOUTUBE_REDIRECT_URI||!env.YOUTUBE_TOKEN_ENCRYPTION_KEY)return redirect(base,"setup");
 let stage="state";
 try{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(state))),x=>x.toString(16).padStart(2,"0")).join("");
  const saved=await env.DB.prepare("SELECT * FROM youtube_oauth_states WHERE state_hash=? AND expires_at>?").bind(hash,new Date().toISOString()).first();
  await env.DB.prepare("DELETE FROM youtube_oauth_states WHERE state_hash=?").bind(hash).run();
  if(!saved||saved.redirect_uri!==env.YOUTUBE_REDIRECT_URI)return redirect(base,"invalid-state");
  stage="token";
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,redirect_uri:saved.redirect_uri,grant_type:"authorization_code",code_verifier:saved.code_verifier})});
  const tokens=await tokenResponse.json();
  if(!tokenResponse.ok||!tokens.access_token){console.error("youtube_oauth_callback",{stage,status:tokenResponse.status,googleError:safeCode(tokens.error)});return redirect(base,"token");}
  stage="channel";
  const channelResponse=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{Authorization:"Bearer "+tokens.access_token}});
  const channelData=await channelResponse.json();
  if(!channelResponse.ok){const apiReason=channelData.error?.errors?.[0]?.reason;console.error("youtube_oauth_callback",{stage,status:channelResponse.status,googleError:safeCode(apiReason||channelData.error?.status)});return redirect(base,"channel-api");}
  const channel=channelData.items?.[0];
  if(!channel)return redirect(base,"no-channel");
  stage="refresh";
  const refresh=tokens.refresh_token;
  if(!refresh)return redirect(base,"no-refresh-token");
  stage="encryption";
  const encrypted=await encrypt(refresh,env.YOUTUBE_TOKEN_ENCRYPTION_KEY),now=new Date().toISOString();
  stage="database";
  await env.DB.prepare(`INSERT INTO youtube_connections (id,workspace_id,channel_id,channel_title,channel_thumbnail_url,refresh_token_encrypted,access_token_expires_at,scopes,connected_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET channel_id=excluded.channel_id,channel_title=excluded.channel_title,channel_thumbnail_url=excluded.channel_thumbnail_url,refresh_token_encrypted=excluded.refresh_token_encrypted,access_token_encrypted=NULL,access_token_expires_at=NULL,scopes=excluded.scopes,updated_at=excluded.updated_at`)
   .bind(crypto.randomUUID(),saved.workspace_id,channel.id,channel.snippet?.title||"YouTube channel",channel.snippet?.thumbnails?.default?.url||null,encrypted,null,tokens.scope||"",now,now).run();
  return Response.redirect(base+"/?youtube=connected",302);
 }catch(error){
  console.error("youtube_oauth_callback",{stage,error:safeCode(error?.message)});
  return redirect(base,stage==="token"?"token":stage==="channel"?"channel-api":stage==="refresh"?"no-refresh-token":stage==="encryption"?"encryption-key":stage==="database"?"database":"callback");
 }
}
