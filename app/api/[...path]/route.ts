import { handle } from '../../../lib/monitor/service.mjs';
import { cloudStore } from '../../../lib/monitor/storage';
import { bumpLoginAttempt, clearLoginAttempts } from '../../../lib/monitor/cloud-client';
import { files } from '../../../lib/monitor/files.mjs';
import { restrictBatchStore } from '../../../lib/monitor/batch-access.mjs';
import { env } from 'cloudflare:workers';
import {authenticate,issueSession,readSession,sessionCookie,sameOrigin,rateKey} from '../../../lib/monitor/auth.mjs';
export const dynamic='force-dynamic';
async function api(request:Request){
  const path=new URL(request.url).pathname;
  const response=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
  if(request.method!=='GET'&&!sameOrigin(request,env))return response({detail:'不接受其他网站的操作请求。'},403);
  if(path==='/api/session/login'&&request.method==='POST'){
    if(Number(request.headers.get('content-length')||0)>2048)return response({detail:'登录请求过大。'},413);
    try{
      const raw=await request.text();if(raw.length>2048)return response({detail:'登录请求过大。'},413);
      const {username,password}=JSON.parse(raw);
      if(typeof username!=='string'||username.length>64||typeof password!=='string'||password.length>256)return response({detail:'账号或密码错误。'},401);
      if(!env.CLOUD_ENDPOINT||!env.CLOUD_PUBLISHABLE_KEY||!env.MONITOR_SESSION_SECRET||!env.MONITOR_ADMIN_HASH||!env.MONITOR_GUEST_HASH)return response({detail:'登录服务尚未配置，请联系管理员。'},503);
      const key=await rateKey(request,username==='admin'?'admin':username==='guest'?'guest':'other'),stamp=Math.floor(Date.now()/600000);
      let attempts:number;
      try{attempts=await bumpLoginAttempt(env,key,stamp);}catch{return response({detail:'云端登录限流暂不可用，请稍后重试。'},503);}
      if(attempts>10)return response({detail:'登录尝试过于频繁，请10分钟后再试。'},429,{'Retry-After':'600'});
      const user=await authenticate(username,password,env);
      if(!user)return response({detail:'账号或密码错误。'},401);
      await clearLoginAttempts(env,key);
      const token=await issueSession(user,env);
      return response({username:user.username,role:user.role,canEdit:user.role==='editor'},200,{'Set-Cookie':sessionCookie(token,request,env)});
    }catch{return response({detail:'登录请求无效或服务暂不可用。'},400);}
  }
  if(path==='/api/session/logout'&&request.method==='POST')return response({ok:true},200,{'Set-Cookie':sessionCookie('',request,env)});
  const user=await readSession(request,env);
  if(!user)return response({detail:'登录已过期或尚未登录，请重新登录。'},401);
  if(path==='/api/session/me'&&request.method==='GET')return response(user);
  if(request.method!=='GET'&&!user.canEdit)return response({detail:'当前账号只有查看权限，不能录入或修改数据。'},403);
  const length=Number(request.headers.get('content-length')||0);
  if(length>12*1024*1024)return Response.json({detail:'请求不能超过12MB。'},{status:413});
  return handle(request,restrictBatchStore(cloudStore(env),user,env.MONITOR_GUEST_BATCH_ID),files);
}
export {api as GET,api as POST,api as PUT,api as DELETE};
