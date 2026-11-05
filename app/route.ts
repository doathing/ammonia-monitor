import html from '../lib/monitor/index.html?raw';
import login from '../lib/monitor/login.html?raw';
import {env} from 'cloudflare:workers';
import {readSession} from '../lib/monitor/auth.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const user=await readSession(request,env);
  return new Response(user?html:login,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
}
