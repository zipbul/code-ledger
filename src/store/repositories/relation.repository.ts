import { eq, and, isNull, sql } from 'drizzle-orm';
import { relations as relationsTable } from '../schema';
import type { DbConnection } from '../connection';

export interface RelationRecord {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson: string | null;
}

export class RelationRepository {
  constructor(private readonly db: DbConnection) {}

  /**
   * Replaces all outgoing relations for `(project, srcFilePath)`.
   */
  replaceFileRelations(
    project: string,
    srcFilePath: string,
    rels: ReadonlyArray<Partial<RelationRecord>>,
  ): void {
    this.db.drizzleDb
      .delete(relationsTable)
      .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
      .run();

    if (!rels.length) return;

    for (const rel of rels) {
      this.db.drizzleDb.insert(relationsTable).values({
        project,
        type: rel.type ?? 'unknown',
        srcFilePath: rel.srcFilePath ?? srcFilePath,
        srcSymbolName: rel.srcSymbolName ?? null,
        dstFilePath: rel.dstFilePath ?? '',
        dstSymbolName: rel.dstSymbolName ?? null,
        metaJson: rel.metaJson ?? null,
      }).run();
    }
  }

  /**
   * Returns all outgoing relations from `srcFilePath`.
   * Optionally filters by `srcSymbolName` (null = file-level).
   */
  getOutgoing(project: string, srcFilePath: string, srcSymbolName?: string): RelationRecord[] {
    if (srcSymbolName !== undefined) {
      return this.db.drizzleDb
        .select({
          project: relationsTable.project,
          type: relationsTable.type,
          srcFilePath: relationsTable.srcFilePath,
          srcSymbolName: relationsTable.srcSymbolName,
          dstFilePath: relationsTable.dstFilePath,
          dstSymbolName: relationsTable.dstSymbolName,
          metaJson: relationsTable.metaJson,
        })
        .from(relationsTable)
        .where(
          and(
            eq(relationsTable.project, project),
            eq(relationsTable.srcFilePath, srcFilePath),
            eq(relationsTable.srcSymbolName, srcSymbolName),
          ),
        )
        .all();
    }

    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.srcFilePath, srcFilePath),
        ),
      )
      .all();
  }

  getIncoming(project: string, dstFilePath: string): RelationRecord[] {
    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.dstFilePath, dstFilePath),
        ),
      )
      .all();
  }

  getByType(project: string, type: string): RelationRecord[] {
    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.type, type),
        ),
      )
      .all();
  }

  deleteFileRelations(project: string, srcFilePath: string): void {
    this.db.drizzleDb
      .delete(relationsTable)
      .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
      .run();
  }

  /**
   * Retargets all relations pointing at `(oldFile, oldSymbol)` to `(newFile, newSymbol)`.
   */
  retargetRelations(
    project: string,
    oldFile: string,
    oldSymbol: string | null,
    newFile: string,
    newSymbol: string | null,
  ): void {
    const condition = oldSymbol === null
      ? and(
          eq(relationsTable.project, project),
          eq(relationsTable.dstFilePath, oldFile),
          isNull(relationsTable.dstSymbolName),
        )
      : and(
          eq(relationsTable.project, project),
          eq(relationsTable.dstFilePath, oldFile),
          eq(relationsTable.dstSymbolName, oldSymbol),
        );

    this.db.drizzleDb
      .update(relationsTable)
      .set({ dstFilePath: newFile, dstSymbolName: newSymbol })
      .where(condition)
      .run();
  }
}
