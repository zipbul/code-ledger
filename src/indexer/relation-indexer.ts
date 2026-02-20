import type { Program } from 'oxc-parser';
import { extractRelations } from '../extractor/relation-extractor';
import { toAbsolutePath, toRelativePath } from '../common/path-utils';

// ── Types ─────────────────────────────────────────────────────────────────

export interface RelationDbRow {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson: string | null;
}

interface RelationRepoPart {
  replaceFileRelations(
    project: string,
    filePath: string,
    relations: RelationDbRow[],
  ): void;
}

export interface IndexFileRelationsOptions {
  /** The parsed AST root (oxc-parser Program). */
  ast: Program;
  project: string;
  /** Relative path of the file being indexed. */
  filePath: string;
  relationRepo: RelationRepoPart;
  projectRoot: string;
  /** Optional tsconfig path mappings to pass to the extractor. */
  tsconfigPaths?: any;
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Extracts code relations for a single file and writes them to the store.
 *
 * - Only relations whose destination is within the project root (relative path
 *   does NOT start with `..`) are stored.
 * - All absolute paths are normalised to project-root-relative paths.
 */
export function indexFileRelations(opts: IndexFileRelationsOptions): number {
  const { ast, project, filePath, relationRepo, projectRoot, tsconfigPaths } = opts;

  const absFilePath = toAbsolutePath(projectRoot, filePath);
  const rawRelations = extractRelations(ast, absFilePath, tsconfigPaths);

  const rows: RelationDbRow[] = [];

  for (const rel of rawRelations) {
    const relDst = toRelativePath(projectRoot, rel.dstFilePath);

    // Filter out-of-project destinations (path escapes the root).
    if (relDst.startsWith('..')) continue;

    const relSrc = toRelativePath(projectRoot, rel.srcFilePath);

    rows.push({
      project,
      type: rel.type,
      srcFilePath: relSrc,
      srcSymbolName: rel.srcSymbolName ?? null,
      dstFilePath: relDst,
      dstSymbolName: rel.dstSymbolName ?? null,
      metaJson: rel.metaJson ?? null,
    });
  }

  relationRepo.replaceFileRelations(project, filePath, rows);
  return rows.length;
}
