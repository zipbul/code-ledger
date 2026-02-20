import { eq, and, sql, count } from 'drizzle-orm';
import { symbols } from '../schema';
import type { DbConnection } from '../connection';

export interface SymbolRecord {
  project: string;
  filePath: string;
  kind: string;
  name: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isExported: number;
  signature: string | null;
  fingerprint: string | null;
  detailJson: string | null;
  contentHash: string;
  indexedAt: string;
}

export interface SearchOptions {
  kind?: string;
  limit?: number;
}

export interface SymbolStats {
  symbolCount: number;
  fileCount: number;
}

export class SymbolRepository {
  constructor(private readonly db: DbConnection) {}

  /**
   * Atomically replaces all symbols stored for `(project, filePath)`.
   * FTS5 is kept in sync via the `symbols_ai` / `symbols_ad` triggers.
   */
  replaceFileSymbols(
    project: string,
    filePath: string,
    contentHash: string,
    syms: ReadonlyArray<Partial<SymbolRecord>>,
  ): void {
    // Remove existing symbols (cascade-triggers remove FTS5 rows).
    this.db.drizzleDb
      .delete(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.filePath, filePath)))
      .run();

    if (!syms.length) return;

    const now = new Date().toISOString();
    for (const sym of syms) {
      this.db.drizzleDb.insert(symbols).values({
        project,
        filePath,
        kind: sym.kind ?? 'unknown',
        name: sym.name ?? '',
        startLine: sym.startLine ?? 0,
        startColumn: sym.startColumn ?? 0,
        endLine: sym.endLine ?? 0,
        endColumn: sym.endColumn ?? 0,
        isExported: sym.isExported ?? 0,
        signature: sym.signature ?? null,
        fingerprint: sym.fingerprint ?? null,
        detailJson: sym.detailJson ?? null,
        contentHash,
        indexedAt: sym.indexedAt ?? now,
      }).run();
    }
  }

  getFileSymbols(project: string, filePath: string): SymbolRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.filePath, filePath)))
      .all();
  }

  /**
   * Full-text prefix search on symbol names.
   * FTS5 queries require raw SQL — drizzle has no virtual table support.
   */
  searchByName(project: string, query: string, opts: SearchOptions = {}): SymbolRecord[] {
    const limit = opts.limit ?? 50;
    const ftsQuery = `${query.replace(/["*^()\-]/g, '\\$&')}*`;

    let builder = this.db.drizzleDb
      .select()
      .from(symbols)
      .where(
        and(
          sql`${symbols.id} IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ${ftsQuery})`,
          eq(symbols.project, project),
          opts.kind ? eq(symbols.kind, opts.kind) : undefined,
        ),
      )
      .orderBy(symbols.name)
      .limit(limit);

    return builder.all();
  }

  searchByKind(project: string, kind: string): SymbolRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.kind, kind)))
      .orderBy(symbols.name)
      .all();
  }

  getStats(project: string): SymbolStats {
    const row = this.db.drizzleDb
      .select({
        symbolCount: count(),
        fileCount: sql<number>`COUNT(DISTINCT ${symbols.filePath})`,
      })
      .from(symbols)
      .where(eq(symbols.project, project))
      .get();
    return {
      symbolCount: row?.symbolCount ?? 0,
      fileCount: row?.fileCount ?? 0,
    };
  }

  getByFingerprint(project: string, fingerprint: string): SymbolRecord[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.fingerprint, fingerprint)))
      .all();
  }

  deleteFileSymbols(project: string, filePath: string): void {
    this.db.drizzleDb
      .delete(symbols)
      .where(and(eq(symbols.project, project), eq(symbols.filePath, filePath)))
      .run();
  }

  /**
   * Flexible search across symbols with optional FTS5 full-text query and column filters.
   * Used by the search module's symbolSearch function.
   */
  searchByQuery(opts: {
    ftsQuery?: string;
    kind?: string;
    filePath?: string;
    isExported?: boolean;
    project?: string;
    limit: number;
  }): (SymbolRecord & { id: number })[] {
    return this.db.drizzleDb
      .select()
      .from(symbols)
      .where(
        and(
          opts.ftsQuery
            ? sql`${symbols.id} IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ${opts.ftsQuery})`
            : undefined,
          opts.project !== undefined ? eq(symbols.project, opts.project) : undefined,
          opts.kind ? eq(symbols.kind, opts.kind) : undefined,
          opts.filePath !== undefined ? eq(symbols.filePath, opts.filePath) : undefined,
          opts.isExported !== undefined
            ? eq(symbols.isExported, opts.isExported ? 1 : 0)
            : undefined,
        ),
      )
      .orderBy(symbols.name)
      .limit(opts.limit)
      .all() as (SymbolRecord & { id: number })[];
  }
}
