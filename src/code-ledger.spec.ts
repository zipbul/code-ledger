import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { CodeLedger } from './code-ledger';

// ── Mock helpers ────────────────────────────────────────────────────────────

function makeDbMock() {
  return {
    open: mock(() => {}),
    close: mock(() => {}),
    transaction: mock((fn: (tx: any) => any) => fn(null)),
  };
}

function makeWatcherMock() {
  return {
    start: mock(async (_cb: any) => {}),
    close: mock(async () => {}),
  };
}

function makeCoordinatorMock() {
  const inst = {
    fullIndex: mock(async () => ({
      indexedFiles: 0, removedFiles: 0,
      totalSymbols: 0, totalRelations: 0,
      durationMs: 0, changedFiles: [], deletedFiles: [],
    })),
    shutdown: mock(async () => {}),
    onIndexed: mock((_cb: (r: any) => void) => (() => {})),
    tsconfigPaths: null as any,
    _onIndexedCb: null as ((r: any) => void) | null,
  };
  // Override onIndexed to capture the callback so tests can fire it
  inst.onIndexed = mock((cb: (r: any) => void) => {
    inst._onIndexedCb = cb;
    return () => { inst._onIndexedCb = null; };
  });
  return inst;
}

function makeSymbolRepoMock() {
  return {
    replaceFileSymbols: mock(() => {}),
    getFileSymbols: mock(() => []),
    getByFingerprint: mock(() => []),
    deleteFileSymbols: mock(() => {}),
    searchByQuery: mock(() => []),
    getStats: mock((_p: string) => ({ fileCount: 0, symbolCount: 0 })),
  };
}

function makeRelationRepoMock() {
  return {
    replaceFileRelations: mock(() => {}),
    getOutgoing: mock(() => []),
    getIncoming: mock(() => []),
    getByType: mock(() => []),
    deleteFileRelations: mock(() => {}),
    retargetRelations: mock(() => {}),
    searchRelations: mock(() => []),
  };
}

function makeFileRepoMock() {
  return {
    upsertFile: mock(() => {}),
    getAllFiles: mock(() => []),
    getFilesMap: mock(() => new Map()),
    deleteFile: mock(() => {}),
    getFile: mock(() => null),
  };
}

function makeParseCacheMock() {
  return {
    set: mock(() => {}),
    get: mock(() => undefined),
    invalidate: mock(() => {}),
  };
}

// ── Options factory ───────────────────────────────────────────────────────

const PROJECT_ROOT = '/project';

function makeOptions(opts: {
  role?: 'owner' | 'reader';
  db?: ReturnType<typeof makeDbMock>;
  watcher?: ReturnType<typeof makeWatcherMock>;
  coordinator?: ReturnType<typeof makeCoordinatorMock>;
  symbolRepo?: ReturnType<typeof makeSymbolRepoMock>;
  relationRepo?: ReturnType<typeof makeRelationRepoMock>;
  existsSync?: (p: string) => boolean;
  projectRoot?: string;
} = {}) {
  const db = opts.db ?? makeDbMock();
  const watcher = opts.watcher ?? makeWatcherMock();
  const coordinator = opts.coordinator ?? makeCoordinatorMock();
  const symbolRepo = opts.symbolRepo ?? makeSymbolRepoMock();
  const relationRepo = opts.relationRepo ?? makeRelationRepoMock();

  return {
    projectRoot: opts.projectRoot ?? PROJECT_ROOT,
    _existsSyncFn: opts.existsSync ?? ((_p: string) => true),
    _dbConnectionFactory: () => db,
    _watcherFactory: () => watcher,
    _coordinatorFactory: () => coordinator,
    _repositoryFactory: () => ({
      fileRepo: makeFileRepoMock(),
      symbolRepo,
      relationRepo,
      parseCache: makeParseCacheMock(),
    }),
    _acquireWatcherRoleFn: mock(async () => (opts.role ?? 'owner') as const),
    _releaseWatcherRoleFn: mock(() => {}),
    _updateHeartbeatFn: mock(() => {}),
    _discoverProjectsFn: mock(async (_root: string) => [{ dir: '.', project: 'test-project' }]),
    _parseSourceFn: mock((_fp: string, text: string) => ({
      filePath: _fp, program: { body: [] }, errors: [], comments: [], sourceText: text,
    })) as any,
    _extractSymbolsFn: mock(() => []) as any,
    _extractRelationsFn: mock(() => []) as any,
    _loadTsconfigPathsFn: mock((_root: string) => null) as any,
    _symbolSearchFn: mock((_opts: any) => []) as any,
    _relationSearchFn: mock((_opts: any) => []) as any,
    _db: db,
    _watcher: watcher,
    _coordinator: coordinator,
    _symbolRepo: symbolRepo,
    _relationRepo: relationRepo,
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CodeLedger', () => {
  // [HP] open() — owner 역할 → CodeLedger 인스턴스 반환
  it('should return a CodeLedger instance when open() succeeds as owner', async () => {
    const opts = makeOptions({ role: 'owner' });

    const ledger = await CodeLedger.open(opts);

    expect(ledger).toBeInstanceOf(CodeLedger);
    await ledger.close();
  });

  // [HP] open() — reader 역할 → CodeLedger 인스턴스 반환 (watcher 없음)
  it('should return a CodeLedger instance when open() succeeds as reader without starting watcher', async () => {
    const watcher = makeWatcherMock();
    const opts = makeOptions({ role: 'reader', watcher });

    const ledger = await CodeLedger.open(opts);

    expect(ledger).toBeInstanceOf(CodeLedger);
    expect(watcher.start).not.toHaveBeenCalled();
    await ledger.close();
  });

  // [HP] owner 시 fullIndex 호출됨
  it('should call coordinator.fullIndex() during open() when role is owner', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });

    const ledger = await CodeLedger.open(opts);

    expect(coordinator.fullIndex).toHaveBeenCalled();
    await ledger.close();
  });

  // [HP] owner 시 heartbeat 타이머(30s) 시작됨
  it('should start a 30-second heartbeat interval when role is owner', async () => {
    const spySetInterval = spyOn(globalThis, 'setInterval');
    const opts = makeOptions({ role: 'owner' });

    const ledger = await CodeLedger.open(opts);

    const intervals = (spySetInterval.mock.calls as any[]).map((c) => c[1]);
    expect(intervals).toContain(30_000);

    await ledger.close();
    spySetInterval.mockRestore();
  });

  // [HP] reader 시 healthcheck 타이머(60s) 시작됨
  it('should start a 60-second healthcheck interval when role is reader', async () => {
    const spySetInterval = spyOn(globalThis, 'setInterval');
    const opts = makeOptions({ role: 'reader' });

    const ledger = await CodeLedger.open(opts);

    const intervals = (spySetInterval.mock.calls as any[]).map((c) => c[1]);
    expect(intervals).toContain(60_000);

    await ledger.close();
    spySetInterval.mockRestore();
  });

  // [HP] SIGTERM 핸들러가 등록됨
  it('should register a SIGTERM process signal handler during open()', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await CodeLedger.open(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('SIGTERM');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  // [HP] SIGINT 핸들러가 등록됨
  it('should register a SIGINT process signal handler during open()', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await CodeLedger.open(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('SIGINT');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  // [HP] beforeExit 핸들러가 등록됨
  it('should register a beforeExit process signal handler during open()', async () => {
    const spyProcessOn = spyOn(process, 'on');
    const opts = makeOptions();

    const ledger = await CodeLedger.open(opts);

    const signals = (spyProcessOn.mock.calls as any[]).map((c) => c[0]);
    expect(signals).toContain('beforeExit');

    await ledger.close();
    spyProcessOn.mockRestore();
  });

  // [HP] searchSymbols(query) → symbolSearch fn 위임
  it('should delegate searchSymbols(query) to the injected symbolSearch function', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);
    const query = { text: 'myFunc' };

    ledger.searchSymbols(query);

    expect(opts._symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    await ledger.close();
  });

  // [HP] searchRelations(query) → relationSearch fn 위임
  it('should delegate searchRelations(query) to the injected relationSearch function', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);
    const query = { srcFilePath: 'src/a.ts' };

    ledger.searchRelations(query);

    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    await ledger.close();
  });

  // [HP] getDependencies: _relationSearchFn을 srcFilePath+type='imports'로 호출하고 dstFilePath 배열 반환
  it('should call _relationSearchFn with srcFilePath and return dstFilePath array when getDependencies is called', async () => {
    const opts = makeOptions();
    opts._relationSearchFn.mockReturnValue([
      { type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', srcSymbolName: null, dstSymbolName: null },
      { type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/c.ts', srcSymbolName: null, dstSymbolName: null },
    ]);
    const ledger = await CodeLedger.open(opts);

    const result = ledger.getDependencies('src/a.ts');

    expect(result).toEqual(['src/b.ts', 'src/c.ts']);
    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ srcFilePath: 'src/a.ts', type: 'imports' }) }),
    );
    await ledger.close();
  });

  // [HP] getDependencies: project 명시 시 해당 project를 쿼리에 사용해야 한다
  it('should use the given project when getDependencies is called with a project argument', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    ledger.getDependencies('src/a.ts', 'my-project');

    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'my-project' }) }),
    );
    await ledger.close();
  });

  // [ED] getDependencies: project 생략 시 defaultProject를 사용해야 한다
  it('should fall back to defaultProject when getDependencies is called without a project argument', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    ledger.getDependencies('src/a.ts');

    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'test-project' }) }),
    );
    await ledger.close();
  });

  // [HP] getDependents: _relationSearchFn을 dstFilePath+type='imports'로 호출하고 srcFilePath 배열 반환
  it('should call _relationSearchFn with dstFilePath and return srcFilePath array when getDependents is called', async () => {
    const opts = makeOptions();
    opts._relationSearchFn.mockReturnValue([
      { type: 'imports', srcFilePath: 'src/x.ts', dstFilePath: 'src/a.ts', srcSymbolName: null, dstSymbolName: null },
    ]);
    const ledger = await CodeLedger.open(opts);

    const result = ledger.getDependents('src/a.ts');

    expect(result).toEqual(['src/x.ts']);
    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ dstFilePath: 'src/a.ts', type: 'imports' }) }),
    );
    await ledger.close();
  });

  // [ED] getDependents: project 생략 시 defaultProject를 사용해야 한다
  it('should fall back to defaultProject when getDependents is called without a project argument', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    ledger.getDependents('src/a.ts');

    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ project: 'test-project' }) }),
    );
    await ledger.close();
  });

  // [HP] getAffected: DependencyGraph build 후 getAffectedByChange 결과를 반환해야 한다
  it('should build DependencyGraph and return getAffectedByChange result when getAffected is called', async () => {
    const relationRepo = makeRelationRepoMock();
    // a.ts → b.ts (a imports b), so when b changes, a is affected
    relationRepo.getByType.mockReturnValue([
      { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project' },
    ]);
    const opts = makeOptions({ relationRepo });
    const ledger = await CodeLedger.open(opts);

    const result = await ledger.getAffected(['src/b.ts']);

    expect(result).toContain('src/a.ts');
    await ledger.close();
  });

  // [ED] getAffected: project 생략 시 defaultProject를 DependencyGraph에 전달해야 한다
  it('should pass defaultProject to DependencyGraph when getAffected is called without a project argument', async () => {
    const relationRepo = makeRelationRepoMock();
    const opts = makeOptions({ relationRepo });
    const ledger = await CodeLedger.open(opts);

    await ledger.getAffected([]);

    expect(relationRepo.getByType).toHaveBeenCalledWith('test-project', 'imports');
    await ledger.close();
  });

  // [HP] hasCycle: 순환이 있을 때 true를 반환해야 한다
  it('should return true when hasCycle detects a circular dependency in the graph', async () => {
    const relationRepo = makeRelationRepoMock();
    // a → b → a
    relationRepo.getByType.mockReturnValue([
      { srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', type: 'imports', project: 'test-project' },
      { srcFilePath: 'src/b.ts', dstFilePath: 'src/a.ts', type: 'imports', project: 'test-project' },
    ]);
    const opts = makeOptions({ relationRepo });
    const ledger = await CodeLedger.open(opts);

    const result = await ledger.hasCycle();

    expect(result).toBe(true);
    await ledger.close();
  });

  // [HP] hasCycle: 순환이 없을 때 false를 반환해야 한다
  it('should return false when hasCycle finds no circular dependency in the graph', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    const result = await ledger.hasCycle();

    expect(result).toBe(false);
    await ledger.close();
  });

  // [HP] parseSource(abs, text) → ParsedFile 반환 + parseCache 저장
  it('should return a ParsedFile and store it in parseCache when parseSource is called', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    const result = ledger.parseSource('/project/src/a.ts', 'const x = 1;');

    expect(result).toMatchObject({ filePath: '/project/src/a.ts' });
    expect(opts._parseSourceFn).toHaveBeenCalledWith('/project/src/a.ts', 'const x = 1;');
    await ledger.close();
  });

  // [HP] extractSymbols(parsed) → ExtractedSymbol[] 반환
  it('should call the injected extractSymbols function and return its result', async () => {
    const fakeSymbols = [{ kind: 'function', name: 'foo' }];
    const opts = makeOptions();
    (opts._extractSymbolsFn as any).mockReturnValue(fakeSymbols);
    const ledger = await CodeLedger.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    const result = ledger.extractSymbols(parsed as any);

    expect(result).toBe(fakeSymbols);
    await ledger.close();
  });

  // [HP] extractRelations(parsed) → CodeRelation[] 반환
  it('should call the injected extractRelations function and return its result', async () => {
    const fakeRelations = [{ type: 'imports', srcFilePath: 'src/a.ts', dstFilePath: 'src/b.ts', srcSymbolName: null, dstSymbolName: null }];
    const opts = makeOptions();
    (opts._extractRelationsFn as any).mockReturnValue(fakeRelations);
    const ledger = await CodeLedger.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    const result = ledger.extractRelations(parsed as any);

    expect(result).toBe(fakeRelations);
    await ledger.close();
  });

  // [HP] onIndexed(cb) → coordinator.onIndexed 위임 확인
  it('should pass the onIndexed callback through to coordinator.onIndexed', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await CodeLedger.open(opts);
    const cb = mock((_r: any) => {});

    ledger.onIndexed(cb);

    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb);
    await ledger.close();
  });

  // [HP] onIndexed 반환값(unsubscribe)으로 cb 해제 가능
  it('should return an unsubscribe function from onIndexed that removes the callback', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await CodeLedger.open(opts);
    const cb = mock((_r: any) => {});

    const unsubscribe = ledger.onIndexed(cb);
    unsubscribe();

    // Unsubscribing should have set _onIndexedCb to null
    expect(coordinator._onIndexedCb).toBeNull();
    await ledger.close();
  });

  // [HP] close() (owner) — coordinator.shutdown, watcher.close, releaseWatcherRole, db.close 호출
  it('should call shutdown and close resources when close() is called as owner', async () => {
    const coordinator = makeCoordinatorMock();
    const watcher = makeWatcherMock();
    const db = makeDbMock();
    const opts = makeOptions({ role: 'owner', coordinator, watcher, db });

    const ledger = await CodeLedger.open(opts);
    await ledger.close();

    expect(coordinator.shutdown).toHaveBeenCalled();
    expect(watcher.close).toHaveBeenCalled();
    expect(opts._releaseWatcherRoleFn).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
  });

  // [HP] close() (reader) — 타이머 정리 + DB close
  it('should clear timers and close db when close() is called as reader', async () => {
    const db = makeDbMock();
    const opts = makeOptions({ role: 'reader', db });
    const spyClearInterval = spyOn(globalThis, 'clearInterval');

    const ledger = await CodeLedger.open(opts);
    await ledger.close();

    expect(spyClearInterval).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
    spyClearInterval.mockRestore();
  });

  // [NE] 상대 경로 projectRoot → throw
  it('should throw when projectRoot is a relative path', async () => {
    const opts: any = { projectRoot: 'relative/path' };

    await expect(CodeLedger.open(opts)).rejects.toThrow();
  });

  // [NE] 존재하지 않는 projectRoot → throw
  it('should throw when projectRoot does not exist on disk', async () => {
    const opts = makeOptions({ existsSync: () => false });

    await expect(CodeLedger.open(opts)).rejects.toThrow();
  });

  // [NE] close() 2회 → 두 번째는 안전 (noop)
  it('should not throw when close() is called a second time', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);
    await ledger.close();

    await expect(ledger.close()).resolves.toBeUndefined();
  });

  // [NE] DB open 실패 → 에러 전파
  it('should propagate error when the DB factory or open() throws', async () => {
    const db = makeDbMock();
    db.open.mockImplementation(() => { throw new Error('DB open failed'); });
    const opts = makeOptions({ db });

    await expect(CodeLedger.open(opts)).rejects.toThrow('DB open failed');
  });

  // [CO] onIndexed 등록 후 coordinator가 콜백 발화 시 cb 호출됨
  it('should invoke registered onIndexed callback when coordinator fires it', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ coordinator });
    const ledger = await CodeLedger.open(opts);
    const cb = mock((_r: any) => {});
    ledger.onIndexed(cb);

    coordinator._onIndexedCb?.({
      indexedFiles: 2, changedFiles: ['a.ts'], deletedFiles: [],
      totalSymbols: 5, totalRelations: 3, durationMs: 10,
    });

    expect(cb).toHaveBeenCalledTimes(1);
    await ledger.close();
  });

  // [ST] open → searchSymbols → close 라이프사이클
  it('should support open → searchSymbols → close lifecycle without errors', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    const results = ledger.searchSymbols({ text: 'handler' });

    expect(Array.isArray(results)).toBe(true);
    await expect(ledger.close()).resolves.toBeUndefined();
  });

  // [OR] close() 순서: coordinator.shutdown → watcher.close → releaseRole → db.close
  it('should execute close() steps in the correct order: shutdown → watcher.close → releaseRole → db.close', async () => {
    const order: string[] = [];
    const coordinator = makeCoordinatorMock();
    coordinator.shutdown = mock(async () => { order.push('shutdown'); });
    const watcher = makeWatcherMock();
    watcher.close = mock(async () => { order.push('watcher.close'); });
    const db = makeDbMock();
    db.close = mock(() => { order.push('db.close'); });
    const releaseWatcherRoleFn = mock(() => { order.push('releaseRole'); });
    const opts = makeOptions({ role: 'owner', coordinator, watcher, db });
    opts._releaseWatcherRoleFn = releaseWatcherRoleFn;

    const ledger = await CodeLedger.open(opts);
    await ledger.close();

    expect(order.indexOf('shutdown')).toBeLessThan(order.indexOf('watcher.close'));
    expect(order.indexOf('watcher.close')).toBeLessThan(order.indexOf('releaseRole'));
    expect(order.indexOf('releaseRole')).toBeLessThan(order.indexOf('db.close'));
  });

  // ── M-3: reindex() ────────────────────────────────────────────────────────

  // [NE] reader에서 reindex() 호출 → 에러 발생
  it('should throw an error when reindex() is called on a reader instance', async () => {
    const opts = makeOptions({ role: 'reader' });
    const ledger = await CodeLedger.open(opts);

    await expect((ledger as any).reindex()).rejects.toThrow();
    await ledger.close();
  });

  // [HP] owner에서 reindex() 호출 → coordinator.fullIndex() 위임
  it('should delegate reindex() to coordinator.fullIndex() when role is owner', async () => {
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'owner', coordinator });
    const ledger = await CodeLedger.open(opts);
    coordinator.fullIndex.mockClear();

    await (ledger as any).reindex();

    expect(coordinator.fullIndex).toHaveBeenCalledTimes(1);
    await ledger.close();
  });

  // ── H-4: tsconfigPaths extractRelations 전달 ──────────────────────────────

  // [HP] _loadTsconfigPathsFn 결과가 extractRelations에 전달된다
  it('should pass tsconfigPaths from _loadTsconfigPathsFn to extractRelations fn', async () => {
    const tsconfigPaths = { '@/': ['src/'] };
    const opts = makeOptions({ role: 'reader' });
    (opts as any)._loadTsconfigPathsFn = mock(() => tsconfigPaths);
    const ledger = await CodeLedger.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    ledger.extractRelations(parsed as any);

    expect(opts._extractRelationsFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      tsconfigPaths,
    );
    await ledger.close();
  });

  // ── H-6: reader→owner 전환 시 onIndexed 콜백 포워딩 ───────────────────────

  // [HP] reader 상태에서 등록된 onIndexed 콜백이 owner 전환 후 coordinator로 전달된다
  it('should forward onIndexed callbacks to coordinator when promoted from reader to owner', async () => {
    const acquireMock = mock(async () => 'reader' as const);
    (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
    const coordinator = makeCoordinatorMock();
    const opts = makeOptions({ role: 'reader', coordinator });
    opts._acquireWatcherRoleFn = acquireMock as any;

    const ledger = await CodeLedger.open(opts);
    const cb = mock((_r: any) => {});
    ledger.onIndexed(cb);

    jest.advanceTimersByTime(60_000);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(coordinator.onIndexed).toHaveBeenCalledWith(cb);
    await ledger.close();
  });

  // ── M-7: projects getter ──────────────────────────────────────────────────

  // [HP] projects getter는 배열을 반환한다
  it('should return an array from the projects getter', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    const projects = (ledger as any).projects;

    expect(Array.isArray(projects)).toBe(true);
    await ledger.close();
  });

  // ── M-8: getStats() ───────────────────────────────────────────────────────

  // [HP] getStats() → symbolRepo.getStats 위임
  it('should delegate getStats() to symbolRepo.getStats', async () => {
    const symbolRepo = makeSymbolRepoMock();
    const opts = makeOptions({ symbolRepo });
    const ledger = await CodeLedger.open(opts);

    (ledger as any).getStats();

    expect(symbolRepo.getStats).toHaveBeenCalled();
    await ledger.close();
  });

  // ── A-1: _loadTsconfigPathsFn await ───────────────────────────────────────

  // [NE/A-1] _loadTsconfigPathsFn이 Promise를 반환하면 await된 값이 extractRelations에 전달되어야 한다
  it('should await _loadTsconfigPathsFn and pass resolved value to extractRelations', async () => {
    const tsconfigPaths = { '@/': ['src/'] };
    const opts = makeOptions({ role: 'reader' });
    (opts as any)._loadTsconfigPathsFn = mock(() => Promise.resolve(tsconfigPaths));
    const ledger = await CodeLedger.open(opts);
    const parsed = { filePath: '/project/src/a.ts', program: { body: [] }, errors: [], comments: [], sourceText: 'x' };

    ledger.extractRelations(parsed as any);

    expect(opts._extractRelationsFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      tsconfigPaths,
    );
    await ledger.close();
  });

  // ── A-2: DB 누수 방지 ─────────────────────────────────────────────────────

  // [NE/A-2] _discoverProjectsFn이 throw하면 db.close()가 호출되어야 한다
  it('should call db.close() when _discoverProjectsFn throws during open()', async () => {
    const db = makeDbMock();
    const opts = makeOptions({ db });
    opts._discoverProjectsFn = mock(async () => { throw new Error('discover failed'); }) as any;

    await expect(CodeLedger.open(opts)).rejects.toThrow('discover failed');
    expect(db.close).toHaveBeenCalled();
  });

  // [NE/A-2] owner에서 watcher.start()가 throw하면 db.close()가 호출되어야 한다
  it('should call db.close() when watcher.start() throws during open() as owner', async () => {
    const db = makeDbMock();
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('watcher start failed'));
    const opts = makeOptions({ role: 'owner', db, watcher });

    await expect(CodeLedger.open(opts)).rejects.toThrow('watcher start failed');
    expect(db.close).toHaveBeenCalled();
  });

  // ── A-3: reader→owner 전환 안전성 ─────────────────────────────────────────

  // [ST/A-3] reader→owner 전환 중 watcher.start()가 throw해도 unhandled rejection을 일으키지 않아야 한다
  it('should not produce unhandled rejection when watcher.start() throws during reader-to-owner promotion', async () => {
    const acquireMock = mock(async () => 'reader' as const);
    (acquireMock as any).mockResolvedValueOnce('reader').mockResolvedValue('owner' as const);
    const watcher = makeWatcherMock();
    watcher.start.mockRejectedValue(new Error('transition start failed'));
    const opts = makeOptions({ role: 'reader', watcher });
    opts._acquireWatcherRoleFn = acquireMock as any;

    const ledger = await CodeLedger.open(opts);

    jest.advanceTimersByTime(60_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // If we reach here without unhandled rejection the assert passes
    await expect(ledger.close()).resolves.toBeUndefined();
  });

  // ── B-1: _closed 가드 ─────────────────────────────────────────────────────

  // [NE/B-1] close() 후 searchSymbols() 호출 → 에러 throw
  it('should throw when searchSymbols() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);
    await ledger.close();

    expect(() => ledger.searchSymbols({ text: 'foo' })).toThrow();
  });

  // [NE/B-1] close() 후 searchRelations() 호출 → 에러 throw
  it('should throw when searchRelations() is called after close()', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);
    await ledger.close();

    expect(() => ledger.searchRelations({ srcFilePath: 'a.ts' })).toThrow();
  });

  // ── B-3: defaultProject 전달 ─────────────────────────────────────────────

  // [HP/B-3] searchSymbols({}) project 없으면 defaultProject가 _symbolSearchFn에 전달되어야 한다
  it('should pass defaultProject to _symbolSearchFn when searchSymbols is called without a project in the query', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    ledger.searchSymbols({ text: 'foo' });

    expect(opts._symbolSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project' }),
    );
    await ledger.close();
  });

  // [HP/B-3] searchRelations({}) project 없으면 defaultProject가 _relationSearchFn에 전달되어야 한다
  it('should pass defaultProject to _relationSearchFn when searchRelations is called without a project in the query', async () => {
    const opts = makeOptions();
    const ledger = await CodeLedger.open(opts);

    ledger.searchRelations({ srcFilePath: 'a.ts' });

    expect(opts._relationSearchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project' }),
    );
    await ledger.close();
  });
});
