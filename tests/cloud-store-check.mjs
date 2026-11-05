// 云存储语义冒烟：验证 store 用到的每类 SQL 语义都能在云数据库上工作。
// 用法：CLOUD_ENDPOINT=... CLOUD_KEY=... node tests/cloud-store-check.mjs
import { createWorkBuddyCloud, createMemoryStorage } from '@tencent-ai/workbuddy-cloud-sdk';

const endpoint = process.env.CLOUD_ENDPOINT;
const publishableKey = process.env.CLOUD_KEY;
if (!endpoint || !publishableKey) throw new Error('CLOUD_ENDPOINT / CLOUD_KEY required');
const db = createWorkBuddyCloud({ endpoint, publishableKey, storage: createMemoryStorage() }).database;
const uid = () => crypto.randomUUID().replaceAll('-', '');
const unwrap = (r) => { if (r.error) throw Object.assign(new Error(JSON.stringify(r.error).slice(0, 300))); return r.data; };
const ok = (name) => console.log('ok -', name);

const id = 'smoke-' + uid();
try {
  // insert + read back
  const version1 = uid();
  unwrap(await db.from('monitor_batches').insert({ id, version: version1, summary: { name: '冒烟' }, doc: { batch: { id }, samples: [1, 2, 3] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  const read = unwrap(await db.from('monitor_batches').select('version,doc').eq('id', id).limit(1));
  if (read[0].version !== version1 || read[0].doc.samples.length !== 3) throw new Error('read back mismatch');
  ok('insert + read back');

  // CAS update (conditional on old version)
  const version2 = uid();
  const rows = unwrap(await db.from('monitor_batches').update({ doc: { batch: { id }, samples: [1, 2, 3, 4] }, version: version2, updated_at: new Date().toISOString() }).eq('id', id).eq('version', version1).select('id'));
  if (rows.length !== 1) throw new Error('CAS update should affect 1 row');
  ok('CAS update hits exactly 1 row');

  // stale version is rejected (0 rows) -> the app turns this into 409
  const stale = unwrap(await db.from('monitor_batches').update({ version: uid() }).eq('id', id).eq('version', version1).select('id'));
  if (stale.length !== 0) throw new Error('stale CAS should affect 0 rows');
  ok('stale version update returns 0 rows');

  // ordered list
  const list = unwrap(await db.from('monitor_batches').select('summary').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5));
  if (!Array.isArray(list)) throw new Error('list should be an array');
  ok('ordered list');

  // login throttle row
  const key = 'smoke:' + uid();
  unwrap(await db.from('monitor_login_attempts').insert({ key, window_start: 1, attempts: 1 }));
  unwrap(await db.from('monitor_login_attempts').update({ attempts: 2 }).eq('key', key));
  const attempt = unwrap(await db.from('monitor_login_attempts').select('attempts').eq('key', key).limit(1));
  if (attempt[0].attempts !== 2) throw new Error('attempt update mismatch');
  unwrap(await db.from('monitor_login_attempts').delete().eq('key', key));
  ok('login attempt upsert/clear');

  // large document (12MB upper bound the app enforces)
  const big = 'smoke-big-' + uid();
  const payload = 'x'.repeat(12 * 1024 * 1024);
  const t0 = Date.now();
  unwrap(await db.from('monitor_batches').insert({ id: big, version: uid(), summary: { name: '大文档' }, doc: { blob: payload }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  const got = unwrap(await db.from('monitor_batches').select('doc').eq('id', big).limit(1));
  if (got[0].doc.blob.length !== payload.length) throw new Error('large doc mismatch');
  ok(`12MB document insert+read (${Date.now() - t0}ms)`);
  unwrap(await db.from('monitor_batches').delete().eq('id', big));
} finally {
  unwrap(await db.from('monitor_batches').delete().eq('id', id));
  console.log('cleanup done');
}
