import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { parseSync } from 'oxc-parser';
import type { ImportReference } from './types';

// ── Mock ../parser/ast-utils ──
const mockGetQualifiedName = mock(() => null as any);

import { extractCalls } from './calls-extractor';

const FILE = '/project/src/index.ts';

function parse(source: string, filePath = FILE) {
  const { program } = parseSync(filePath, source);
  return program as any;
}

function makeImportMap(entries: [string, ImportReference][] = []): Map<string, ImportReference> {
  return new Map(entries);
}

describe('extractCalls', () => {
  beforeEach(() => {
    mock.module('../parser/ast-utils', () => ({
      getQualifiedName: mockGetQualifiedName,
    }));
    mockGetQualifiedName.mockClear();
    mockGetQualifiedName.mockReturnValue(null);
  });

  // HP — local call
  it('should extract a calls relation when callee is a locally defined function', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'helper', parts: [], full: 'helper' });

    const ast = parse(`
      function helper() {}
      function main() { helper(); }
    `);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'helper' && r.srcSymbolName === 'main');

    expect(rel).toBeDefined();
    expect(rel!.type).toBe('calls');
    expect(mockGetQualifiedName).toHaveBeenCalled();
  });

  // HP — imported call
  it('should resolve dstFilePath to imported module path when callee local name is in importMap', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'foo', parts: [], full: 'foo' });

    const importMap = makeImportMap([
      ['foo', { path: '/project/src/foo.ts', importedName: 'foo' }],
    ]);
    const ast = parse(`function main() { foo(); }`);
    const relations = extractCalls(ast, FILE, importMap);
    const rel = relations.find((r) => r.dstSymbolName === 'foo');

    expect(rel?.dstFilePath).toBe('/project/src/foo.ts');
  });

  // HP — new expression
  it('should produce a calls relation with {"isNew":true} in metaJson when expression is NewExpression', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'MyClass', parts: [], full: 'MyClass' });

    const ast = parse(`function main() { new MyClass(); }`);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'MyClass');

    expect(rel?.metaJson).toContain('"isNew":true');
  });

  // HP — method call
  it('should set srcSymbolName to the class method name when call is inside a class method body', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'this', parts: ['helper'], full: 'this.helper' });

    const ast = parse(`class Svc { run() { this.helper(); } helper() {} }`);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'this.helper');

    expect(rel?.srcSymbolName).toContain('run');
  });

  // HP — module-scope call
  it('should set srcSymbolName to null when call is at module level (not inside any function)', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'init', parts: [], full: 'init' });

    const ast = parse(`init();`);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'init');

    expect(rel?.srcSymbolName).toBeNull();
  });

  // NE
  it('should return empty array when source has no function calls', () => {
    const ast = parse(`const x = 1;`);
    expect(extractCalls(ast, FILE, makeImportMap())).toEqual([]);
  });

  // ED — empty file
  it('should return empty array when source is empty', () => {
    const ast = parse('');
    expect(extractCalls(ast, FILE, makeImportMap())).toEqual([]);
  });

  // namespace import call
  it('should set dstFilePath to namespace module path when callee is a namespace import member', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'utils', parts: ['format'], full: 'utils.format' });

    const importMap = makeImportMap([
      ['utils', { path: '/project/src/utils.ts', importedName: '*' }],
    ]);
    const ast = parse(`function main() { utils.format(); }`);
    const relations = extractCalls(ast, FILE, importMap);
    const rel = relations.find((r) => r.dstSymbolName === 'format');

    expect(rel?.dstFilePath).toBe('/project/src/utils.ts');
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'b', parts: [], full: 'b' });

    const ast = parse(`function a() { b(); } function b() {}`);
    const map = makeImportMap();
    const r1 = extractCalls(ast, FILE, map);
    const r2 = extractCalls(ast, FILE, map);

    expect(r1.length).toBe(r2.length);
  });

  // nested function
  it('should attribute a call to the enclosing named function when call is inside a nested arrow function', () => {
    mockGetQualifiedName
      .mockReturnValueOnce({ root: 'items', parts: ['forEach'], full: 'items.forEach' })
      .mockReturnValueOnce({ root: 'transform', parts: [], full: 'transform' });

    const ast = parse(`
      function process(items) {
        items.forEach((item) => { transform(item); });
      }
    `);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'transform');

    expect(rel).toBeDefined();
  });

  // VariableDeclarator + FunctionExpression (G1)
  it('should set srcSymbolName to the variable name when callee is inside a FunctionExpression assigned to a const', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'callee', parts: [], full: 'callee' });

    const ast = parse(`const fn = function() { callee(); };`);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'callee');

    expect(rel).toBeDefined();
    expect(rel!.srcSymbolName).toBe('fn');
  });

  it('should return empty relations when a FunctionExpression assigned to a const contains no call expressions', () => {
    const ast = parse(`const fn = function() {};`);
    expect(extractCalls(ast, FILE, makeImportMap())).toEqual([]);
  });

  // T-1: module-scope meta
  it('should include {"scope":"module"} in metaJson when call expression is at module scope', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'init', parts: [], full: 'init' });

    const ast = parse(`init();`);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'init');

    expect(rel?.metaJson).toContain('"scope":"module"');
  });

  it('should include both {"isNew":true} and {"scope":"module"} in metaJson when new expression is at module scope', () => {
    mockGetQualifiedName.mockReturnValue({ root: 'MyClass', parts: [], full: 'MyClass' });

    const ast = parse(`new MyClass();`);
    const relations = extractCalls(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.dstSymbolName === 'MyClass');

    expect(rel?.metaJson).toContain('"isNew":true');
    expect(rel?.metaJson).toContain('"scope":"module"');
  });
});
