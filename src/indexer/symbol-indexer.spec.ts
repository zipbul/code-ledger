import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ParsedFile } from '../parser/types';

// ── Mock ../extractor/symbol-extractor ──────────────────────────────────────
const mockExtractSymbols = mock((_parsed: any) => [] as any[]);

// ── Mock ../common/hasher ────────────────────────────────────────────────────
const mockHashString = mock((_input: string) => 'fp-hash');

import { indexFileSymbols } from './symbol-indexer';

const PROJECT = 'test-project';
const FILE_PATH = 'src/index.ts';
const CONTENT_HASH = 'abc123';

function makeParsedFile(): ParsedFile {
  return { filePath: '/project/src/index.ts', program: {} as any, errors: [], comments: [], sourceText: '' };
}

function makeSymbol(overrides: Partial<{
  kind: string; name: string; isExported: boolean;
  parameters: any[]; returnType: string; modifiers: string[];
  heritage: any[]; decorators: any[]; members: any[];
  jsDoc: any; methodKind: string; typeParameters: string[];
}> = {}) {
  return {
    kind: 'function',
    name: 'myFn',
    span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
    isExported: true,
    modifiers: [],
    ...overrides,
  };
}

function makeSymbolRepo() {
  return { replaceFileSymbols: mock((_p: any, _f: any, _h: any, _syms: any) => {}) };
}

beforeEach(() => {
  mock.module('../extractor/symbol-extractor', () => ({ extractSymbols: mockExtractSymbols }));
  mock.module('../common/hasher', () => ({ hashString: mockHashString }));
  mockExtractSymbols.mockReset();
  mockExtractSymbols.mockReturnValue([]);
  mockHashString.mockReset();
  mockHashString.mockReturnValue('fp-hash');
});

describe('indexFileSymbols', () => {
  // [HP] function 2 params → signature='params:2|async:0'
  it('should set signature to params:2|async:0 when function has 2 params and is not async', () => {
    const sym = makeSymbol({ kind: 'function', parameters: [{ name: 'a', isOptional: false }, { name: 'b', isOptional: false }], modifiers: [] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBe('params:2|async:0');
  });

  // [HP] async function → signature='params:1|async:1'
  it('should set signature to params:1|async:1 when function is async with 1 param', () => {
    const sym = makeSymbol({ kind: 'function', parameters: [{ name: 'a', isOptional: false }], modifiers: ['async'] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBe('params:1|async:1');
  });

  // [HP] class with 3 methods → 4 rows (class + Class.m1 + Class.m2 + Class.m3)
  it('should produce 4 rows when class has 3 methods', () => {
    const cls = makeSymbol({
      kind: 'class', name: 'MyClass', modifiers: [],
      members: [
        makeSymbol({ kind: 'method', name: 'foo', modifiers: [] }),
        makeSymbol({ kind: 'method', name: 'bar', modifiers: [] }),
        makeSymbol({ kind: 'method', name: 'baz', modifiers: [] }),
      ],
    });
    mockExtractSymbols.mockReturnValue([cls]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.length).toBe(4);
    expect(symbols.some((s: any) => s.name === 'MyClass.foo')).toBe(true);
    expect(symbols.some((s: any) => s.name === 'MyClass.bar')).toBe(true);
    expect(symbols.some((s: any) => s.name === 'MyClass.baz')).toBe(true);
  });

  // [HP] symbol with jsDoc → detail_json.jsDoc present
  it('should include jsDoc in detail_json when symbol has jsDoc', () => {
    const sym = makeSymbol({ jsDoc: { description: 'A function', tags: [] } });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = JSON.parse(symbols[0].detailJson);
    expect(detail.jsDoc).toEqual({ description: 'A function', tags: [] });
  });

  // [ED] symbol without jsDoc → detail_json.jsDoc absent
  it('should omit jsDoc from detail_json when symbol has no jsDoc', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol()]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = symbols[0].detailJson ? JSON.parse(symbols[0].detailJson) : {};
    expect(detail.jsDoc).toBeUndefined();
  });

  // [ED] function 0 params → signature='params:0|async:0'
  it('should set signature to params:0|async:0 when function has no params', () => {
    const sym = makeSymbol({ kind: 'function', parameters: [], modifiers: [] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBe('params:0|async:0');
  });

  // [HP] type alias → signature null
  it('should set signature to null for type alias symbols', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol({ kind: 'type' })]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].signature).toBeNull();
  });

  // [HP] fingerprint = hash('name|kind|signature')
  it('should compute fingerprint as hash of name|kind|signature string', () => {
    mockHashString.mockReturnValue('fingerprint-val');
    const sym = makeSymbol({ kind: 'function', name: 'fn', parameters: [], modifiers: [] });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols[0].fingerprint).toBe('fingerprint-val');
    expect(mockHashString).toHaveBeenCalledWith(expect.stringContaining('fn'));
  });

  // [HP] replaceFileSymbols called with correct contentHash
  it('should call replaceFileSymbols with the provided contentHash', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol()]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: 'the-hash', symbolRepo: symbolRepo as any });

    const [, , hash] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(hash).toBe('the-hash');
  });

  // [ED] extractSymbols returns [] → replaceFileSymbols([]) called
  it('should call replaceFileSymbols with empty array when extractSymbols returns nothing', () => {
    mockExtractSymbols.mockReturnValue([]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols).toEqual([]);
  });

  // [HP] class with 0 members → 1 row only
  it('should produce 1 row when class has no members', () => {
    const cls = makeSymbol({ kind: 'class', name: 'Empty', members: [], modifiers: [] });
    mockExtractSymbols.mockReturnValue([cls]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe('Empty');
  });

  // [HP] interface members → flattened as 'Iface.prop'
  it('should flatten interface members as InterfaceName.memberName', () => {
    const iface = makeSymbol({
      kind: 'interface', name: 'IUser', members: [
        makeSymbol({ kind: 'property', name: 'id', modifiers: [] }),
      ],
    });
    mockExtractSymbols.mockReturnValue([iface]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.some((s: any) => s.name === 'IUser.id')).toBe(true);
  });

  // [CO] enum 3 members → 4 rows
  it('should produce 4 rows when enum has 3 members', () => {
    const en = makeSymbol({
      kind: 'enum', name: 'Color', members: [
        makeSymbol({ kind: 'property', name: 'Red', modifiers: [] }),
        makeSymbol({ kind: 'property', name: 'Green', modifiers: [] }),
        makeSymbol({ kind: 'property', name: 'Blue', modifiers: [] }),
      ],
    });
    mockExtractSymbols.mockReturnValue([en]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    expect(symbols.length).toBe(4);
  });

  // [HP] detail_json omits undefined optional fields
  it('should omit undefined fields from detail_json', () => {
    mockExtractSymbols.mockReturnValue([makeSymbol({ kind: 'variable' })]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const raw = symbols[0].detailJson;
    if (raw) {
      const detail = JSON.parse(raw);
      expect(Object.keys(detail)).not.toContain('parameters');
      expect(Object.keys(detail)).not.toContain('returnType');
    } else {
      expect(raw).toBeNull();
    }
  });

  // [HP] detail_json includes parameters and returnType for functions
  it('should include parameters and returnType in detail_json for function symbols', () => {
    const sym = makeSymbol({
      kind: 'function',
      parameters: [{ name: 'x', type: 'string', isOptional: false }],
      returnType: 'void',
      modifiers: [],
    });
    mockExtractSymbols.mockReturnValue([sym]);
    const symbolRepo = makeSymbolRepo();

    indexFileSymbols({ parsed: makeParsedFile(), project: PROJECT, filePath: FILE_PATH, contentHash: CONTENT_HASH, symbolRepo: symbolRepo as any });

    const [, , , symbols] = symbolRepo.replaceFileSymbols.mock.calls[0]!;
    const detail = JSON.parse(symbols[0].detailJson);
    expect(detail.parameters).toBeDefined();
    expect(detail.returnType).toBe('void');
  });
});
