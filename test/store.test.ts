import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from '../src/store/connection';
import { FileRepository } from '../src/store/repositories/file.repository';
import { SymbolRepository } from '../src/store/repositories/symbol.repository';
import { RelationRepository } from '../src/store/repositories/relation.repository';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeFileRecord(overrides: Partial<{
  project: string; filePath: string; mtimeMs: number;
  size: number; contentHash: string; updatedAt: string;
}> = {}) {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    mtimeMs: 1_000_000,
    size: 100,
    contentHash: 'abc123',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSymbolRecord(overrides: Partial<{
  project: string; filePath: string; kind: string; name: string;
  startLine: number; startColumn: number; endLine: number; endColumn: number;
  isExported: number; signature: string | null; fingerprint: string | null;
  detailJson: string | null; contentHash: string; indexedAt: string;
}> = {}) {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    kind: 'function',
    name: 'myFn',
    startLine: 1,
    startColumn: 0,
    endLine: 5,
    endColumn: 1,
    isExported: 1,
    signature: 'params:1|async:0',
    fingerprint: 'fp001',
    detailJson: null,
    contentHash: 'abc123',
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRelationRecord(overrides: Partial<{
  project: string; type: string; srcFilePath: string;
  srcSymbolName: string | null; dstFilePath: string;
  dstSymbolName: string | null; metaJson: string | null;
}> = {}) {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/index.ts',
    srcSymbolName: null,
    dstFilePath: 'src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

// ── Shared setup ───────────────────────────────────────────────────────────

let tmpDir: string;
let db: DbConnection;
let fileRepo: FileRepository;
let symbolRepo: SymbolRepository;
let relationRepo: RelationRepository;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'code-ledger-store-test-'));
  db = new DbConnection({ projectRoot: tmpDir });
  db.open();
  fileRepo = new FileRepository(db);
  symbolRepo = new SymbolRepository(db);
  relationRepo = new RelationRepository(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ── DbConnection ───────────────────────────────────────────────────────────

describe('DbConnection', () => {
  it('should create .zipbul/ directory when it does not exist', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, '.zipbul'))).toBe(true);
  });

  it('should enable WAL journal mode after open', () => {
    const result = db.transaction(() => {
      return db.query('PRAGMA journal_mode');
    });
    expect(result).toBe('wal');
  });

  it('should create all schema tables after migrations', () => {
    const tables = db.transaction(() => db.getTableNames());
    expect(tables).toContain('files');
    expect(tables).toContain('symbols');
    expect(tables).toContain('relations');
    expect(tables).toContain('watcher_owner');
  });

  it('should create symbols_fts virtual table after migrations', () => {
    const tables = db.transaction(() => db.getTableNames());
    expect(tables).toContain('symbols_fts');
  });

  it('should commit transaction fn return value', () => {
    const result = db.transaction(() => 42);
    expect(result).toBe(42);
  });

  it('should rollback transaction when fn throws', () => {
    const file = makeFileRecord();
    expect(() => {
      db.transaction(() => {
        fileRepo.upsertFile(file);
        throw new Error('rollback!');
      });
    }).toThrow('rollback!');
    expect(fileRepo.getFile('test-project', 'src/index.ts')).toBeNull();
  });

  it('should support nested transactions via savepoints', () => {
    const result = db.transaction(() => {
      return db.transaction(() => 'nested');
    });
    expect(result).toBe('nested');
  });

  it('should allow re-opening after close', () => {
    db.close();
    db.open();
    expect(() => db.transaction(() => 1)).not.toThrow();
  });

  it('should wrap migration failure with StoreError', async () => {
    const badDb = new DbConnection({ projectRoot: join(tmpDir, 'nonexistent-migrations') });
    // Should either succeed or throw StoreError; no plain Error slipthrough
    try {
      badDb.open();
      badDb.close();
    } catch (err: any) {
      expect(err.name).toBe('StoreError');
    }
  });
});

// ── FileRepository ─────────────────────────────────────────────────────────

describe('FileRepository', () => {
  it('should return null when file does not exist', () => {
    const result = fileRepo.getFile('test-project', 'src/missing.ts');
    expect(result).toBeNull();
  });

  it('should return FileRecord after upsert', () => {
    const file = makeFileRecord();
    fileRepo.upsertFile(file);
    const result = fileRepo.getFile('test-project', 'src/index.ts');
    expect(result).not.toBeNull();
    expect(result!.contentHash).toBe('abc123');
  });

  it('should update existing record on conflict', () => {
    fileRepo.upsertFile(makeFileRecord({ contentHash: 'old' }));
    fileRepo.upsertFile(makeFileRecord({ contentHash: 'new' }));
    const result = fileRepo.getFile('test-project', 'src/index.ts');
    expect(result!.contentHash).toBe('new');
  });

  it('should not create duplicate rows on re-upsert', () => {
    fileRepo.upsertFile(makeFileRecord());
    fileRepo.upsertFile(makeFileRecord());
    const all = fileRepo.getAllFiles('test-project');
    expect(all.length).toBe(1);
  });

  it('should return all files for project', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/a.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/b.ts' }));
    const all = fileRepo.getAllFiles('test-project');
    expect(all.length).toBe(2);
  });

  it('should return empty array for unknown project', () => {
    expect(fileRepo.getAllFiles('unknown-project')).toEqual([]);
  });

  it('should return files as Map keyed by filePath', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/a.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/b.ts' }));
    const map = fileRepo.getFilesMap('test-project');
    expect(map.size).toBe(2);
    expect(map.has('src/a.ts')).toBe(true);
    expect(map.has('src/b.ts')).toBe(true);
  });

  it('should remove file from db on deleteFile', () => {
    fileRepo.upsertFile(makeFileRecord());
    fileRepo.deleteFile('test-project', 'src/index.ts');
    expect(fileRepo.getFile('test-project', 'src/index.ts')).toBeNull();
  });

  it('should not throw on deleteFile when file does not exist', () => {
    expect(() => fileRepo.deleteFile('test-project', 'src/missing.ts')).not.toThrow();
  });

  it('should not return files from different project', () => {
    fileRepo.upsertFile(makeFileRecord({ project: 'other' }));
    expect(fileRepo.getAllFiles('test-project')).toEqual([]);
  });
});

// ── SymbolRepository ───────────────────────────────────────────────────────

describe('SymbolRepository', () => {
  beforeEach(() => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/index.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/utils.ts' }));
  });

  it('should return inserted symbols after replaceFileSymbols', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord(),
    ]);
    const result = symbolRepo.getFileSymbols('test-project', 'src/index.ts');
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('myFn');
  });

  it('should replace all symbols for file on second call', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'old' }),
    ]);
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc456', [
      makeSymbolRecord({ name: 'new' }),
    ]);
    const result = symbolRepo.getFileSymbols('test-project', 'src/index.ts');
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('new');
  });

  it('should clear all symbols when called with empty array', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc456', []);
    expect(symbolRepo.getFileSymbols('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should return empty array for unknown file', () => {
    expect(symbolRepo.getFileSymbols('test-project', 'src/missing.ts')).toEqual([]);
  });

  it('should find symbol by name prefix via FTS5', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'handleRequest' }),
    ]);
    const result = symbolRepo.searchByName('test-project', 'handleR');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe('handleRequest');
  });

  it('should return empty array when searchByName has no match', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    expect(symbolRepo.searchByName('test-project', 'zzzzNonExistent')).toEqual([]);
  });

  it('should filter searchByName by kind', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'MyClass', kind: 'class' }),
      makeSymbolRecord({ name: 'myFn', kind: 'function', fingerprint: 'fp002' }),
    ]);
    const result = symbolRepo.searchByName('test-project', 'my', { kind: 'class' });
    expect(result.every((r) => r.kind === 'class')).toBe(true);
  });

  it('should cap results at limit in searchByName', () => {
    const symbols = Array.from({ length: 10 }, (_, i) =>
      makeSymbolRecord({ name: `fn${i}`, fingerprint: `fp${i}` }),
    );
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', symbols);
    const result = symbolRepo.searchByName('test-project', 'fn', { limit: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('should return symbols by kind via searchByKind', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ kind: 'class', name: 'MyClass', fingerprint: 'fp-c' }),
      makeSymbolRecord({ kind: 'function', name: 'myFn', fingerprint: 'fp-f' }),
    ]);
    const result = symbolRepo.searchByKind('test-project', 'class');
    expect(result.every((r) => r.kind === 'class')).toBe(true);
  });

  it('should return correct stats', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/extra.ts' }));
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'fn1', fingerprint: 'fp1' }),
      makeSymbolRecord({ name: 'fn2', fingerprint: 'fp2' }),
    ]);
    symbolRepo.replaceFileSymbols('test-project', 'src/extra.ts', 'zzz', [
      makeSymbolRecord({ filePath: 'src/extra.ts', name: 'fn3', fingerprint: 'fp3' }),
    ]);
    const stats = symbolRepo.getStats('test-project');
    expect(stats.symbolCount).toBe(3);
  });

  it('should return symbols by fingerprint', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ fingerprint: 'unique-fp' }),
    ]);
    const result = symbolRepo.getByFingerprint('test-project', 'unique-fp');
    expect(result.length).toBe(1);
  });

  it('should return empty array for unknown fingerprint', () => {
    expect(symbolRepo.getByFingerprint('test-project', 'no-such-fp')).toEqual([]);
  });

  it('should remove all symbols on deleteFileSymbols', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    symbolRepo.deleteFileSymbols('test-project', 'src/index.ts');
    expect(symbolRepo.getFileSymbols('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should cascade-delete symbols when file is deleted via FK', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymbolRecord()]);
    fileRepo.deleteFile('test-project', 'src/index.ts');
    expect(symbolRepo.getFileSymbols('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should reflect FTS5 insert immediately after replaceFileSymbols', () => {
    symbolRepo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [
      makeSymbolRecord({ name: 'freshSymbol', fingerprint: 'fp-fresh' }),
    ]);
    const result = symbolRepo.searchByName('test-project', 'freshSymbol');
    expect(result.length).toBe(1);
  });
});

// ── RelationRepository ─────────────────────────────────────────────────────

describe('RelationRepository', () => {
  beforeEach(() => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/index.ts' }));
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/utils.ts' }));
  });

  it('should return outgoing relations after replaceFileRelations', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    const result = relationRepo.getOutgoing('test-project', 'src/index.ts');
    expect(result.length).toBe(1);
  });

  it('should replace relations on second replaceFileRelations call', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', []);
    expect(relationRepo.getOutgoing('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should return empty array for unknown src file', () => {
    expect(relationRepo.getOutgoing('test-project', 'src/nothing.ts')).toEqual([]);
  });

  it('should return only matching srcSymbolName via getOutgoing filter', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [
      makeRelationRecord({ srcSymbolName: 'myFn' }),
      makeRelationRecord({ srcSymbolName: null, type: 'imports', dstFilePath: 'src/other.ts' }),
    ]);
    const result = relationRepo.getOutgoing('test-project', 'src/index.ts', 'myFn');
    expect(result.every((r) => r.srcSymbolName === 'myFn')).toBe(true);
  });

  it('should return incoming relations for dstFilePath', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    const result = relationRepo.getIncoming('test-project', 'src/utils.ts');
    expect(result.length).toBe(1);
  });

  it('should return empty array for unknown dst file', () => {
    expect(relationRepo.getIncoming('test-project', 'src/nothing.ts')).toEqual([]);
  });

  it('should return only matching type via getByType', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [
      makeRelationRecord({ type: 'imports' }),
    ]);
    const result = relationRepo.getByType('test-project', 'imports');
    expect(result.every((r) => r.type === 'imports')).toBe(true);
  });

  it('should remove all src relations on deleteFileRelations', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    relationRepo.deleteFileRelations('test-project', 'src/index.ts');
    expect(relationRepo.getOutgoing('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should retarget relations from old to new symbol', () => {
    fileRepo.upsertFile(makeFileRecord({ filePath: 'src/new.ts' }));
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [
      makeRelationRecord({ dstFilePath: 'src/utils.ts', dstSymbolName: 'OldFn' }),
    ]);
    relationRepo.retargetRelations(
      'test-project',
      'src/utils.ts', 'OldFn',
      'src/new.ts', 'NewFn',
    );
    const updated = relationRepo.getIncoming('test-project', 'src/new.ts');
    expect(updated.some((r) => r.dstSymbolName === 'NewFn')).toBe(true);
  });

  it('should cascade-delete relations when src file is deleted', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    fileRepo.deleteFile('test-project', 'src/index.ts');
    expect(relationRepo.getOutgoing('test-project', 'src/index.ts')).toEqual([]);
  });

  it('should not return relations from different project', () => {
    relationRepo.replaceFileRelations('test-project', 'src/index.ts', [makeRelationRecord()]);
    expect(relationRepo.getOutgoing('other-project', 'src/index.ts')).toEqual([]);
  });
});
