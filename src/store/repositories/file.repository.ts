import { eq, and } from 'drizzle-orm';
import { files } from '../schema';
import type { DbConnection } from '../connection';

export interface FileRecord {
  project: string;
  filePath: string;
  mtimeMs: number;
  size: number;
  contentHash: string;
  updatedAt: string;
}

export class FileRepository {
  constructor(private readonly db: DbConnection) {}

  getFile(project: string, filePath: string): FileRecord | null {
    return this.db.drizzleDb
      .select()
      .from(files)
      .where(and(eq(files.project, project), eq(files.filePath, filePath)))
      .get() ?? null;
  }

  upsertFile(record: FileRecord): void {
    this.db.drizzleDb
      .insert(files)
      .values({
        project: record.project,
        filePath: record.filePath,
        mtimeMs: record.mtimeMs,
        size: record.size,
        contentHash: record.contentHash,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: [files.project, files.filePath],
        set: {
          mtimeMs: record.mtimeMs,
          size: record.size,
          contentHash: record.contentHash,
          updatedAt: record.updatedAt,
        },
      })
      .run();
  }

  getAllFiles(project: string): FileRecord[] {
    return this.db.drizzleDb
      .select()
      .from(files)
      .where(eq(files.project, project))
      .all();
  }

  getFilesMap(project: string): Map<string, FileRecord> {
    const rows = this.getAllFiles(project);
    const map = new Map<string, FileRecord>();
    for (const r of rows) map.set(r.filePath, r);
    return map;
  }

  deleteFile(project: string, filePath: string): void {
    this.db.drizzleDb
      .delete(files)
      .where(and(eq(files.project, project), eq(files.filePath, filePath)))
      .run();
  }
}
