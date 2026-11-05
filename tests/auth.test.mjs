import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticate,issueSession,readSession,sessionCookie,sameOrigin} from '../lib/monitor/auth.mjs';
const b64=b=>Buffer.from(b).toString('base64url');
const password='test-password-only';
const salt=crypto.getRandomValues(new Uint8Array(16));
const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
const hash='100000:'+b64(salt)+':'+b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},material,256));
const config={MONITOR_ADMIN_HASH:hash,MONITOR_GUEST_HASH:hash,MONITOR_SESSION_SECRET:b64(crypto.getRandomValues(new Uint8Array(48)))};
test('valid usernames receive the correct role; invalid credentials reveal neither account nor hash',async()=>{
  assert.deepEqual(await authenticate('guest',password,config),{username:'guest',role:'viewer'});
  assert.deepEqual(await authenticate('admin',password,config),{username:'admin',role:'editor'});
  assert.equal(await authenticate('guest','wrong',config),null);
  assert.equal(await authenticate('unknown',password,config),null);
  assert.equal(await authenticate('admin','x'.repeat(257),config),null);
});
test('signed sessions enforce role, expiration and secret rotation',async()=>{
  const at=Date.now(),token=await issueSession({username:'guest',role:'viewer'},config,at);
  const req=t=>new Request('https://monitor.test/',{headers:{cookie:'ammonia_session='+t}});
  assert.deepEqual(await readSession(req(token),config,at),{username:'guest',role:'viewer',canEdit:false});
  const [body,signature]=token.split('.');const forged=b64(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url')),username:'admin',role:'editor'}));
  assert.equal(await readSession(req(forged+'.'+signature),config,at),null);
  assert.equal(await readSession(req(token),config,at+8*3600000),null);
  assert.equal(await readSession(req(token),{...config,MONITOR_SESSION_SECRET:'different-secret'},at),null);
  assert.equal(await readSession(new Request('https://monitor.test/'),config,at),null);
});
test('cookies are HttpOnly, secure on HTTPS, same-site, expiring and removable',()=>{
  const req=new Request('https://monitor.test/');const cookie=sessionCookie('signed-token',req);
  for(const expected of ['HttpOnly','SameSite=Strict','Secure','Max-Age=28800','Path=/'])assert(cookie.includes(expected));
  assert(sessionCookie('',req).includes('Max-Age=0'));
  assert(!sameOrigin(new Request('https://monitor.test/api/session/login',{headers:{origin:'https://other.test'}})));
});
