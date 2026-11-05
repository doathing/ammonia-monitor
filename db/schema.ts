// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const monitorHeads = sqliteTable('monitor_heads', {
  id: text('id').primaryKey(), version: text('version').notNull(),
  summary: text('summary').notNull(), createdAt: text('created_at').notNull(),
});
export const monitorChunks = sqliteTable('monitor_chunks', {
  batchId: text('batch_id').notNull(), version: text('version').notNull(),
  ordinal: integer('ordinal').notNull(), payload: text('payload').notNull(),
}, t => [primaryKey({columns:[t.batchId,t.version,t.ordinal]})]);
export const loginAttempts=sqliteTable('login_attempts',{
  key:text('key').primaryKey(),window:integer('window').notNull(),attempts:integer('attempts').notNull(),
});
