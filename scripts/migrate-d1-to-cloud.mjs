// 一次性迁移：把本地 D1（.wrangler/state）里的批次搬到 WorkBuddy 云数据库。
// 幂等：云端已有同 id 的批次会跳过。
// 用法：CLOUD_ENDPOINT=... CLOUD_KEY=... node scripts/migrate-d1-to-cloud.mjs [sqlite路径]
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { createWorkBuddyCloud, createMemoryStorage } from '@tencent-ai/workbuddy-cloud-sdk';

const endpoint = process.env.CLOUD_ENDPOINT;
const publishableKey = process.env.CLOUD_KEY;
if (!endpoint || !publishableKey) throw new Error('CLOUD_ENDPOINT / CLOUD_KEY required');

const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const sqlite = process.argv[2] ||
  readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .map((f) => `${dir}/${f}`)[0];
if (!sqlite) throw new Error('未找到本地 D1 sqlite 文件');

const local = new DatabaseSync(sqlite, { readOnly: true });
const heads = local.prepare('SELECT id,version,summary,created_at FROM monitor_heads').all();
const chunkStmt = local.prepare('SELECT batch_id,version,ordinal,payload FROM monitor_chunks WHERE batch_id=? AND version=? ORDER BY ordinal');

const db = createWorkBuddyCloud({ endpoint, publishableKey, storage: createMemoryStorage() }).database;
const existing = new Set((await db.from('monitor_batches').select('id').limit(1000)).data?.map((r) => r.id) ?? []);

let migrated = 0, skipped = 0;
for (const head of heads) {
  if (existing.has(head.id)) { skipped++; continue; }
  const rows = chunkStmt.all(head.id, head.version);
  if (!rows.length) { skipped++; continue; }
  const doc = JSON.parse(rows.map((r) => r.payload).join(''));
  const { error } = await db.from('monitor_batches').insert({
    id: head.id, version: head.version, summary: JSON.parse(head.summary), doc,
    created_at: head.created_at, updated_at: new Date().toISOString(),
  });
  if (error) { console.error(`批次 ${head.id} 迁移失败:`, error.code || error.message); continue; }
  migrated++;
  console.log(`已迁移 ${head.id}（${doc.batch?.name ?? ''}）`);
}
console.log(`完成：迁移 ${migrated}，跳过 ${skipped}（云端已存在或无分片）`);
