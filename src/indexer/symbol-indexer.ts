import type { ParsedFile } from '../parser/types';
import type { ExtractedSymbol } from '../extractor/types';
import { extractSymbols } from '../extractor/symbol-extractor';
import { hashString } from '../common/hasher';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SymbolDbRow {
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

interface SymbolRepoPart {
  replaceFileSymbols(
    project: string,
    filePath: string,
    contentHash: string,
    symbols: SymbolDbRow[],
  ): void;
}

export interface IndexFileSymbolsOptions {
  parsed: ParsedFile;
  project: string;
  filePath: string;
  contentHash: string;
  symbolRepo: SymbolRepoPart;
}

// ── Signature ─────────────────────────────────────────────────────────────

function buildSignature(sym: ExtractedSymbol): string | null {
  if (sym.kind === 'function' || sym.kind === 'method') {
    const paramCount = sym.parameters?.length ?? 0;
    const isAsync = sym.modifiers.includes('async') ? 1 : 0;
    return `params:${paramCount}|async:${isAsync}`;
  }
  return null;
}

// ── Detail JSON ────────────────────────────────────────────────────────────

function buildDetailJson(sym: ExtractedSymbol): string | null {
  const detail: Record<string, unknown> = {};

  if (sym.jsDoc) detail.jsDoc = sym.jsDoc;

  if (sym.kind === 'function' || sym.kind === 'method') {
    if (sym.parameters !== undefined) detail.parameters = sym.parameters;
    if (sym.returnType !== undefined) detail.returnType = sym.returnType;
  }

  if (sym.heritage?.length) detail.heritage = sym.heritage;
  if (sym.decorators?.length) detail.decorators = sym.decorators;
  if (sym.typeParameters?.length) detail.typeParameters = sym.typeParameters;
  if (sym.modifiers?.length) detail.modifiers = sym.modifiers;
  if (sym.members?.length) detail.members = sym.members.map((m) => m.name);

  return Object.keys(detail).length > 0 ? JSON.stringify(detail) : null;
}

// ── Row builder ────────────────────────────────────────────────────────────

function buildRow(
  sym: ExtractedSymbol,
  name: string,
  project: string,
  filePath: string,
  contentHash: string,
): SymbolDbRow {
  const signature = buildSignature(sym);
  const fingerprint = hashString(`${name}|${sym.kind}|${signature ?? ''}`);

  return {
    project,
    filePath,
    kind: sym.kind,
    name,
    startLine: sym.span.start.line,
    startColumn: sym.span.start.column,
    endLine: sym.span.end.line,
    endColumn: sym.span.end.column,
    isExported: sym.isExported ? 1 : 0,
    signature,
    fingerprint,
    detailJson: buildDetailJson(sym),
    contentHash,
    indexedAt: new Date().toISOString(),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Extracts symbols from `parsed`, maps them to DB rows (flattening
 * class/interface/enum members), and writes them via `symbolRepo`.
 */
export function indexFileSymbols(opts: IndexFileSymbolsOptions): void {
  const { parsed, project, filePath, contentHash, symbolRepo } = opts;

  const extracted = extractSymbols(parsed);
  const rows: SymbolDbRow[] = [];

  for (const sym of extracted) {
    rows.push(buildRow(sym, sym.name, project, filePath, contentHash));

    // Flatten members (class methods, interface props, enum values, …).
    for (const member of sym.members ?? []) {
      rows.push(buildRow(member, `${sym.name}.${member.name}`, project, filePath, contentHash));
    }
  }

  symbolRepo.replaceFileSymbols(project, filePath, contentHash, rows);
}
