import { json } from "../_lib/auth.js";
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
async function encrypt(value,secret){
 const raw=Uint8Array.from(atob(secret.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
 if(raw.length!==32)throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
 const key=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));
 return b64(iv)+"."+b64(cipher);
}
export async function onRequestGet({request,env}){
 const url=new URL(request.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),oauthError=url.searchParams.get("error");
 const base=url.origin;
 if(oauthError)return Response.redirect(base+"/?youtube=denied",302);
 if(!code||!state||!env.DB||!env.YOUTUBE_CLIENT_ID||!env.YOUTUBE_CLIENT_SECRET||!env.YOUTUBE_REDIRECT_URI||!env.YOUTUBE_TOKEN_ENCRYPTION_KEY)return Response.redirect(base+"/?youtube=setup-error",302);
 try{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(state))),x=>x.toString(16).padStart(2,"0")).join("");
  const saved=await env.DB.prepare("SELECT * FROM youtube_oauth_states WHERE state_hash=? AND expires_at>?").bind(hash,new Date().toISOString()).first();
  await env.DB.prepare("DELETE FROM youtube_oauth_states WHERE state_hash=?").bind(hash).run();
  if(!saved||saved.redirect_uri!==env.YOUTUBE_REDIRECT_URI)return Response.redirect(base+"/?youtube=invalid-state",302);
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,redirect_uri:saved.redirect_uri,grant_type:"authorization_code",code_verifier:saved.code_verifier})});
  const tokens=await tokenResponse.json();if(!tokenResponse.ok||!tokens.access_token)throw new Error(tokens.error_description||tokens.error||"Google token exchange failed.");
  const channelResponse=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{Authorization:"Bearer "+tokens.access_token}});
  const channelData=await channelResponse.json();const channel=channelData.items?.[0];if(!channel)throw new Error("No YouTube channel was returned for this Google account.");
  const refresh=tokens.refresh_token;if(!refresh)throw new Error("Google did not return a refresh token. Revoke ShortsFlow access in Google Account permissions and reconnect with consent.");
  const encrypted=await encrypt(refresh,env.YOUTUBE_TOKEN_ENCRYPTION_KEY),now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO youtube_connections (id,workspace_id,channel_id,channel_title,channel_thumbnail_url,refresh_token_encrypted,access_token_expires_at,scopes,connected_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET channel_id=excluded.channel_id,channel_title=excluded.channel_title,channel_thumbnail_url=excluded.channel_thumbnail_url,refresh_token_encrypted=excluded.refresh_token_encrypted,access_token_encrypted=NULL,access_token_expires_at=NULL,scopes=excluded.scopes,updated_at=excluded.updated_at`)
   .bind(crypto.randomUUID(),saved.workspace_id,channel.id,channel.snippet?.title||"YouTube channel",channel.snippet?.thumbnails?.default?.url||null,encrypted,null,tokens.scope||"",now,now).run();
  return Response.redirect(base+"/?youtube=connected",302);
 }catch(error){console.error("youtube_oauth_callback",error);return Response.redirect(base+"/?youtube=error",302);}
}