import { ensure, uid } from './domain.mjs';
import { cloudClient, unwrap } from './cloud-client';

// Each batch is one document row in the cloud database. `version` owns the row and
// is swapped with a compare-and-swap update, so two devices saving at the same time
// cannot silently overwrite each other (the loser gets 409 and has to refresh).
export function cloudStore(config: any) {
  const db: any = cloudClient(config).database;
  return {
    async list() {
      const rows = unwrap<any[]>(
        await db.from('monitor_batches').select('summary').order('created_at', { ascending: false }).order('id', { ascending: false }),
      );
      return rows.map((row) => row.summary);
    },
    async get(id: string) {
      const rows = unwrap<any[]>(await db.from('monitor_batches').select('version,doc').eq('id', id).limit(1));
      return rows.length ? { doc: rows[0].doc, version: rows[0].version } : null;
    },
    async create(doc: any, summary: any) {
      ensure(JSON.stringify(doc).length <= 12000000, '批次过大，请导出备份后新建批次');
      const version = uid();
      unwrap(
        await db.from('monitor_batches').insert({
          id: doc.batch.id,
          version,
          summary,
          doc,
          created_at: doc.batch.created_at,
          updated_at: new Date().toISOString(),
        }),
      );
    },
    async save(doc: any, oldVersion: string, summary: any) {
      ensure(JSON.stringify(doc).length <= 12000000, '批次过大，请导出备份后新建批次');
      const version = uid();
      // Conditional update: only the row still carrying oldVersion changes hands.
      const rows = unwrap<any[]>(
        await db
          .from('monitor_batches')
          .update({ doc, version, summary, updated_at: new Date().toISOString() })
          .eq('id', doc.batch.id)
          .eq('version', oldVersion)
          .select('id'),
      );
      ensure(Array.isArray(rows) && rows.length === 1, '此批次刚被另一个窗口修改，请刷新后重新操作。', 409);
    },
  };
}
