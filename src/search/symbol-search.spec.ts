import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import { symbolSearch } from './symbol-search';
import type { ISymbolRepo, SymbolSearchQuery, SymbolSearchResult } from './symbol-search';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeSymbolRecord(overrides: Partial<SymbolRecord & { id: number }> = {}): SymbolRecord & { id: number } {
  return {
    id: 1,
    project: 'test-project',
    filePath: 'src/index.ts',
    kind: 'function',
    name: 'myFn',
    startLine: 1,
    startColumn: 0,
    endLine: 5,
    endColumn: 1,
    isExported: 1,
    signature: null,
    fingerprint: null,
    detailJson: null,
    contentHash: 'abc123',
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

let mockSearchByQuery: ReturnType<typeof mock>;
let mockRepo: ISymbolRepo;

beforeEach(() => {
  mockSearchByQuery = mock((_opts: unknown) => [] as (SymbolRecord & { id: number })[]);
  mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('symbolSearch', () => {
  // ── HP: text / FTS path ─────────────────────────────────────────────────

  it('should pass ftsQuery "User*" to searchByQuery when text is "User"', () => {
    // Arrange
    const query: SymbolSearchQuery = { text: 'User' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    expect(mockSearchByQuery).toHaveBeenCalledTimes(1);
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('User*');
  });

  it('should pass ftsQuery "User* Service*" to searchByQuery when text is "User Service"', () => {
    // Arrange
    const query: SymbolSearchQuery = { text: 'User Service' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('User* Service*');
  });

  it('should call searchByQuery without ftsQuery when kind-only filter is given', () => {
    // Arrange
    const query: SymbolSearchQuery = { kind: 'function' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
    expect(opts.kind).toBe('function');
  });

  it('should pass filePath filter to searchByQuery when filePath-only filter is given', () => {
    // Arrange
    const query: SymbolSearchQuery = { filePath: 'src/a.ts' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.filePath).toBe('src/a.ts');
  });

  it('should pass isExported=true to searchByQuery when isExported is true', () => {
    // Arrange
    const query: SymbolSearchQuery = { isExported: true };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.isExported).toBe(true);
  });

  it('should pass isExported=false to searchByQuery when isExported is false', () => {
    // Arrange
    const query: SymbolSearchQuery = { isExported: false };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.isExported).toBe(false);
  });

  // ── HP: project resolution ───────────────────────────────────────────────

  it('should use options.project as effectiveProject when query.project is absent', () => {
    // Arrange
    const query: SymbolSearchQuery = {};
    // Act
    symbolSearch({ symbolRepo: mockRepo, project: 'p1', query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p1');
  });

  it('should use query.project as effectiveProject when options.project is absent', () => {
    // Arrange
    const query: SymbolSearchQuery = { project: 'p2' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p2');
  });

  it('should use query.project and ignore options.project when both are set', () => {
    // Arrange
    const query: SymbolSearchQuery = { project: 'p2' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, project: 'p1', query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p2');
  });

  it('should pass effectiveProject=undefined when neither options.project nor query.project is set', () => {
    // Arrange
    const query: SymbolSearchQuery = {};
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBeUndefined();
  });

  // ── HP: limit ────────────────────────────────────────────────────────────

  it('should pass limit=10 to searchByQuery when query.limit is 10', () => {
    // Arrange
    const query: SymbolSearchQuery = { limit: 10 };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(10);
  });

  it('should pass limit=100 to searchByQuery when query.limit is absent', () => {
    // Arrange
    const query: SymbolSearchQuery = {};
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(100);
  });

  // ── HP: detail JSON parsing ───────────────────────────────────────────────

  it('should set result.detail to {} when detailJson is null', () => {
    // Arrange
    mockSearchByQuery = mock(() => [makeSymbolRecord({ detailJson: null })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.detail).toEqual({});
  });

  it('should parse detailJson and set result.detail when detailJson is a JSON string', () => {
    // Arrange
    mockSearchByQuery = mock(() => [makeSymbolRecord({ detailJson: '{"returnType":"void"}' })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.detail).toEqual({ returnType: 'void' });
  });

  // ── HP: isExported mapping ───────────────────────────────────────────────

  it('should set result.isExported=true when record.isExported is 1', () => {
    // Arrange
    mockSearchByQuery = mock(() => [makeSymbolRecord({ isExported: 1 })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.isExported).toBe(true);
  });

  it('should set result.isExported=false when record.isExported is 0', () => {
    // Arrange
    mockSearchByQuery = mock(() => [makeSymbolRecord({ isExported: 0 })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.isExported).toBe(false);
  });

  // ── HP: span mapping ─────────────────────────────────────────────────────

  it('should map startLine/startColumn/endLine/endColumn to result.span correctly', () => {
    // Arrange
    mockSearchByQuery = mock(() => [
      makeSymbolRecord({ startLine: 10, startColumn: 2, endLine: 20, endColumn: 5 }),
    ]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.span).toEqual({
      start: { line: 10, column: 2 },
      end: { line: 20, column: 5 },
    });
  });

  // ── HP: combined / all-filters ───────────────────────────────────────────

  it('should pass all filters to searchByQuery when all query fields are provided', () => {
    // Arrange
    const query: SymbolSearchQuery = {
      text: 'fn',
      kind: 'function',
      filePath: 'src/a.ts',
      isExported: true,
      project: 'proj',
      limit: 5,
    };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('fn*');
    expect(opts.kind).toBe('function');
    expect(opts.filePath).toBe('src/a.ts');
    expect(opts.isExported).toBe(true);
    expect(opts.project).toBe('proj');
    expect(opts.limit).toBe(5);
  });

  it('should return [] and call searchByQuery with limit=100 when empty query is given', () => {
    // Arrange — default mock returns []
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: {} });
    // Assert
    expect(results).toEqual([]);
    expect(mockSearchByQuery).toHaveBeenCalledTimes(1);
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(100);
  });

  it('should return [] when symbolRepo.searchByQuery returns empty array', () => {
    // Arrange — default mock returns []
    // Act
    const results = symbolSearch({ symbolRepo: mockRepo, query: { text: 'nothing' } });
    // Assert
    expect(results).toEqual([]);
  });

  // ── NE: error propagation ─────────────────────────────────────────────────

  it('should propagate error when symbolRepo.searchByQuery throws', () => {
    // Arrange
    mockSearchByQuery = mock(() => { throw new Error('db error'); });
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act + Assert
    expect(() => symbolSearch({ symbolRepo: mockRepo, query: {} })).toThrow('db error');
  });

  it('should propagate error when detailJson is invalid JSON', () => {
    // Arrange
    mockSearchByQuery = mock(() => [makeSymbolRecord({ detailJson: '{invalid' })]);
    mockRepo = { searchByQuery: mockSearchByQuery } as ISymbolRepo;
    // Act + Assert
    expect(() => symbolSearch({ symbolRepo: mockRepo, query: {} })).toThrow();
  });

  it('should call searchByQuery without ftsQuery when text is empty string', () => {
    // Arrange — "" is falsy, should skip FTS path
    const query: SymbolSearchQuery = { text: '' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
  });

  it('should pass limit=0 to searchByQuery when query.limit is 0', () => {
    // Arrange
    const query: SymbolSearchQuery = { limit: 0 };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(0);
  });

  // ── ED: edge cases ────────────────────────────────────────────────────────

  it('should produce ftsQuery "a*" when text is a single character "a"', () => {
    // Arrange
    const query: SymbolSearchQuery = { text: 'a' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBe('a*');
  });

  it('should escape special FTS5 characters in text before appending *', () => {
    // Arrange — text contains chars that must be escaped: "-*()"
    const query: SymbolSearchQuery = { text: 'fn-auth' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    const ftsQuery = opts.ftsQuery as string;
    // "-" should be escaped, and "*" appended at end
    expect(ftsQuery).toContain('\\-');
    expect(ftsQuery).toMatch(/\*$/);
  });

  // ── CO: corner cases ──────────────────────────────────────────────────────

  it('should skip FTS and apply kind filter when text is empty string and kind is set', () => {
    // Arrange — "" is falsy → B2 false branch; kind filter still applied
    const query: SymbolSearchQuery = { text: '', kind: 'function' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.ftsQuery).toBeUndefined();
    expect(opts.kind).toBe('function');
  });

  it('should use empty string as effectiveProject when query.project is "" (not null/undefined)', () => {
    // Arrange — "" ?? "real" = "" because ?? only coalesces null/undefined
    const query: SymbolSearchQuery = { project: '' };
    // Act
    symbolSearch({ symbolRepo: mockRepo, project: 'real', query });
    // Assert
    const opts = mockSearchByQuery.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('');
  });
});
