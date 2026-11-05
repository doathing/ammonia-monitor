import { createWorkBuddyCloud, createMemoryStorage } from '@tencent-ai/workbuddy-cloud-sdk';

// The worker is the only caller of the data plane: the publishable key stays in
// server-side env (.dev.vars) and is never shipped to the browser. The app's own
// password session + role check stay the authorization boundary.
let cached: ReturnType<typeof createWorkBuddyCloud> | null = null;

export function cloudClient(config: any) {
  const endpoint = String(config?.CLOUD_ENDPOINT || '');
  const publishableKey = String(config?.CLOUD_PUBLISHABLE_KEY || '');
  if (!endpoint || !publishableKey) throw Object.assign(new Error('云服务尚未配置，请联系管理员。'), { status: 503 });
  if (!cached) {
    cached = createWorkBuddyCloud({ endpoint, publishableKey, storage: createMemoryStorage() });
  }
  return cached;
}

const MESSAGES: Record<string, string> = {
  '42P01': '云端数据表尚未初始化，请联系管理员。',
  '42501': '云端数据权限不足，请联系管理员。',
  '23505': '记录已存在，请刷新后重试。',
};

export function unwrap<T>(result: { data: any; error: any }): T {
  const { data, error } = result;
  if (error) {
    const code = String((error as any)?.code || '');
    const wrapped: any = new Error(MESSAGES[code] || '云端数据服务暂不可用，请稍后重试。');
    wrapped.status = 503;
    wrapped.detail = code || (error as any)?.message;
    throw wrapped;
  }
  return data as T;
}

// Login throttling lives in the cloud too, so it survives redeploys. Read-then-write
// is enough here: a lost race costs at most one extra counted attempt.
export async function bumpLoginAttempt(config: any, key: string, windowStart: number): Promise<number> {
  const db: any = cloudClient(config).database;
  for (let round = 0; round < 2; round++) {
    const rows = unwrap<any[]>(await db.from('monitor_login_attempts').select('window_start,attempts').eq('key', key).limit(1));
    if (!rows.length) {
      const inserted = await db.from('monitor_login_attempts').insert({ key, window_start: windowStart, attempts: 1 });
      if (!inserted.error) return 1;
      continue;
    }
    const attempts = Number(rows[0].window_start) === windowStart ? Number(rows[0].attempts) + 1 : 1;
    unwrap(await db.from('monitor_login_attempts').update({ window_start: windowStart, attempts }).eq('key', key));
    return attempts;
  }
  throw Object.assign(new Error('云端数据服务暂不可用，请稍后重试。'), { status: 503 });
}

export async function clearLoginAttempts(config: any, key: string): Promise<void> {
  const db: any = cloudClient(config).database;
  const { error } = await db.from('monitor_login_attempts').delete().eq('key', key);
  if (error) console.error('Login attempt cleanup failed', (error as any)?.code);
}
