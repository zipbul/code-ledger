import type { Program } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { CodeRelation } from './types';
import { resolveImport } from './extractor-utils';
import { visit, getStringLiteralValue } from '../parser/ast-utils';

/**
 * Extracts all import/re-export relations from the AST.
 * Two passes: top-level statements + dynamic import() expressions.
 *
 * @param ast              - The parsed Program AST.
 * @param filePath         - File path of the source file (used as srcFilePath).
 * @param tsconfigPaths    - Optional tsconfig paths for alias resolution.
 * @param resolveImportFn  - Resolver function (DI seam, defaults to resolveImport).
 */
export function extractImports(
  ast: Program,
  filePath: string,
  tsconfigPaths?: TsconfigPaths,
  resolveImportFn: (
    currentFilePath: string,
    importPath: string,
    tsconfigPaths?: TsconfigPaths,
  ) => string[] = resolveImport,
): CodeRelation[] {
  const relations: CodeRelation[] = [];

  // Pass 1 — top-level statements
  for (const node of (ast as any).body ?? []) {
    if (node.type === 'ImportDeclaration') {
      const sourcePath: string = node.source?.value ?? '';
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0];

      const isType = node.importKind === 'type';
      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        ...(isType ? { metaJson: JSON.stringify({ isType: true }) } : {}),
      });
      continue;
    }

    if (node.type === 'ExportAllDeclaration' && node.source) {
      const sourcePath: string = node.source?.value ?? '';
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0];

      const isType = node.exportKind === 'type';
      const meta: Record<string, unknown> = { isReExport: true };
      if (isType) meta.isType = true;
      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
      });
      continue;
    }

    if (node.type === 'ExportNamedDeclaration' && node.source) {
      const sourcePath: string = node.source?.value ?? '';
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0];

      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify({ isReExport: true }),
      });
    }
  }

  // Pass 2 — deep traversal for dynamic import()
  visit(ast as any, (node) => {
    if (node.type !== 'ImportExpression') return;
    const sourceValue = getStringLiteralValue(node.source);
    if (!sourceValue) return;
    const candidates = resolveImportFn(filePath, sourceValue, tsconfigPaths);
    if (candidates.length === 0) return;
    const resolved = candidates[0];

    relations.push({
      type: 'imports',
      srcFilePath: filePath,
      srcSymbolName: null,
      dstFilePath: resolved,
      dstSymbolName: null,
      metaJson: JSON.stringify({ isDynamic: true }),
    });
  });

  return relations;
}
