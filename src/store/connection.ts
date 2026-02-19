import { Database } from 'bun:sqlite';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { StoreError } from '../errors';
import * as schema from './schema';
import { FTS_SETUP_SQL } from './schema';

export interface DbConnectionOptions {
  projectRoot: string;
}

export class DbConnection {
  private client: Database | null = null;
  private _drizzle: BunSQLiteDatabase<typeof schema> | null = null;
  private readonly dbPath: string;
  /** Nesting depth — >0 means we are inside a transaction. */
  private txDepth = 0;

  constructor(opts: DbConnectionOptions) {
    this.dbPath = join(opts.projectRoot, '.zipbul', 'code-ledger.db');
  }

  /** The typed drizzle instance — repositories use this for all queries. */
  get drizzleDb(): BunSQLiteDatabase<typeof schema> {
    if (!this._drizzle) throw new StoreError('Database is not open. Call open() first.');
    return this._drizzle;
  }

  open(): void {
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.client = new Database(this.dbPath);

      // Per-connection pragmas (must run before migrations).
      this.client.run('PRAGMA journal_mode = WAL');
      this.client.run('PRAGMA foreign_keys = ON');
      this.client.run('PRAGMA busy_timeout = 5000');

      // Create drizzle wrapper.
      this._drizzle = drizzle(this.client, { schema });

      // Schema migrations via drizzle-kit generated files.
      migrate(this._drizzle, {
        migrationsFolder: join(import.meta.dirname, 'migrations'),
      });

      // FTS5 virtual table + triggers (drizzle cannot define these).
      for (const sql of FTS_SETUP_SQL) {
        this.client.run(sql);
      }
    } catch (err) {
      // DB corruption recovery: delete and retry once.
      if (this._isCorruptionError(err) && existsSync(this.dbPath)) {
        this._closeClient();
        unlinkSync(this.dbPath);
        // Also remove WAL/SHM if present
        for (const ext of ['-wal', '-shm']) {
          const p = this.dbPath + ext;
          if (existsSync(p)) unlinkSync(p);
        }
        try {
          this.open();
          return;
        } catch (retryErr) {
          throw new StoreError(`Failed to recover database at ${this.dbPath}`, { cause: retryErr });
        }
      }
      if (err instanceof StoreError) throw err;
      throw new StoreError(`Failed to open database at ${this.dbPath}`, { cause: err });
    }
  }

  close(): void {
    this._closeClient();
    this._drizzle = null;
  }

  /**
   * Runs `fn` inside a transaction (BEGIN/COMMIT) or a SAVEPOINT when already
   * inside a transaction (nested call). Rolls back on throw.
   */
  transaction<T>(fn: () => T): T {
    const db = this._requireClient();

    if (this.txDepth === 0) {
      // Outermost transaction — use bun:sqlite native .transaction() for
      // automatic BEGIN / COMMIT / ROLLBACK handling.
      this.txDepth++;
      try {
        return db.transaction(fn)();
      } finally {
        this.txDepth--;
      }
    }

    // Nested — use a SAVEPOINT so the outer transaction is not affected.
    const sp = `sp_${this.txDepth++}`;
    db.run(`SAVEPOINT "${sp}"`);
    try {
      const result = fn();
      db.run(`RELEASE SAVEPOINT "${sp}"`);
      return result;
    } catch (err) {
      db.run(`ROLLBACK TO SAVEPOINT "${sp}"`);
      db.run(`RELEASE SAVEPOINT "${sp}"`);
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  /**
   * Executes a single-row, single-column query and returns the scalar value.
   * Useful for `PRAGMA` reads.
   */
  query(sql: string): any {
    const row = this._requireClient().prepare(sql).get() as Record<string, unknown> | null;
    if (!row) return null;
    return Object.values(row)[0];
  }

  /**
   * Returns all table/virtual-table names in `sqlite_master`.
   */
  getTableNames(): string[] {
    const rows = this._requireClient()
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  private _requireClient(): Database {
    if (!this.client) throw new StoreError('Database is not open. Call open() first.');
    return this.client;
  }

  private _closeClient(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private _isCorruptionError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('malformed') || msg.includes('corrupt') || msg.includes('not a database');
  }
}
