import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  foreignKey,
  check,
} from 'drizzle-orm/sqlite-core';

// ── Core tables ────────────────────────────────────────────────────────────

export const files = sqliteTable(
  'files',
  {
    project: text('project').notNull(),
    filePath: text('file_path').notNull(),
    mtimeMs: real('mtime_ms').notNull(),
    size: integer('size').notNull(),
    contentHash: text('content_hash').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.project, table.filePath] })],
);

export const symbols = sqliteTable(
  'symbols',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').notNull(),
    filePath: text('file_path').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    startLine: integer('start_line').notNull(),
    startColumn: integer('start_column').notNull(),
    endLine: integer('end_line').notNull(),
    endColumn: integer('end_column').notNull(),
    isExported: integer('is_exported').notNull().default(0),
    signature: text('signature'),
    fingerprint: text('fingerprint'),
    detailJson: text('detail_json'),
    contentHash: text('content_hash').notNull(),
    indexedAt: text('indexed_at').notNull(),
  },
  (table) => [
    index('idx_symbols_project_file').on(table.project, table.filePath),
    index('idx_symbols_project_kind').on(table.project, table.kind),
    index('idx_symbols_project_name').on(table.project, table.name),
    index('idx_symbols_fingerprint').on(table.project, table.fingerprint),
    foreignKey({
      columns: [table.project, table.filePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
  ],
);

export const relations = sqliteTable(
  'relations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').notNull(),
    type: text('type').notNull(),
    srcFilePath: text('src_file_path').notNull(),
    srcSymbolName: text('src_symbol_name'),
    dstFilePath: text('dst_file_path').notNull(),
    dstSymbolName: text('dst_symbol_name'),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_relations_src').on(table.project, table.srcFilePath),
    index('idx_relations_dst').on(table.project, table.dstFilePath),
    index('idx_relations_type').on(table.project, table.type),
    foreignKey({
      columns: [table.project, table.srcFilePath],
      foreignColumns: [files.project, files.filePath],
    }).onDelete('cascade'),
  ],
);

export const watcherOwner = sqliteTable(
  'watcher_owner',
  {
    id: integer('id').primaryKey(),
    pid: integer('pid').notNull(),
    startedAt: text('started_at').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
  },
  (table) => [check('watcher_owner_singleton', sql`${table.id} = 1`)],
);

// ── FTS5 (drizzle cannot define virtual tables — raw SQL required) ─────────

/**
 * Raw SQL statements for FTS5 virtual table and synchronisation triggers.
 * These are applied after drizzle migrations since drizzle has no virtual table support.
 */
export const FTS_SETUP_SQL: readonly string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
     name,
     file_path,
     kind,
     content=symbols,
     content_rowid=id
   )`,

  `CREATE TRIGGER IF NOT EXISTS symbols_ai
   AFTER INSERT ON symbols BEGIN
     INSERT INTO symbols_fts(rowid, name, file_path, kind)
     VALUES (new.id, new.name, new.file_path, new.kind);
   END`,

  `CREATE TRIGGER IF NOT EXISTS symbols_ad
   AFTER DELETE ON symbols BEGIN
     INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path, kind)
     VALUES ('delete', old.id, old.name, old.file_path, old.kind);
   END`,

  `CREATE TRIGGER IF NOT EXISTS symbols_au
   AFTER UPDATE ON symbols BEGIN
     INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path, kind)
     VALUES ('delete', old.id, old.name, old.file_path, old.kind);
     INSERT INTO symbols_fts(rowid, name, file_path, kind)
     VALUES (new.id, new.name, new.file_path, new.kind);
   END`,
];
