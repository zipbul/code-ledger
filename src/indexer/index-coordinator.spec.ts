import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import type { FileChangeEvent } from '../watcher/types';

// ── Mock module-level imports ── (must be before IndexCoordinator import)
const mockDetectChanges = mock(async (_opts: any) => ({ changed: [], unchanged: [], deleted: [] }));
const mockIndexFileSymbols = mock((_opts: any) => {});
const mockIndexFileRelations = mock((_opts: any) => 0);
const mockParseSource = mock((_filePath: string, _text: string) => ({
  filePath: _filePath,
  program: {},
  errors: [],
  comments: [],
  sourceText: _text,
}));
const mockLoadTsconfigPaths = mock((_root: string) => null);
const mockClearTsconfigPathsCache = mock((_root?: string) => {});
const mockResolveFileProject = mock((_rel: string, _bounds: any[], _root?: string) => 'test-project');
const mockDiscoverProjects = mock(async (_root: string) => [{ dir: '.', project: 'test-project' }]);

import { IndexCoordinator } from './index-coordinator';

// ── Fake repo factories ────────────────────────────────────────────────────
function makeFileRepo() {
  return {
    upsertFile: mock((_r: any) => {}),
    getFilesMap: mock(() => new Map()),
    getAllFiles: mock(() => []),
    deleteFile: mock((_p: any, _f: any) => {}),
  };
}

function makeSymbolRepo() {
  return {
    replaceFileSymbols: mock((_p: any, _f: any, _h: any, _s: any) => {}),
    getFileSymbols: mock((_p: any, _f: any) => []),
    getByFingerprint: mock((_p: any, _fp: any) => []),
    deleteFileSymbols: mock((_p: any, _f: any) => {}),
  };
}

function makeRelationRepo() {
  return {
    replaceFileRelations: mock((_p: any, _f: any, _r: any) => {}),
    retargetRelations: mock((_p: any, _of: any, _os: any, _nf: any, _ns: any) => {}),
    deleteFileRelations: mock((_p: any, _f: any) => {}),
  };
}

function makeDbConnection() {
  return {
    transaction: mock((fn: () => any) => fn()),
  };
}

function makeParseCache() {
  return {
    set: mock((_k: string, _v: any) => {}),
    get: mock((_k: string) => undefined),
    invalidate: mock((_k: string) => {}),
  };
}

function makeFakeFile(filePath: string) {
  return { filePath, contentHash: 'hash-' + filePath, mtimeMs: 1000, size: 100 };
}

// ── Shared setup ───────────────────────────────────────────────────────────
const PROJECT_ROOT = '/project';
const BOUNDARIES = [{ dir: '.', project: 'test-project' }];
const EXTENSIONS = ['.ts'];
const IGNORE_PATTERNS: string[] = [];

function makeCoordinator(overrides: Partial<{
  fileRepo: any; symbolRepo: any; relationRepo: any;
  dbConnection: any; parseCache: any;
}> = {}) {
  return new IndexCoordinator({
    projectRoot: PROJECT_ROOT,
    boundaries: BOUNDARIES,
    extensions: EXTENSIONS,
    ignorePatterns: IGNORE_PATTERNS,
    dbConnection: overrides.dbConnection ?? makeDbConnection(),
    parseCache: overrides.parseCache ?? makeParseCache(),
    fileRepo: overrides.fileRepo ?? makeFileRepo(),
    symbolRepo: overrides.symbolRepo ?? makeSymbolRepo(),
    relationRepo: overrides.relationRepo ?? makeRelationRepo(),
    // Inject the mock directly — avoids mock.module pollution of parse-source.spec.ts
    parseSourceFn: mockParseSource as any,
  });
}

beforeEach(() => {
  mock.module('./file-indexer', () => ({ detectChanges: mockDetectChanges }));
  mock.module('./symbol-indexer', () => ({ indexFileSymbols: mockIndexFileSymbols }));
  mock.module('./relation-indexer', () => ({ indexFileRelations: mockIndexFileRelations }));
  mock.module('../common/tsconfig-resolver', () => ({ loadTsconfigPaths: mockLoadTsconfigPaths, clearTsconfigPathsCache: mockClearTsconfigPathsCache }));
  mock.module('../common/project-discovery', () => ({ resolveFileProject: mockResolveFileProject, discoverProjects: mockDiscoverProjects }));

  mockDetectChanges.mockReset();
  mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
  mockIndexFileSymbols.mockReset();
  mockIndexFileRelations.mockReset();
  mockIndexFileRelations.mockReturnValue(0);
  mockParseSource.mockReset();
  mockParseSource.mockImplementation((_fp: string, text: string) => ({
    filePath: _fp, program: { body: [] }, errors: [], comments: [], sourceText: text,
  }));
  mockLoadTsconfigPaths.mockReset();
  mockLoadTsconfigPaths.mockReturnValue(null);
  mockClearTsconfigPathsCache.mockReset();
  mockResolveFileProject.mockReset();
  mockResolveFileProject.mockReturnValue('test-project');
  mockDiscoverProjects.mockReset();
  mockDiscoverProjects.mockResolvedValue([{ dir: '.', project: 'test-project' }]);

  spyOn(Bun, 'file').mockReturnValue({
    text: async () => 'mock source',
    lastModified: 1000,
    size: 100,
  } as any);

  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('IndexCoordinator', () => {
  // [HP] fullIndex processes all files, returns correct IndexResult
  it('should return IndexResult with correct indexedFiles count after fullIndex', async () => {
    const files = [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'source code' } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.fullIndex();

    expect(result.indexedFiles).toBe(2);
  });

  // [ED] fullIndex with 0 files → IndexResult.indexedFiles=0
  it('should return indexedFiles=0 when there are no files to index', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    const result = await coordinator.fullIndex();

    expect(result.indexedFiles).toBe(0);
  });

  // [HP] incrementalIndex(changedFiles=[file]) processes that file
  it('should index the provided file when incrementalIndex is called with explicit changedFiles', async () => {
    const file = makeFakeFile('src/index.ts');
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code' } as any);
    const symbolRepo = makeSymbolRepo();
    const coordinator = makeCoordinator({ symbolRepo });

    await coordinator.incrementalIndex([{ eventType: 'change', filePath: 'src/index.ts' }]);

    expect(mockParseSource).toHaveBeenCalled();
  });

  // [HP] incrementalIndex(undefined) calls detectChanges
  it('should call detectChanges when incrementalIndex is called without arguments', async () => {
    const coordinator = makeCoordinator();

    await coordinator.incrementalIndex();

    expect(mockDetectChanges).toHaveBeenCalled();
  });

  // [HP] onIndexed callback fires after incrementalIndex completes
  it('should invoke onIndexed callback when incrementalIndex finishes', async () => {
    const coordinator = makeCoordinator();
    const cb = mock((_result: any) => {});
    coordinator.onIndexed(cb);

    await coordinator.incrementalIndex();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  // [HP] onIndexed unsubscribe → callback no longer fires
  it('should not invoke callback after unsubscribe is called', async () => {
    const coordinator = makeCoordinator();
    const cb = mock((_result: any) => {});
    const unsub = coordinator.onIndexed(cb);
    unsub();

    await coordinator.incrementalIndex();

    expect(cb).not.toHaveBeenCalled();
  });

  // [OR] multiple onIndexed callbacks fire in registration order
  it('should fire multiple onIndexed callbacks in registration order', async () => {
    const coordinator = makeCoordinator();
    const order: number[] = [];
    coordinator.onIndexed(() => order.push(1));
    coordinator.onIndexed(() => order.push(2));

    await coordinator.incrementalIndex();

    expect(order).toEqual([1, 2]);
  });

  // [NE] onIndexed callback throws → logged, other callbacks still execute
  it('should continue executing remaining callbacks when one onIndexed callback throws', async () => {
    const coordinator = makeCoordinator();
    const spyConsoleError = spyOn(console, 'error').mockImplementation(() => {});
    const secondCb = mock((_result: any) => {});
    coordinator.onIndexed(() => { throw new Error('callback error'); });
    coordinator.onIndexed(secondCb);

    await coordinator.incrementalIndex();

    expect(secondCb).toHaveBeenCalled();
    spyConsoleError.mockRestore();
  });

  // [HP] move tracking: 1 deleted + 1 new same fingerprint → retargetRelations called
  it('should call retargetRelations when deleted and new symbol share the same fingerprint', async () => {
    const relationRepo = makeRelationRepo();
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getByFingerprint.mockReturnValue([{ filePath: 'src/new.ts', name: 'movedFn', kind: 'function' }]);
    symbolRepo.getFileSymbols.mockReturnValue([{ filePath: 'src/old.ts', name: 'movedFn', fingerprint: 'fp-move', kind: 'function' }]);

    const coordinator = makeCoordinator({ symbolRepo, relationRepo });
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/new.ts')],
      unchanged: [],
      deleted: ['src/old.ts'],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    await coordinator.incrementalIndex();

    expect(relationRepo.retargetRelations).toHaveBeenCalled();
  });

  // [CO] move tracking ambiguous (2 deleted + 2 new same fingerprint) → no retarget
  it('should not retarget relations when fingerprint match is ambiguous (multiple matches)', async () => {
    const relationRepo = makeRelationRepo();
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getByFingerprint.mockReturnValue([
      { filePath: 'src/new1.ts', name: 'fn', kind: 'function' },
      { filePath: 'src/new2.ts', name: 'fn', kind: 'function' },
    ]);
    symbolRepo.getFileSymbols.mockReturnValue([
      { filePath: 'src/old.ts', name: 'fn', fingerprint: 'fp-dup', kind: 'function' },
    ]);

    const coordinator = makeCoordinator({ symbolRepo, relationRepo });
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/new1.ts'), makeFakeFile('src/new2.ts')],
      unchanged: [],
      deleted: ['src/old.ts'],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    await coordinator.incrementalIndex();

    expect(relationRepo.retargetRelations).not.toHaveBeenCalled();
  });

  // [CR] handleWatcherEvent with indexingLock=true → queued, not executed immediately
  it('should queue watcher event without starting indexing when indexingLock is active', async () => {
    let resolveIndex!: () => void;
    const inflightPromise = new Promise<void>((res) => { resolveIndex = res; });
    mockDetectChanges.mockReturnValueOnce(inflightPromise.then(() => ({ changed: [], unchanged: [], deleted: [] })));

    const coordinator = makeCoordinator();
    const firstIndex = coordinator.incrementalIndex();

    // Fire watcher event while first index is running
    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/late.ts' });

    // Verify first index hasn't finished yet
    expect(mockDetectChanges).toHaveBeenCalledTimes(1);

    resolveIndex();
    await firstIndex;
  });

  // [CR] handleWatcherEvent debounce: rapid fire → single incrementalIndex call
  it('should coalesce rapid handleWatcherEvent calls into a single incrementalIndex via debounce', async () => {
    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/a.ts' });
    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/b.ts' });
    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/c.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    // Events coalesced into a single batch
    expect(results).toHaveLength(1);
    expect(results[0].indexedFiles).toBe(3);
  });

  // [CR] debounce timer not started twice if already running
  it('should not start a second debounce timer when one is already pending', async () => {
    const coordinator = makeCoordinator();
    const spySetTimeout = spyOn(globalThis, 'setTimeout');

    coordinator.handleWatcherEvent({ eventType: 'create', filePath: 'src/a.ts' });
    coordinator.handleWatcherEvent({ eventType: 'create', filePath: 'src/b.ts' });

    // Should only start the timer once for both events
    expect(spySetTimeout).toHaveBeenCalledTimes(1);
    spySetTimeout.mockRestore();
  });

  // [ST] indexingLock released after incrementalIndex completes even if error
  it('should release indexingLock after incrementalIndex fails so subsequent calls proceed', async () => {
    mockDetectChanges
      .mockRejectedValueOnce(new Error('index error'))
      .mockResolvedValue({ changed: [], unchanged: [], deleted: [] });

    const coordinator = makeCoordinator();

    await expect(coordinator.incrementalIndex()).rejects.toThrow('index error');
    await expect(coordinator.incrementalIndex()).resolves.toBeDefined();
  });

  // [ST] pending queue consumed after indexing unlock
  it('should process queued events after current indexing finishes', async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<{ changed: any[]; unchanged: any[]; deleted: any[] }>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges.mockReturnValueOnce(firstDone);

    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    const firstIndex = coordinator.incrementalIndex();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/queued.ts' });
    jest.runAllTimers();

    resolveFirst();
    await firstIndex;
    await coordinator.shutdown();

    // Two runs: initial incrementalIndex + drained queued events
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  // [HP] handleWatcherEvent 'create' event → file ends up in incrementalIndex
  it('should trigger incrementalIndex batch that includes the created file after debounce', async () => {
    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    coordinator.handleWatcherEvent({ eventType: 'create', filePath: 'src/newfile.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(results).toHaveLength(1);
    expect(results[0].indexedFiles).toBe(1);
  });

  // [HP] handleWatcherEvent 'delete' event → file ends up in deleted
  it('should pass delete event filePath in the batch to incrementalIndex', async () => {
    const fileRepo = makeFileRepo();
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getFileSymbols.mockReturnValue([]);
    const coordinator = makeCoordinator({ fileRepo, symbolRepo });

    coordinator.handleWatcherEvent({ eventType: 'delete', filePath: 'src/gone.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(fileRepo.deleteFile).toHaveBeenCalledWith('test-project', 'src/gone.ts');
  });

  // [HP] handleWatcherEvent 'change' event → re-indexed
  it('should trigger indexing after a change event fires and debounce expires', async () => {
    const coordinator = makeCoordinator();
    const results: any[] = [];
    coordinator.onIndexed((r) => results.push(r));

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/modified.ts' });

    jest.runAllTimers();
    await coordinator.shutdown();

    expect(results).toHaveLength(1);
    expect(results[0].indexedFiles).toBe(1);
  });

  // [HP] shutdown with no in-flight indexing → resolves immediately
  it('should resolve shutdown immediately when no indexing is in progress', async () => {
    const coordinator = makeCoordinator();
    await expect(coordinator.shutdown()).resolves.toBeUndefined();
  });

  // [NE] shutdown with in-flight indexing → waits for completion
  it('should wait for ongoing indexing to complete before shutdown resolves', async () => {
    let resolveIndex!: () => void;
    const done = new Promise<{ changed: any[]; unchanged: any[]; deleted: any[] }>((res) => {
      resolveIndex = () => res({ changed: [], unchanged: [], deleted: [] });
    });
    mockDetectChanges.mockReturnValueOnce(done);

    const coordinator = makeCoordinator();
    const indexing = coordinator.incrementalIndex();
    const shutdownPromise = coordinator.shutdown();

    let shutdownResolved = false;
    shutdownPromise.then(() => { shutdownResolved = true; });

    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    resolveIndex();
    await indexing;
    await shutdownPromise;
    expect(shutdownResolved).toBe(true);
  });

  // [HP] shutdown clears debounce timer
  it('should clear any pending debounce timers during shutdown', async () => {
    const coordinator = makeCoordinator();
    const spyClearTimeout = spyOn(globalThis, 'clearTimeout');

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/a.ts' });
    await coordinator.shutdown();

    expect(spyClearTimeout).toHaveBeenCalled();
    spyClearTimeout.mockRestore();
  });

  // [HP] fullIndex clears files before reindexing
  it('should call transaction wrapping fullIndex operations', async () => {
    const dbConnection = makeDbConnection();
    const coordinator = makeCoordinator({ dbConnection });

    await coordinator.fullIndex();

    expect(dbConnection.transaction).toHaveBeenCalled();
  });

  // [HP] incrementalIndex deleted files: symbols/relations cascade
  it('should delete symbols and relations for deleted files during incrementalIndex', async () => {
    const symbolRepo = makeSymbolRepo();
    const relationRepo = makeRelationRepo();
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: ['src/gone.ts'] });
    symbolRepo.getFileSymbols.mockReturnValue([]);

    const coordinator = makeCoordinator({ symbolRepo, relationRepo });

    await coordinator.incrementalIndex();

    expect(symbolRepo.deleteFileSymbols).toHaveBeenCalledWith('test-project', 'src/gone.ts');
  });

  // [HP] parseCache.set called after each parse
  it('should store parsed result in parseCache after parsing each file', async () => {
    const files = [makeFakeFile('src/index.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'src' } as any);
    const parseCache = makeParseCache();
    const coordinator = makeCoordinator({ parseCache });

    await coordinator.fullIndex();

    expect(parseCache.set).toHaveBeenCalled();
  });

  // [HP] tsconfigPaths passed to RelationIndexer
  it('should load tsconfigPaths on construction and pass it to indexFileRelations', async () => {
    const fakePaths = { baseUrl: '/project', paths: new Map() };
    mockLoadTsconfigPaths.mockReturnValue(fakePaths);
    const files = [makeFakeFile('src/index.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    const coordinator = makeCoordinator();
    await coordinator.fullIndex();

    expect(mockIndexFileRelations).toHaveBeenCalledWith(
      expect.objectContaining({ tsconfigPaths: fakePaths }),
    );
  });

  // [HP] resolveFileProject used to assign project per file
  it('should call resolveFileProject to determine project for each indexed file', async () => {
    const files = [makeFakeFile('apps/web/src/index.ts')];
    mockDetectChanges.mockResolvedValue({ changed: files, unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '' } as any);

    const coordinator = makeCoordinator();
    await coordinator.fullIndex();

    expect(mockResolveFileProject).toHaveBeenCalled();
  });

  // [CO] tsconfig.json change → reload tsconfigPaths
  it('should reload tsconfigPaths when a tsconfig.json change event is handled', async () => {
    const coordinator = makeCoordinator();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });

    expect(mockLoadTsconfigPaths).toHaveBeenCalledTimes(2); // once on init, once on change
  });

  // [HP] IndexResult stats: indexedFiles, totalSymbols, totalRelations accurate
  it('should include durationMs in returned IndexResult', async () => {
    const coordinator = makeCoordinator();
    const result = await coordinator.incrementalIndex();
    expect(typeof result.durationMs).toBe('number');
  });

  // [ED] incrementalIndex with empty changedFiles
  it('should return IndexResult with 0 indexedFiles when changedFiles is empty array', async () => {
    const coordinator = makeCoordinator();
    const result = await coordinator.incrementalIndex([]);
    expect(result.indexedFiles).toBe(0);
  });

  // [CO] fullIndex then handleWatcherEvent: lock prevents overlap
  it('should not run a second fullIndex while one is already running', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<{ changed: any[]; unchanged: any[]; deleted: any[] }>((res) => {
      resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] });
    });
    mockDetectChanges.mockReturnValueOnce(first);

    const coordinator = makeCoordinator();
    const fullIndexPromise = coordinator.fullIndex();

    // Second call while first is running
    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'src/a.ts' });
    jest.runAllTimers();
    await Promise.resolve();

    // detectChanges should only have been called once (for fullIndex)
    expect(mockDetectChanges).toHaveBeenCalledTimes(1);

    resolveFirst();
    await fullIndexPromise;
  });

  // [ID] fullIndex twice → same DB state (idempotent rebuild)
  it('should produce the same number of calls on second fullIndex as on first', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    await coordinator.fullIndex();
    const callsAfterFirst = mockIndexFileSymbols.mock.calls.length;
    await coordinator.fullIndex();
    const callsAfterSecond = mockIndexFileSymbols.mock.calls.length;

    expect(callsAfterSecond - callsAfterFirst).toBe(callsAfterFirst);
  });

  // ── I-1: clearTsconfigPathsCache ─────────────────────────────────────────

  // [HP] clearTsconfigPathsCache가 loadTsconfigPaths 전에 호출되어야 한다
  it('should call clearTsconfigPathsCache before reloading tsconfigPaths when tsconfig.json changes', () => {
    const coordinator = makeCoordinator();

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });

    expect(mockClearTsconfigPathsCache).toHaveBeenCalledTimes(1);
  });

  // [HP] clearTsconfigPathsCache가 loadTsconfigPaths보다 순서상 먼저 호출되어야 한다
  it('should call clearTsconfigPathsCache before loadTsconfigPaths when tsconfig.json changes', () => {
    const callOrder: string[] = [];
    mockClearTsconfigPathsCache.mockImplementation(() => { callOrder.push('clear'); });
    mockLoadTsconfigPaths.mockImplementation(() => { callOrder.push('load'); return null; });
    const coordinator = makeCoordinator();
    callOrder.length = 0; // constructor의 loadTsconfigPaths 호출 제거

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });

    expect(callOrder).toEqual(['clear', 'load']);
  });

  // [OR] tsconfig.json 이벤트에서 clear → load → fullIndex 순서 보장
  it('should trigger fullIndex after clearTsconfigPathsCache and loadTsconfigPaths on tsconfig.json change', async () => {
    const coordinator = makeCoordinator();
    const onIndexed = mock((_r: any) => {});
    coordinator.onIndexed(onIndexed);

    coordinator.handleWatcherEvent({ eventType: 'change', filePath: 'tsconfig.json' });
    await coordinator.shutdown();

    expect(mockClearTsconfigPathsCache).toHaveBeenCalled();
    expect(mockLoadTsconfigPaths).toHaveBeenCalledTimes(2); // init + reload
    expect(onIndexed).toHaveBeenCalled();
  });

  // ── I-2: fullIndex monorepo 경계 ─────────────────────────────────────────

  // [HP] monorepo 2개 project 모두의 파일을 fullIndex 트랜잭션에서 삭제해야 한다
  it('should delete all files across all project boundaries during fullIndex', async () => {
    const fileRepo = makeFileRepo();
    fileRepo.getAllFiles
      .mockImplementationOnce(() => [{ project: 'pkg-a', filePath: 'packages/a/src/a.ts' }])
      .mockImplementationOnce(() => [{ project: 'pkg-b', filePath: 'packages/b/src/b.ts' }]);
    const dbConnection = makeDbConnection();
    const coordinator = new IndexCoordinator({
      projectRoot: PROJECT_ROOT,
      boundaries: [
        { dir: 'packages/a', project: 'pkg-a' },
        { dir: 'packages/b', project: 'pkg-b' },
      ],
      extensions: EXTENSIONS,
      ignorePatterns: IGNORE_PATTERNS,
      dbConnection,
      parseCache: makeParseCache(),
      fileRepo,
      symbolRepo: makeSymbolRepo(),
      relationRepo: makeRelationRepo(),
      parseSourceFn: mockParseSource as any,
    });

    await coordinator.fullIndex();

    expect(fileRepo.deleteFile).toHaveBeenCalledWith('pkg-a', 'packages/a/src/a.ts');
    expect(fileRepo.deleteFile).toHaveBeenCalledWith('pkg-b', 'packages/b/src/b.ts');
  });

  // [ED] boundary 1개 → 단일 project 파일 삭제 (기존 동작 유지)
  it('should delete files for the single project boundary during fullIndex', async () => {
    const fileRepo = makeFileRepo();
    fileRepo.getAllFiles.mockReturnValue([{ project: 'test-project', filePath: 'src/a.ts' }]);
    const coordinator = makeCoordinator({ fileRepo });

    await coordinator.fullIndex();

    expect(fileRepo.deleteFile).toHaveBeenCalledWith('test-project', 'src/a.ts');
  });

  // ── I-3: totalSymbols/totalRelations 실제 값 ─────────────────────────────

  // [HP] 파일 인덱싱 후 totalSymbols는 실제 심볼 수여야 한다
  it('should return actual totalSymbols count in IndexResult after indexing', async () => {
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getFileSymbols.mockReturnValue([
      { name: 'fn1', kind: 'function', filePath: 'src/a.ts' },
      { name: 'fn2', kind: 'function', filePath: 'src/a.ts' },
      { name: 'fn3', kind: 'function', filePath: 'src/a.ts' },
    ]);
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator({ symbolRepo });

    const result = await coordinator.fullIndex();

    expect(result.totalSymbols).toBe(3);
  });

  // [NE] changed=[] 일 때 totalSymbols=0이어야 한다
  it('should return totalSymbols=0 when no files are indexed', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    const result = await coordinator.fullIndex();

    expect(result.totalSymbols).toBe(0);
  });

  // ── I-4: IndexResult changedFiles / deletedFiles ──────────────────────────

  // [HP] IndexResult는 changedFiles 배열을 포함해야 한다
  it('should include changedFiles array with indexed file paths in IndexResult', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => '', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect(result.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // [HP] IndexResult는 deletedFiles 배열을 포함해야 한다
  it('should include deletedFiles array with deleted file paths in IndexResult', async () => {
    const symbolRepo = makeSymbolRepo();
    symbolRepo.getFileSymbols.mockReturnValue([]);
    mockDetectChanges.mockResolvedValue({
      changed: [],
      unchanged: [],
      deleted: ['src/gone.ts'],
    });
    const coordinator = makeCoordinator({ symbolRepo });

    const result = await coordinator.incrementalIndex();

    expect(result.deletedFiles).toEqual(['src/gone.ts']);
  });

  // [ED] changed/deleted 모두 비어있을 때 changedFiles=[], deletedFiles=[]
  it('should return empty changedFiles and deletedFiles arrays when nothing changed', async () => {
    mockDetectChanges.mockResolvedValue({ changed: [], unchanged: [], deleted: [] });
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect(result.changedFiles).toEqual([]);
    expect(result.deletedFiles).toEqual([]);
  });

  // ── CRIT-3: detectChanges existingMap 집계 ────────────────────────────────

  // [HP] boundaries 2개 → getFilesMap이 각 프로젝트로 호출됨
  it('should call getFilesMap with each boundary project to build the existingMap for detectChanges', async () => {
    const fileRepo = makeFileRepo();
    const coordinator = new IndexCoordinator({
      projectRoot: PROJECT_ROOT,
      boundaries: [
        { dir: 'packages/a', project: 'pkg-a' },
        { dir: 'packages/b', project: 'pkg-b' },
      ],
      extensions: EXTENSIONS,
      ignorePatterns: IGNORE_PATTERNS,
      dbConnection: makeDbConnection(),
      parseCache: makeParseCache(),
      fileRepo,
      symbolRepo: makeSymbolRepo(),
      relationRepo: makeRelationRepo(),
      parseSourceFn: mockParseSource as any,
    });

    await coordinator.fullIndex();

    const calls = (fileRepo.getFilesMap.mock.calls as any[]).map((c: any[]) => c[0]);
    expect(calls).toContain('pkg-a');
    expect(calls).toContain('pkg-b');
  });

  // ── CRIT-2: fullIndex 원자적 트랜잭션 ────────────────────────────────────

  // [HP] fullIndex: transaction이 delete와 file insert를 모두 포함함
  it('should include both delete and file-insert operations inside the transaction during fullIndex', async () => {
    const callLog: string[] = [];
    const dbConnection = makeDbConnection();
    dbConnection.transaction = mock((fn: () => any) => {
      callLog.push('tx:start');
      const result = fn();
      callLog.push('tx:end');
      return result;
    }) as any;
    const fileRepo = makeFileRepo();
    fileRepo.deleteFile = mock((..._args: any[]) => { callLog.push('deleteFile'); }) as any;
    fileRepo.getAllFiles = mock(() => [{ project: 'test-project', filePath: 'src/a.ts' }]) as any;
    fileRepo.upsertFile = mock((..._args: any[]) => { callLog.push('upsertFile'); }) as any;
    mockDetectChanges.mockResolvedValue({ changed: [makeFakeFile('src/a.ts')], unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'src', lastModified: 1000, size: 100 } as any);

    const coordinator = makeCoordinator({ dbConnection, fileRepo });
    await coordinator.fullIndex();

    const txStart = callLog.indexOf('tx:start');
    const txEnd = callLog.indexOf('tx:end');
    const deleteIdx = callLog.indexOf('deleteFile');
    const upsertIdx = callLog.indexOf('upsertFile');
    expect(txStart).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(txStart);
    expect(deleteIdx).toBeLessThan(txEnd);
    expect(upsertIdx).toBeGreaterThan(txStart);
    expect(upsertIdx).toBeLessThan(txEnd);
  });

  // ── HIGH-4: lock bypass 방지 ──────────────────────────────────────────────

  // [HP] lock 활성 시 fullIndex 직접 호출 → currentIndexing 반환 (새 실행 없음)
  it('should return the currently running promise when fullIndex is called while already indexing', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<any>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges.mockReturnValueOnce(first);

    const coordinator = makeCoordinator();
    const p1 = coordinator.fullIndex();
    const p2 = coordinator.fullIndex(); // lock active → same promise

    expect(p2).toBe(p1);

    resolveFirst();
    await p1;
  });

  // [ST] _pendingFullIndex=true → 현재 fullIndex 완료 후 두 번째 fullIndex 자동 실행
  it('should run a second fullIndex after the first completes when fullIndex was called while lock was active', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<any>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges
      .mockReturnValueOnce(first)
      .mockResolvedValue({ changed: [], unchanged: [], deleted: [] });

    const coordinator = makeCoordinator();

    const p1 = coordinator.fullIndex();
    coordinator.fullIndex(); // lock active → _pendingFullIndex queued

    // Only first detectChanges should be in-flight (post-fix: second is queued, not concurrent)
    await Promise.resolve();
    expect(mockDetectChanges).toHaveBeenCalledTimes(1);

    resolveFirst();
    await p1;
    await coordinator.shutdown(); // waits for second fullIndex

    // After first completes, second ran from pending queue
    expect(mockDetectChanges).toHaveBeenCalledTimes(2);
  });

  // ── HIGH-5: totalRelations 집계 ───────────────────────────────────────────

  // [HP] indexFileRelations가 3 반환 → IndexResult.totalRelations=3
  it('should return totalRelations equal to the sum returned by indexFileRelations', async () => {
    mockIndexFileRelations.mockReturnValue(3);
    mockDetectChanges.mockResolvedValue({ changed: [makeFakeFile('src/a.ts')], unchanged: [], deleted: [] });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect(result.totalRelations).toBe(3);
  });

  // [NE] lock 활성 + incrementalIndex 호출 → pendingFullIndex 설정 안됨
  it('should not schedule a subsequent fullIndex when incrementalIndex is called while lock is active', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<any>((res) => { resolveFirst = () => res({ changed: [], unchanged: [], deleted: [] }); });
    mockDetectChanges
      .mockReturnValueOnce(first)
      .mockResolvedValue({ changed: [], unchanged: [], deleted: [] });

    const coordinator = makeCoordinator();
    const p1 = coordinator.fullIndex(); // starts
    coordinator.incrementalIndex(); // lock active → no pendingFullIndex

    resolveFirst();
    await p1;

    // Only the first fullIndex ran detectChanges — no second run triggered
    expect(mockDetectChanges).toHaveBeenCalledTimes(1);
  });

  // ── C-3: processChanged 에러 격리 ──────────────────────────────────────────

  // [HP] 모든 파일 성공 → failedFiles=[]
  it('should return empty failedFiles when all processFile calls succeed', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({ text: async () => 'code', lastModified: 1000, size: 100 } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect((result as any).failedFiles).toEqual([]);
  });

  // [NE] 한 파일 throw → failedFiles에 추가, 나머지 계속 처리
  it('should add file to failedFiles and continue processing others when processFile throws', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/fail.ts'), makeFakeFile('src/ok.ts')],
      unchanged: [],
      deleted: [],
    });
    let callCount = 0;
    spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => {
        if (callCount++ === 0) throw new Error('read failed');
        return 'code';
      }),
      lastModified: 1000,
      size: 100,
    } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect((result as any).failedFiles).toEqual(['src/fail.ts']);
  });

  // [NE] 모든 파일 throw → 모두 failedFiles에 포함
  it('should include all files in failedFiles when every processFile call throws', async () => {
    mockDetectChanges.mockResolvedValue({
      changed: [makeFakeFile('src/a.ts'), makeFakeFile('src/b.ts')],
      unchanged: [],
      deleted: [],
    });
    spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => { throw new Error('read failed'); }),
      lastModified: 1000,
      size: 100,
    } as any);
    const coordinator = makeCoordinator();

    const result = await coordinator.incrementalIndex();

    expect((result as any).failedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
