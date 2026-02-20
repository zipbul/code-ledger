import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { CodeRelation } from './types';

// ── Mock declarations ──────────────────────────────────────
const mockBuildImportMap = mock(() => new Map());
const mockExtractImports = mock((): CodeRelation[] => []);
const mockExtractCalls = mock((): CodeRelation[] => []);
const mockExtractHeritage = mock((): CodeRelation[] => []);

mock.module('./extractor-utils', () => ({ buildImportMap: mockBuildImportMap }));
mock.module('./imports-extractor', () => ({ extractImports: mockExtractImports }));
mock.module('./calls-extractor', () => ({ extractCalls: mockExtractCalls }));
mock.module('./heritage-extractor', () => ({ extractHeritage: mockExtractHeritage }));

import { extractRelations } from './relation-extractor';

// ── Constants ──────────────────────────────────────────────
const FILE = '/project/src/index.ts';
const FAKE_AST = {} as any;
const SENTINEL_MAP = new Map([['__sentinel__', { path: '/__s__', importedName: '__s__' }]]);

describe('extractRelations', () => {
  beforeEach(() => {
    mock.module('./extractor-utils', () => ({ buildImportMap: mockBuildImportMap }));
    mock.module('./imports-extractor', () => ({ extractImports: mockExtractImports }));
    mock.module('./calls-extractor', () => ({ extractCalls: mockExtractCalls }));
    mock.module('./heritage-extractor', () => ({ extractHeritage: mockExtractHeritage }));
    mockBuildImportMap.mockClear();
    mockExtractImports.mockClear();
    mockExtractCalls.mockClear();
    mockExtractHeritage.mockClear();

    mockBuildImportMap.mockReturnValue(SENTINEL_MAP);
    mockExtractImports.mockReturnValue([]);
    mockExtractCalls.mockReturnValue([]);
    mockExtractHeritage.mockReturnValue([]);
  });

  // HP — merges all extractors
  it('should include imports relations in the merged result when source has import declarations', () => {
    mockExtractImports.mockReturnValue([
      { type: 'imports', srcFilePath: FILE, srcSymbolName: null, dstFilePath: '/project/src/foo.ts', dstSymbolName: null },
    ]);

    const relations = extractRelations(FAKE_AST, FILE);
    expect(relations.some((r) => r.type === 'imports')).toBe(true);
  });

  it('should include extends relations in the merged result when source has class inheritance', () => {
    mockExtractHeritage.mockReturnValue([
      { type: 'extends', srcFilePath: FILE, srcSymbolName: 'B', dstFilePath: FILE, dstSymbolName: 'A' },
    ]);

    const relations = extractRelations(FAKE_AST, FILE);
    expect(relations.some((r) => r.type === 'extends')).toBe(true);
  });

  it('should include calls relations in the merged result when source has function calls', () => {
    mockExtractCalls.mockReturnValue([
      { type: 'calls', srcFilePath: FILE, srcSymbolName: 'caller', dstFilePath: FILE, dstSymbolName: 'callee' },
    ]);

    const relations = extractRelations(FAKE_AST, FILE);
    expect(relations.some((r) => r.type === 'calls')).toBe(true);
  });

  it('should return empty array when source is empty', () => {
    expect(extractRelations(FAKE_AST, FILE)).toEqual([]);
  });

  it('should return empty array when source has no imports or calls', () => {
    expect(extractRelations(FAKE_AST, FILE)).toEqual([]);
  });

  // tsconfigPaths forwarding
  it('should resolve import path using tsconfig aliases when tsconfigPaths option is provided', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@utils/*', ['src/utils/*']]]),
    };
    mockExtractImports.mockReturnValue([
      { type: 'imports', srcFilePath: FILE, srcSymbolName: null, dstFilePath: '/project/src/utils/format.ts', dstSymbolName: null },
    ]);

    const relations = extractRelations(FAKE_AST, FILE, tsconfigPaths);

    expect(mockBuildImportMap).toHaveBeenCalledWith(FAKE_AST, FILE, tsconfigPaths);
    expect(mockExtractImports).toHaveBeenCalledWith(FAKE_AST, FILE, tsconfigPaths);
    expect(mockExtractCalls).toHaveBeenCalledWith(FAKE_AST, FILE, SENTINEL_MAP);
    expect(mockExtractHeritage).toHaveBeenCalledWith(FAKE_AST, FILE, SENTINEL_MAP);
    const rel = relations.find((r) => r.type === 'imports');
    expect(rel?.dstFilePath).toContain('utils/format');
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    mockExtractImports.mockReturnValue([
      { type: 'imports', srcFilePath: FILE, srcSymbolName: null, dstFilePath: '/project/src/x.ts', dstSymbolName: null },
    ]);
    mockExtractHeritage.mockReturnValue([
      { type: 'extends', srcFilePath: FILE, srcSymbolName: 'B', dstFilePath: FILE, dstSymbolName: 'A' },
    ]);
    mockExtractCalls.mockReturnValue([
      { type: 'calls', srcFilePath: FILE, srcSymbolName: 'main', dstFilePath: FILE, dstSymbolName: 'helper' },
    ]);

    const r1 = extractRelations(FAKE_AST, FILE);
    const r2 = extractRelations(FAKE_AST, FILE);
    expect(r1.length).toBe(r2.length);
  });

  // implements
  it('should include implements relations in the merged result when source has class interface implementation', () => {
    mockExtractHeritage.mockReturnValue([
      { type: 'implements', srcFilePath: FILE, srcSymbolName: 'C', dstFilePath: FILE, dstSymbolName: 'I' },
    ]);

    const relations = extractRelations(FAKE_AST, FILE);
    expect(relations.some((r) => r.type === 'implements')).toBe(true);
  });
});
