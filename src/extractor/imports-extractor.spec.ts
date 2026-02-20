import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ── Mock resolveImport (injected via DI, no mock.module needed) ──
const mockResolveImport = mock(() => [] as string[]);

// ── Mock ../parser/ast-utils ──
const mockVisit = mock((_node: any, _cb: any) => {});
const mockGetStringLiteralValue = mock(() => null as string | null);

import { extractImports } from './imports-extractor';

const FILE = '/project/src/index.ts';

// ── Fake AST helpers ──
function fakeAst(body: any[]): any {
  return { body };
}

describe('extractImports', () => {
  beforeEach(() => {
    mock.module('../parser/ast-utils', () => ({
      visit: mockVisit,
      getStringLiteralValue: mockGetStringLiteralValue,
    }));
    mockResolveImport.mockClear();
    mockVisit.mockClear();
    mockGetStringLiteralValue.mockClear();
    mockResolveImport.mockReturnValue(['/resolved/path.ts']);
    mockVisit.mockImplementation(() => {});
    mockGetStringLiteralValue.mockReturnValue(null);
  });

  // HP — named import
  it('should produce an imports relation when source has a named import specifier', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './utils' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations.some((r) => r.type === 'imports')).toBe(true);
    expect(mockResolveImport).toHaveBeenCalledWith(FILE, './utils', undefined);
  });

  it('should set srcFilePath to the current file path when processing a static import', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './x' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations[0].srcFilePath).toBe(FILE);
  });

  it('should set srcSymbolName to null when import is a top-level static import', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './y' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations[0].srcSymbolName).toBeNull();
  });

  it('should set dstSymbolName to null when import is a top-level static import', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './z' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations[0].dstSymbolName).toBeNull();
  });

  // NE — external package
  it('should not produce a relation when import source is an npm package', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: 'react' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // type import
  it('should include {"isType":true} in metaJson when import declaration is a type-only import', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './foo' }, importKind: 'type', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    if (relations.length > 0) {
      expect(relations[0].metaJson).toContain('"isType":true');
    }
  });

  // re-export (ExportAllDeclaration)
  it('should produce an imports relation with {"isReExport":true} when declaration is export * from', () => {
    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: './barrel' }, exportKind: 'value' },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));

    expect(rel).toBeDefined();
  });

  // dynamic import
  it('should produce an imports relation with {"isDynamic":true} when declaration is a dynamic import()', () => {
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb({ type: 'ImportExpression', source: { type: 'StringLiteral', value: './dynamic' } });
    });
    mockGetStringLiteralValue.mockReturnValue('./dynamic');

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isDynamic":true'));

    expect(rel).toBeDefined();
  });

  // ED — empty file
  it('should return empty array when source is empty', () => {
    const ast = fakeAst([]);
    expect(extractImports(ast, FILE, undefined, mockResolveImport)).toEqual([]);
  });

  // ED — no imports
  it('should return empty array when source has no import or export declarations', () => {
    const ast = fakeAst([
      { type: 'VariableDeclaration' },
      { type: 'ExportNamedDeclaration', source: undefined },
    ]);
    expect(extractImports(ast, FILE, undefined, mockResolveImport)).toEqual([]);
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './a' }, importKind: 'value', specifiers: [] },
    ]);
    const r1 = extractImports(ast, FILE, undefined, mockResolveImport);
    const r2 = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(r1).toEqual(r2);
  });

  // re-export — ExportNamedDeclaration with source (G2)
  it('should produce an imports relation with {"isReExport":true} when declaration is export { foo } from', () => {
    const ast = fakeAst([
      { type: 'ExportNamedDeclaration', source: { value: './local' } },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));

    expect(rel).toBeDefined();
    expect(rel!.type).toBe('imports');
  });

  it('should return no relation when export { foo } from source is an external npm package', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      { type: 'ExportNamedDeclaration', source: { value: 'react' } },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });
});
