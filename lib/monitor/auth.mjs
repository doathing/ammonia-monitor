const encoder=new TextEncoder();
export const COOKIE='ammonia_session';
const lifetime=8*3600;
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function signingKey(config){if(!config.MONITOR_SESSION_SECRET)throw new Error('Login is not configured');return crypto.subtle.importKey('raw',encoder.encode(config.MONITOR_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function passwordMatches(password,encoded){
  if(typeof password!=='string'||password.length>256||!encoded)return false;
  try{const [iterations,salt,expected]=encoded.split(':');if(Number(iterations)!==100000)return false;
    const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
    const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(salt),iterations:100000,hash:'SHA-256'},key,256);
    // WebCrypto verify provides constant-time comparison without exposing hashes.
    const compare=await crypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
    const expectedKey=await crypto.subtle.importKey('raw',unb64(expected),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const message=encoder.encode('ammonia-password-check');
    return crypto.subtle.verify('HMAC',compare,await crypto.subtle.sign('HMAC',expectedKey,message),message);
  }catch{return false;}
}
export async function authenticate(username,password,config){
  const known=username==='admin'||username==='guest';
  const encoded=username==='admin'?config.MONITOR_ADMIN_HASH:config.MONITOR_GUEST_HASH;
  const valid=await passwordMatches(password,known?encoded:config.MONITOR_GUEST_HASH);
  return known&&valid?{username,role:username==='admin'?'editor':'viewer'}:null;
}
export async function issueSession(user,config,at=Date.now()){
  const body=b64(encoder.encode(JSON.stringify({...user,exp:Math.floor(at/1000)+lifetime,nonce:crypto.randomUUID()})));
  return body+'.'+b64(await crypto.subtle.sign('HMAC',await signingKey(config),encoder.encode(body)));
}
export async function readSession(request,config,at=Date.now()){
  try{const cookie=request.headers.get('cookie')||'',token=cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if(!token||token.length>2048)return null;const [body,signature,...extra]=token.split('.');if(extra.length||!signature)return null;
    if(!await crypto.subtle.verify('HMAC',await signingKey(config),unb64(signature),encoder.encode(body)))return null;
    const user=JSON.parse(new TextDecoder().decode(unb64(body)));
    if(!['admin','guest'].includes(user.username)||user.role!==(user.username==='admin'?'editor':'viewer')||!Number.isFinite(user.exp)||user.exp<=Math.floor(at/1000))return null;
    return {username:user.username,role:user.role,canEdit:user.role==='editor'};
  }catch{return null;}
}
function publicOrigins(config){
  return String(config?.MONITOR_PUBLIC_ORIGIN||'').split(',').map(s=>s.trim().replace(/\/+$/,'')).filter(Boolean);
}
export function sessionCookie(token,request,config){
  const secure=new URL(request.url).protocol==='https:'||publicOrigins(config).some(o=>o.startsWith('https:'));
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?lifetime:0}${secure?'; Secure':''}`;
}
// Reverse proxies terminate TLS and rewrite the request URL to their internal
// address, so the public origin is configured explicitly instead of inferred.
export function sameOrigin(request,config){
  const origin=request.headers.get('origin');
  if(!origin)return true;
  const normalized=origin.replace(/\/+$/,'');
  if(normalized===new URL(request.url).origin)return true;
  return publicOrigins(config).includes(normalized);
}
export async function rateKey(request,username){const ip=request.headers.get('cf-connecting-ip')||'unknown';const digest=await crypto.subtle.digest('SHA-256',encoder.encode(ip+'|'+username));return b64(digest);}
