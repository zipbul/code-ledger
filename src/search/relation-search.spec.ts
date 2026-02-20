import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RelationRecord } from '../store/repositories/relation.repository';
import { relationSearch } from './relation-search';
import type { IRelationRepo, RelationSearchQuery } from './relation-search';
import type { CodeRelation } from '../extractor/types';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeRelationRecord(overrides: Partial<RelationRecord> = {}): RelationRecord {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/a.ts',
    srcSymbolName: null,
    dstFilePath: 'src/b.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

let mockSearchRelations: ReturnType<typeof mock>;
let mockRepo: IRelationRepo;

beforeEach(() => {
  mockSearchRelations = mock((_opts: unknown) => [] as RelationRecord[]);
  mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('relationSearch', () => {
  // ── HP: individual filters ────────────────────────────────────────────────

  it('should pass srcFilePath to searchRelations when srcFilePath is set', () => {
    // Arrange
    const query: RelationSearchQuery = { srcFilePath: 'src/a.ts' };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.srcFilePath).toBe('src/a.ts');
  });

  it('should pass srcSymbolName to searchRelations when srcSymbolName is set', () => {
    // Arrange
    const query: RelationSearchQuery = { srcSymbolName: 'myFn' };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.srcSymbolName).toBe('myFn');
  });

  it('should pass dstFilePath to searchRelations when dstFilePath is set', () => {
    // Arrange
    const query: RelationSearchQuery = { dstFilePath: 'src/b.ts' };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.dstFilePath).toBe('src/b.ts');
  });

  it('should pass dstSymbolName to searchRelations when dstSymbolName is set', () => {
    // Arrange
    const query: RelationSearchQuery = { dstSymbolName: 'MyClass' };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.dstSymbolName).toBe('MyClass');
  });

  it('should pass type to searchRelations when type is set', () => {
    // Arrange
    const query: RelationSearchQuery = { type: 'imports' };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.type).toBe('imports');
  });

  // ── HP: project resolution ────────────────────────────────────────────────

  it('should use options.project as effectiveProject when query.project is absent', () => {
    // Arrange
    const query: RelationSearchQuery = {};
    // Act
    relationSearch({ relationRepo: mockRepo, project: 'p1', query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p1');
  });

  it('should use query.project as effectiveProject and override options.project', () => {
    // Arrange
    const query: RelationSearchQuery = { project: 'p2' };
    // Act
    relationSearch({ relationRepo: mockRepo, project: 'p1', query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('p2');
  });

  it('should pass effectiveProject=undefined when neither project is set', () => {
    // Arrange
    const query: RelationSearchQuery = {};
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBeUndefined();
  });

  // ── HP: limit ─────────────────────────────────────────────────────────────

  it('should pass limit=50 to searchRelations when query.limit is 50', () => {
    // Arrange
    const query: RelationSearchQuery = { limit: 50 };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(50);
  });

  it('should pass limit=500 to searchRelations when query.limit is absent', () => {
    // Arrange
    const query: RelationSearchQuery = {};
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(500);
  });

  // ── HP: null → undefined mapping ──────────────────────────────────────────

  it('should set result.srcSymbolName=null when record.srcSymbolName is null', () => {
    // Arrange
    mockSearchRelations = mock(() => [makeRelationRecord({ srcSymbolName: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.srcSymbolName).toBeNull();
  });

  it('should preserve result.srcSymbolName when record.srcSymbolName is a string', () => {
    // Arrange
    mockSearchRelations = mock(() => [makeRelationRecord({ srcSymbolName: 'myFn' })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.srcSymbolName).toBe('myFn');
  });

  it('should set result.dstSymbolName=null when record.dstSymbolName is null', () => {
    // Arrange
    mockSearchRelations = mock(() => [makeRelationRecord({ dstSymbolName: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.dstSymbolName).toBeNull();
  });

  it('should set result.metaJson=undefined when record.metaJson is null', () => {
    // Arrange
    mockSearchRelations = mock(() => [makeRelationRecord({ metaJson: null })]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results[0]!.metaJson).toBeUndefined();
  });

  // ── HP: combined / empty query ────────────────────────────────────────────

  it('should call searchRelations with limit=500 and no filters when empty query is given', () => {
    // Arrange
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results).toEqual([]);
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(500);
  });

  it('should pass all filters to searchRelations when all query fields are provided', () => {
    // Arrange
    const query: RelationSearchQuery = {
      srcFilePath: 'src/a.ts',
      srcSymbolName: 'fn',
      dstFilePath: 'src/b.ts',
      dstSymbolName: 'cls',
      type: 'calls',
      project: 'proj',
      limit: 10,
    };
    // Act
    relationSearch({ relationRepo: mockRepo, query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.srcFilePath).toBe('src/a.ts');
    expect(opts.srcSymbolName).toBe('fn');
    expect(opts.dstFilePath).toBe('src/b.ts');
    expect(opts.dstSymbolName).toBe('cls');
    expect(opts.type).toBe('calls');
    expect(opts.project).toBe('proj');
    expect(opts.limit).toBe(10);
  });

  // ── NE: error propagation ─────────────────────────────────────────────────

  it('should propagate error when relationRepo.searchRelations throws', () => {
    // Arrange
    mockSearchRelations = mock(() => { throw new Error('db error'); });
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    // Act + Assert
    expect(() => relationSearch({ relationRepo: mockRepo, query: {} })).toThrow('db error');
  });

  it('should return [] when searchRelations returns empty array', () => {
    // Arrange — default mock returns []
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results).toEqual([]);
  });

  // ── CO: corner case ───────────────────────────────────────────────────────

  it('should use empty string as effectiveProject when query.project is "" (not null/undefined)', () => {
    // Arrange — "" ?? "real" = "" (nullish coalescing skips only null/undefined)
    const query: RelationSearchQuery = { project: '' };
    // Act
    relationSearch({ relationRepo: mockRepo, project: 'real', query });
    // Assert
    const opts = mockSearchRelations.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.project).toBe('');
  });

  // ── ED: edge case ─────────────────────────────────────────────────────────

  it('should map a single RelationRecord to a single CodeRelation correctly', () => {
    // Arrange
    mockSearchRelations = mock(() => [
      makeRelationRecord({
        type: 'imports',
        srcFilePath: 'src/a.ts',
        srcSymbolName: 'fnA',
        dstFilePath: 'src/b.ts',
        dstSymbolName: 'fnB',
        metaJson: '{}',
      }),
    ]);
    mockRepo = { searchRelations: mockSearchRelations } as IRelationRepo;
    // Act
    const results = relationSearch({ relationRepo: mockRepo, query: {} });
    // Assert
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.type).toBe('imports');
    expect(r.srcFilePath).toBe('src/a.ts');
    expect(r.srcSymbolName).toBe('fnA');
    expect(r.dstFilePath).toBe('src/b.ts');
    expect(r.dstSymbolName).toBe('fnB');
    expect(r.metaJson).toBe('{}');
  });
});
