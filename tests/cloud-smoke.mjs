// 云服务连通性冒烟：Node 侧直接调数据面，验证 publishableKey + 表可访问。
// 用法：CLOUD_ENDPOINT=... CLOUD_KEY=... node tests/cloud-smoke.mjs
import { createWorkBuddyCloud, createMemoryStorage } from '@tencent-ai/workbuddy-cloud-sdk';

const endpoint = process.env.CLOUD_ENDPOINT;
const publishableKey = process.env.CLOUD_KEY;
if (!endpoint || !publishableKey) throw new Error('CLOUD_ENDPOINT / CLOUD_KEY required');

const cloud = createWorkBuddyCloud({ endpoint, publishableKey, storage: createMemoryStorage() });

const { data, error } = await cloud.database.from('monitor_heads').select('*').limit(1);
console.log('data:', JSON.stringify(data));
console.log('error:', error ? JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint }) : null);
