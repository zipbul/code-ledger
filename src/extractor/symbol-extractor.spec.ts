import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { parseSync } from 'oxc-parser';
import type { ParsedFile } from '../parser/types';

// ── Mock ../parser/source-position ──
const mockBuildLineOffsets = mock((_sourceText: string) => [0]);
const mockGetLineColumn = mock((_offsets: number[], _offset: number) => ({ line: 1, column: 0 }));

// ── Mock ../parser/jsdoc-parser ──
const mockParseJsDoc = mock((_commentText: string) => ({ description: '', tags: [] }));

mock.module('../parser/source-position', () => ({
  buildLineOffsets: mockBuildLineOffsets,
  getLineColumn: mockGetLineColumn,
}));
mock.module('../parser/jsdoc-parser', () => ({
  parseJsDoc: mockParseJsDoc,
}));

import { extractSymbols } from './symbol-extractor';

function makeFixture(source: string, filePath = '/project/src/index.ts'): ParsedFile {
  const { program, errors, comments } = parseSync(filePath, source);
  return { filePath, program: program as any, errors, comments, sourceText: source };
}

describe('extractSymbols', () => {
  beforeEach(() => {
    mock.module('../parser/source-position', () => ({
      buildLineOffsets: mockBuildLineOffsets,
      getLineColumn: mockGetLineColumn,
    }));
    mock.module('../parser/jsdoc-parser', () => ({
      parseJsDoc: mockParseJsDoc,
    }));
    mockBuildLineOffsets.mockClear();
    mockGetLineColumn.mockClear();
    mockParseJsDoc.mockClear();
    mockBuildLineOffsets.mockReturnValue([0]);
    mockGetLineColumn.mockReturnValue({ line: 1, column: 0 });
    mockParseJsDoc.mockReturnValue({ description: '', tags: [] });
  });
  // HP — function
  it('should extract a function symbol when source has a top-level function declaration', () => {
    const parsed = makeFixture(`function greet(name: string): string { return name; }`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.isExported).toBe(false);
  });

  it('should mark isExported true when function declaration has export keyword', () => {
    const parsed = makeFixture(`export function hello() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'hello');
    expect(fn?.isExported).toBe(true);
  });

  it('should extract parameter names and types when function declaration has typed parameters', () => {
    const parsed = makeFixture(`function add(a: number, b: number): number { return a + b; }`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'add');
    expect(fn?.parameters).toHaveLength(2);
    expect(fn?.parameters![0].name).toBe('a');
    expect(fn?.parameters![0].type).toContain('number');
  });

  it('should mark parameter isOptional true when parameter has ? optional marker', () => {
    const parsed = makeFixture(`function fn(x?: string) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters![0].isOptional).toBe(true);
  });

  it('should populate returnType when function declaration has an explicit return type annotation', () => {
    const parsed = makeFixture(`function fn(): boolean { return true; }`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.returnType).toContain('boolean');
  });

  // HP — class
  it('should extract a class symbol when source has a top-level class declaration', () => {
    const parsed = makeFixture(`class Animal {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Animal');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('should populate heritage with extends entry when class declaration has an extends clause', () => {
    const parsed = makeFixture(`class Dog extends Animal {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Dog');
    expect(cls?.heritage?.some((h) => h.kind === 'extends' && h.name === 'Animal')).toBe(true);
  });

  it('should populate heritage with implements entry when class declaration has an implements clause', () => {
    const parsed = makeFixture(`class ServiceImpl implements Service {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'ServiceImpl');
    expect(cls?.heritage?.some((h) => h.kind === 'implements' && h.name === 'Service')).toBe(true);
  });

  it('should include method members when class body contains method definitions', () => {
    const parsed = makeFixture(`class Calc { add(a: number, b: number): number { return a + b; } }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Calc');
    expect(cls?.members?.some((m) => m.name === 'add' && m.kind === 'method')).toBe(true);
  });

  it('should set methodKind to "getter" when class body contains a getter method', () => {
    const parsed = makeFixture(`class C { get value(): number { return 0; } }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const getter = cls?.members?.find((m) => m.name === 'value');
    expect(getter?.methodKind).toBe('getter');
  });

  it('should set methodKind to "setter" when class body contains a setter method', () => {
    const parsed = makeFixture(`class C { set value(v: number) {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const setter = cls?.members?.find((m) => m.name === 'value');
    expect(setter?.methodKind).toBe('setter');
  });

  it('should include a member with methodKind "constructor" when class body has a constructor', () => {
    const parsed = makeFixture(`class C { constructor(private x: number) {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const ctor = cls?.members?.find((m) => m.methodKind === 'constructor');
    expect(ctor).toBeDefined();
  });

  // HP — interface
  it('should extract an interface symbol when source has a top-level interface declaration', () => {
    const parsed = makeFixture(`interface Shape { area(): number; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Shape');
    expect(iface?.kind).toBe('interface');
  });

  it('should populate heritage with extends entry when interface declaration has an extends clause', () => {
    const parsed = makeFixture(`interface Animal { name: string; } interface Dog extends Animal { breed: string; }`);
    const symbols = extractSymbols(parsed);
    const dog = symbols.find((s) => s.name === 'Dog');
    expect(dog?.heritage?.some((h) => h.kind === 'extends' && h.name === 'Animal')).toBe(true);
  });

  // HP — enum
  it('should extract an enum symbol when source has a top-level enum declaration', () => {
    const parsed = makeFixture(`enum Direction { Up, Down, Left, Right }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Direction');
    expect(en?.kind).toBe('enum');
  });

  it('should populate enum members list when enum body contains member entries', () => {
    const parsed = makeFixture(`enum Color { Red, Green, Blue }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Color');
    expect(en?.members?.some((m) => m.name === 'Red')).toBe(true);
    expect(en?.members?.some((m) => m.name === 'Green')).toBe(true);
  });

  // HP — variable
  it('should extract a variable symbol with kind "variable" when declaration is a const initializer', () => {
    const parsed = makeFixture(`const PI = 3.14;`);
    const symbols = extractSymbols(parsed);
    const v = symbols.find((s) => s.name === 'PI');
    expect(v?.kind).toBe('variable');
  });

  it('should set kind to "function" when const is assigned an ArrowFunctionExpression', () => {
    const parsed = makeFixture(`const add = (a: number, b: number) => a + b;`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'add');
    expect(fn?.kind).toBe('function');
  });

  // HP — type alias
  it('should extract a type symbol when source has a top-level type alias declaration', () => {
    const parsed = makeFixture(`type StringOrNumber = string | number;`);
    const symbols = extractSymbols(parsed);
    const t = symbols.find((s) => s.name === 'StringOrNumber');
    expect(t?.kind).toBe('type');
  });

  // HP — span
  it('should set span.start.line to 1 when symbol is on the first line of the source', () => {
    const parsed = makeFixture(`function fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.span.start.line).toBe(1);
  });

  // NE
  it('should return empty array when source is empty', () => {
    const parsed = makeFixture('');
    expect(extractSymbols(parsed)).toEqual([]);
  });

  it('should name the symbol "default" when export default declaration has an anonymous function', () => {
    const parsed = makeFixture(`export default function() {}`);
    const symbols = extractSymbols(parsed);
    // ExportDefaultDeclaration anonymous function → name is 'default'
    const def = symbols.find((s) => s.name === 'default');
    expect(def).toBeDefined();
  });

  it('should not include inner function declarations when they are nested inside a function body', () => {
    const parsed = makeFixture(`function outer() { function inner() {} }`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find((s) => s.name === 'inner')).toBeUndefined();
  });

  // decorator
  it('should populate decorators list when class has a call-expression decorator', () => {
    const parsed = makeFixture(`
      @Injectable()
      class MyService {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'MyService');
    expect(cls?.decorators?.some((d) => d.name === 'Injectable')).toBe(true);
  });

  // modifiers
  it('should include "async" in modifiers when function declaration has async keyword', () => {
    const parsed = makeFixture(`async function fetchData() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fetchData');
    expect(fn?.modifiers).toContain('async');
  });

  // default export
  it('should name the symbol "default" and set isExported true when export default class has no class name', () => {
    const parsed = makeFixture(`export default class {}`);
    const symbols = extractSymbols(parsed);
    const def = symbols.find((s) => s.name === 'default');
    expect(def).toBeDefined();
    expect(def?.isExported).toBe(true);
  });

  // ID
  it('should return same symbol count when called repeatedly with the same ParsedFile', () => {
    const parsed = makeFixture(`function a() {} function b() {}`);
    const r1 = extractSymbols(parsed);
    const r2 = extractSymbols(parsed);
    expect(r1.length).toBe(r2.length);
  });

  // JSDoc comment — G3/G4/G5/G6
  it('should populate jsDoc.description when a JSDoc block comment precedes the function', () => {
    mockParseJsDoc.mockReturnValue({ description: 'Greets the user.', tags: [] });
    const parsed = makeFixture(`/** Greets the user. */\nfunction greet() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'greet');
    expect(fn?.jsDoc).toBeDefined();
    expect(fn!.jsDoc!.description).toContain('Greets');
  });

  it('should populate jsDoc.tags with param tag when a JSDoc @param tag precedes the function', () => {
    mockParseJsDoc.mockReturnValue({
      description: '',
      tags: [{ tag: 'param', name: 'x', type: '', description: 'the value', optional: false }],
    });
    const parsed = makeFixture(`/** @param x - the value */\nfunction fn(x: number) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc?.tags?.some((t) => t.tag === 'param')).toBe(true);
  });

  it('should leave jsDoc undefined when only a line comment precedes the function', () => {
    const parsed = makeFixture(`// just a comment\nfunction fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  it('should leave jsDoc undefined when only a regular block comment (not JSDoc) precedes the function', () => {
    const parsed = makeFixture(`/* not jsdoc */\nfunction fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  it('should leave jsDoc undefined when JSDoc comment follows the function instead of preceding it', () => {
    const parsed = makeFixture(`function fn() {}\n/** after */`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  // PropertyDefinition class field — G7
  it('should include a member with kind "property" when class body contains a PropertyDefinition field', () => {
    const parsed = makeFixture(`class C { name: string = ''; }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const prop = cls?.members?.find((m) => m.name === 'name');
    expect(prop).toBeDefined();
    expect(prop!.kind).toBe('property');
  });

  // Identifier decorator (no parens) — G8
  it('should extract decorator without arguments when decorator is a bare Identifier without parentheses', () => {
    const parsed = makeFixture(`
      @Inject
      class MyService {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'MyService');
    expect(cls?.decorators?.some((d) => d.name === 'Inject')).toBe(true);
    const dec = cls!.decorators!.find((d) => d.name === 'Inject');
    expect(dec?.arguments).toBeUndefined();
  });

  // T-2: interface TSPropertySignature member
  it('should include a member with kind "property" and populated returnType when interface has a TSPropertySignature', () => {
    const parsed = makeFixture(`interface Shape { name: string; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Shape');
    const member = iface?.members?.find((m) => m.name === 'name');
    expect(member).toBeDefined();
    expect(member!.kind).toBe('property');
    expect(member!.returnType).toContain('string');
  });

  it('should include "readonly" in modifiers when interface TSPropertySignature has readonly keyword', () => {
    const parsed = makeFixture(`interface Shape { readonly id: number; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Shape');
    const member = iface?.members?.find((m) => m.name === 'id');
    expect(member?.modifiers).toContain('readonly');
  });

  // I-2: ObjectPattern destructuring
  it('should extract one symbol per identifier when VariableDeclarator id is an ObjectPattern', () => {
    const parsed = makeFixture(`const { a, b } = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'b')).toBe(true);
  });

  it('should set isExported true for each ObjectPattern symbol when declaration has export keyword', () => {
    const parsed = makeFixture(`export const { x, y } = obj;`);
    const symbols = extractSymbols(parsed);
    const x = symbols.find((s) => s.name === 'x');
    const y = symbols.find((s) => s.name === 'y');
    expect(x?.isExported).toBe(true);
    expect(y?.isExported).toBe(true);
  });

  it('should return no symbols when ObjectPattern has no properties (empty destructuring)', () => {
    const parsed = makeFixture(`const {} = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(0);
  });

  it('should extract ObjectPattern identifiers and Identifier variables when both appear in the same scope', () => {
    const parsed = makeFixture(`const { a } = obj;\nconst d = 1;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'd')).toBe(true);
  });

  // I-3: typeParameters
  it('should populate typeParameters with one entry when function has a single type parameter', () => {
    const parsed = makeFixture(`function fn<T>() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.typeParameters).toEqual(['T']);
  });

  it('should populate typeParameters with all entries when function has multiple type parameters', () => {
    const parsed = makeFixture(`function fn<T, U>() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.typeParameters).toEqual(['T', 'U']);
  });

  it('should populate typeParameters when class declaration has a type parameter', () => {
    const parsed = makeFixture(`class Container<T> {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Container');
    expect(cls?.typeParameters).toEqual(['T']);
  });

  it('should populate typeParameters when interface declaration has a type parameter', () => {
    const parsed = makeFixture(`interface Repository<T> {}`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Repository');
    expect(iface?.typeParameters).toEqual(['T']);
  });

  // I-4: RestElement parameter
  it('should prefix parameter name with "..." when parameter is a RestElement', () => {
    const parsed = makeFixture(`function fn(...args: string[]) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters?.some((p) => p.name === '...args')).toBe(true);
  });

  it('should correctly extract names for both normal and rest parameters when function mixes parameter kinds', () => {
    const parsed = makeFixture(`function fn(a: number, ...rest: string[]) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters?.[0].name).toBe('a');
    expect(fn?.parameters?.[1].name).toBe('...rest');
  });

  it('should extract rest parameter name with "..." prefix when parameter has no type annotation', () => {
    const parsed = makeFixture(`function fn(...a) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters?.[0].name).toBe('...a');
  });

  // I-5: AssignmentPattern parameter
  it('should set isOptional true and populate defaultValue when parameter has an assignment default', () => {
    const parsed = makeFixture(`function fn(x = 'hello') {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const param = fn?.parameters?.[0];
    expect(param?.name).toBe('x');
    expect(param?.isOptional).toBe(true);
    expect(param?.defaultValue).toBe("'hello'");
  });

  it('should set defaultValue to "0" when parameter default is a numeric zero literal', () => {
    const parsed = makeFixture(`function fn(x = 0) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const param = fn?.parameters?.[0];
    expect(param?.defaultValue).toBe('0');
  });

  it('should set isOptional true only for the parameter with a default when function mixes typed and defaulted parameters', () => {
    const parsed = makeFixture(`function fn(a: number, b = 'default') {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const b = fn?.parameters?.find((p) => p.name === 'b');
    expect(b?.isOptional).toBe(true);
  });

  it('should set isOptional true and populate defaultValue when typed parameter has an assignment default', () => {
    const parsed = makeFixture(`function fn(x: string = '') {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const param = fn?.parameters?.[0];
    expect(param?.isOptional).toBe(true);
    expect(param?.defaultValue).toBeDefined();
  });

  // I-6: multiple VariableDeclarators
  it('should extract one symbol per declarator when VariableDeclaration has multiple declarators', () => {
    const parsed = makeFixture(`const a = 1, b = 2;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'b')).toBe(true);
  });

  it('should mark all declarator symbols as isExported when exported VariableDeclaration has multiple declarators', () => {
    const parsed = makeFixture(`export const x = 1, y = 2;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find((s) => s.name === 'x')?.isExported).toBe(true);
    expect(symbols.find((s) => s.name === 'y')?.isExported).toBe(true);
  });

  it('should still extract symbol when VariableDeclaration has only a single declarator', () => {
    const parsed = makeFixture(`const a = 1;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find((s) => s.name === 'a')).toBeDefined();
  });

  // ArrayPattern destructuring
  it('should extract one variable symbol per Identifier element when VariableDeclarator id is an ArrayPattern', () => {
    const parsed = makeFixture(`const [a, b] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a' && s.kind === 'variable')).toBe(true);
    expect(symbols.some((s) => s.name === 'b' && s.kind === 'variable')).toBe(true);
  });

  it('should set isExported true for each ArrayPattern symbol when declaration has export keyword', () => {
    const parsed = makeFixture(`export const [x, y] = arr;`);
    const symbols = extractSymbols(parsed);
    const x = symbols.find((s) => s.name === 'x');
    const y = symbols.find((s) => s.name === 'y');
    expect(x?.isExported).toBe(true);
    expect(y?.isExported).toBe(true);
  });

  it('should return no symbols when ArrayPattern has no elements (empty destructuring)', () => {
    const parsed = makeFixture(`const [] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(0);
  });

  it('should skip null holes and extract only Identifier elements when ArrayPattern has sparse elements', () => {
    const parsed = makeFixture(`const [, b] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('b');
  });

  it('should extract no symbols when ArrayPattern contains only RestElement without Identifier elements', () => {
    const parsed = makeFixture(`const [...rest] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(0);
  });

  it('should extract only Identifier elements when ArrayPattern mixes Identifier with RestElement', () => {
    const parsed = makeFixture(`const [a, ...rest] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('a');
  });

  // findJsDocComment intervening node
  it('should leave jsDoc undefined when another AST statement intervenes between the JSDoc comment and the symbol', () => {
    const parsed = makeFixture(`/** doc */\nconst x = 1;\nfunction fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  // const modifier
  it('should include "const" in modifiers when enum declaration has const keyword', () => {
    const parsed = makeFixture(`const enum Direction { Up, Down }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Direction');
    expect(en?.modifiers).toContain('const');
  });

  it('should not include "const" in modifiers when enum declaration lacks const keyword', () => {
    const parsed = makeFixture(`enum Direction { Up, Down }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Direction');
    expect(en?.modifiers).not.toContain('const');
  });

  // ArrayPattern + ObjectPattern mixed
  it('should extract symbols from both ArrayPattern and ObjectPattern when both appear in the same scope', () => {
    const parsed = makeFixture(`const [a] = arr;\nconst { b } = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'b')).toBe(true);
  });
});
