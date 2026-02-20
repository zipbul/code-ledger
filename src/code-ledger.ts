import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ParsedFile } from './parser/types';
import { parseSource as defaultParseSource } from './parser/parse-source';
import { ParseCache } from './parser/parse-cache';
import type { ExtractedSymbol } from './extractor/types';
import { extractSymbols as defaultExtractSymbols } from './extractor/symbol-extractor';
import { extractRelations as defaultExtractRelations } from './extractor/relation-extractor';
import type { CodeRelation } from './extractor/types';
import { DbConnection } from './store/connection';
import { FileRepository } from './store/repositories/file.repository';
import { SymbolRepository } from './store/repositories/symbol.repository';
import { RelationRepository } from './store/repositories/relation.repository';
import { ProjectWatcher } from './watcher/project-watcher';
import { IndexCoordinator } from './indexer/index-coordinator';
import type { IndexResult } from './indexer/index-coordinator';
import { acquireWatcherRole, releaseWatcherRole, updateHeartbeat } from './watcher/ownership';
import type { WatcherOwnerStore } from './watcher/ownership';
import { discoverProjects } from './common/project-discovery';
import type { ProjectBoundary } from './common/project-discovery';
import { loadTsconfigPaths } from './common/tsconfig-resolver';
import { symbolSearch as defaultSymbolSearch } from './search/symbol-search';
import type { SymbolSearchQuery, SymbolSearchResult } from './search/symbol-search';
import { relationSearch as defaultRelationSearch } from './search/relation-search';
import type { RelationSearchQuery } from './search/relation-search';
import type { SymbolStats } from './store/repositories/symbol.repository';
import { DependencyGraph } from './search/dependency-graph';

// ── Constants ─────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTHCHECK_INTERVAL_MS = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────

export interface CodeLedgerOptions {
  projectRoot: string;
  extensions?: string[];
  ignorePatterns?: string[];
  parseCacheCapacity?: number;
}

/** @internal */
export interface CodeLedgerInternalOptions {
  _existsSyncFn?: (p: string) => boolean;
  _dbConnectionFactory?: () => Pick<DbConnection, 'open' | 'close' | 'transaction'>;
  _watcherFactory?: () => Pick<ProjectWatcher, 'start' | 'close'>;
  _coordinatorFactory?: () => Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & { tsconfigPaths?: unknown };
  _repositoryFactory?: () => {
    fileRepo: Pick<FileRepository, 'upsertFile' | 'getAllFiles' | 'getFilesMap' | 'deleteFile'>;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
  };
  _acquireWatcherRoleFn?: typeof acquireWatcherRole;
  _releaseWatcherRoleFn?: typeof releaseWatcherRole;
  _updateHeartbeatFn?: typeof updateHeartbeat;
  _discoverProjectsFn?: typeof discoverProjects;
  _parseSourceFn?: typeof defaultParseSource;
  _extractSymbolsFn?: typeof defaultExtractSymbols;
  _extractRelationsFn?: typeof defaultExtractRelations;
  _symbolSearchFn?: typeof defaultSymbolSearch;
  _relationSearchFn?: typeof defaultRelationSearch;
  _loadTsconfigPathsFn?: typeof loadTsconfigPaths;
}

// ── CodeLedger ────────────────────────────────────────────────────────────

export class CodeLedger {
  readonly projectRoot: string;

  private readonly db: Pick<DbConnection, 'open' | 'close' | 'transaction'>;
  private readonly symbolRepo: SymbolRepository;
  private readonly relationRepo: RelationRepository;
  private readonly parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
  private coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & { tsconfigPaths?: unknown }) | null;
  private watcher: Pick<ProjectWatcher, 'start' | 'close'> | null;
  private readonly _releaseWatcherRoleFn: typeof releaseWatcherRole;
  private readonly _parseSourceFn: typeof defaultParseSource;
  private readonly _extractSymbolsFn: typeof defaultExtractSymbols;
  private readonly _extractRelationsFn: typeof defaultExtractRelations;
  private readonly _symbolSearchFn: typeof defaultSymbolSearch;
  private readonly _relationSearchFn: typeof defaultRelationSearch;
  private readonly defaultProject: string;
  private readonly _role: 'owner' | 'reader';
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _signalHandlers: Array<[string, () => void]> = [];
  private _closed = false;
  private _tsconfigPaths: unknown = null;
  private _boundaries: ProjectBoundary[] = [];
  private readonly _onIndexedCallbacks = new Set<(result: IndexResult) => void>();

  private constructor(opts: {
    projectRoot: string;
    db: Pick<DbConnection, 'open' | 'close' | 'transaction'>;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
    coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & { tsconfigPaths?: unknown }) | null;
    watcher: Pick<ProjectWatcher, 'start' | 'close'> | null;
    releaseWatcherRoleFn: typeof releaseWatcherRole;
    parseSourceFn: typeof defaultParseSource;
    extractSymbolsFn: typeof defaultExtractSymbols;
    extractRelationsFn: typeof defaultExtractRelations;
    symbolSearchFn: typeof defaultSymbolSearch;
    relationSearchFn: typeof defaultRelationSearch;
    defaultProject: string;
    role: 'owner' | 'reader';
  }) {
    this.projectRoot = opts.projectRoot;
    this.db = opts.db;
    this.symbolRepo = opts.symbolRepo;
    this.relationRepo = opts.relationRepo;
    this.parseCache = opts.parseCache;
    this.coordinator = opts.coordinator;
    this.watcher = opts.watcher;
    this._releaseWatcherRoleFn = opts.releaseWatcherRoleFn;
    this._parseSourceFn = opts.parseSourceFn;
    this._extractSymbolsFn = opts.extractSymbolsFn;
    this._extractRelationsFn = opts.extractRelationsFn;
    this._symbolSearchFn = opts.symbolSearchFn;
    this._relationSearchFn = opts.relationSearchFn;
    this.defaultProject = opts.defaultProject;
    this._role = opts.role;
  }

  // ── Static factory ──────────────────────────────────────────────────────

  static async open(options: CodeLedgerOptions & CodeLedgerInternalOptions): Promise<CodeLedger> {
    const {
      projectRoot,
      extensions = ['.ts', '.mts', '.cts'],
      ignorePatterns = [],
      parseCacheCapacity = 500,
      _existsSyncFn = existsSync,
      _dbConnectionFactory,
      _watcherFactory,
      _coordinatorFactory,
      _repositoryFactory,
      _acquireWatcherRoleFn = acquireWatcherRole,
      _releaseWatcherRoleFn = releaseWatcherRole,
      _updateHeartbeatFn = updateHeartbeat,
      _discoverProjectsFn = discoverProjects,
      _parseSourceFn = defaultParseSource,
      _extractSymbolsFn = defaultExtractSymbols,
      _extractRelationsFn = defaultExtractRelations,
      _symbolSearchFn = defaultSymbolSearch,
      _relationSearchFn = defaultRelationSearch,
      _loadTsconfigPathsFn = loadTsconfigPaths,
    } = options;

    // ── 1. Validate options ─────────────────────────────────────────────
    if (!path.isAbsolute(projectRoot)) {
      throw new Error(`CodeLedger: projectRoot must be an absolute path, got: "${projectRoot}"`);
    }
    if (!_existsSyncFn(projectRoot)) {
      throw new Error(`CodeLedger: projectRoot does not exist: "${projectRoot}"`);
    }

    // ── 2. Open DB ──────────────────────────────────────────────────────
    const db = _dbConnectionFactory
      ? _dbConnectionFactory()
      : new DbConnection({ projectRoot });
    db.open();
    try {

    // ── 3. Discover projects ────────────────────────────────────────────
    const boundaries: ProjectBoundary[] = await _discoverProjectsFn(projectRoot);
    const defaultProject = boundaries[0]?.project ?? projectRoot;

    // ── 4. Create repositories ──────────────────────────────────────────
    const repos = _repositoryFactory
      ? _repositoryFactory()
      : (() => {
          const connection = db as DbConnection;
          return {
            fileRepo: new FileRepository(connection),
            symbolRepo: new SymbolRepository(connection),
            relationRepo: new RelationRepository(connection),
            parseCache: new ParseCache(parseCacheCapacity),
          };
        })();

    // ── 5. Acquire watcher role ─────────────────────────────────────────
    const role = await Promise.resolve(
      _acquireWatcherRoleFn(db as unknown as WatcherOwnerStore, process.pid, {} as any),
    );

    let coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & { tsconfigPaths?: unknown }) | null = null;
    let watcher: Pick<ProjectWatcher, 'start' | 'close'> | null = null;

    const instance = new CodeLedger({
      projectRoot,
      db,
      symbolRepo: repos.symbolRepo as any,
      relationRepo: repos.relationRepo as any,
      parseCache: repos.parseCache,
      coordinator,
      watcher,
      releaseWatcherRoleFn: _releaseWatcherRoleFn,
      parseSourceFn: _parseSourceFn,
      extractSymbolsFn: _extractSymbolsFn,
      extractRelationsFn: _extractRelationsFn,
      symbolSearchFn: _symbolSearchFn,
      relationSearchFn: _relationSearchFn,
      defaultProject,
      role,
    });
    instance._tsconfigPaths = await _loadTsconfigPathsFn(projectRoot);
    instance._boundaries = boundaries;
    // ── 6. Role-specific setup ──────────────────────────────────────────
    if (role === 'owner') {
      // Create watcher
      const w = _watcherFactory
        ? _watcherFactory()
        : new ProjectWatcher({ projectRoot, ignorePatterns, extensions });

      // Create coordinator
      const c = _coordinatorFactory
        ? _coordinatorFactory()
        : new IndexCoordinator({
            projectRoot,
            boundaries,
            extensions,
            ignorePatterns,
            dbConnection: db as any,
            parseCache: repos.parseCache as any,
            fileRepo: repos.fileRepo as any,
            symbolRepo: repos.symbolRepo as any,
            relationRepo: repos.relationRepo as any,
          });

      // Assign after construction
      instance.coordinator = c;
      instance.watcher = w;

      // Start watcher
      await w.start((event) => (c as any).handleWatcherEvent?.(event));

      // Start heartbeat
      const timer = setInterval(() => {
        _updateHeartbeatFn(db as any, process.pid);
      }, HEARTBEAT_INTERVAL_MS);
      instance._timer = timer;

      // Initial full index
      await c.fullIndex();
    } else {
      // Reader: start healthcheck timer
      const timer = setInterval(async () => {
        try {
        const newRole = await Promise.resolve(
          _acquireWatcherRoleFn(db as unknown as WatcherOwnerStore, process.pid, {} as any),
        );
        if (newRole === 'owner') {
          clearInterval(instance._timer!);
          instance._timer = null;

          const w = _watcherFactory
            ? _watcherFactory()
            : new ProjectWatcher({ projectRoot, ignorePatterns, extensions });
          const c = _coordinatorFactory
            ? _coordinatorFactory()
            : new IndexCoordinator({
                projectRoot,
                boundaries,
                extensions,
                ignorePatterns,
                dbConnection: db as any,
                parseCache: repos.parseCache as any,
                fileRepo: repos.fileRepo as any,
                symbolRepo: repos.symbolRepo as any,
                relationRepo: repos.relationRepo as any,
              });
          instance.coordinator = c;
          instance.watcher = w;
          // Forward registered onIndexed callbacks to new coordinator
          for (const cb of instance._onIndexedCallbacks) {
            c.onIndexed(cb);
          }
          await w.start((event) => (c as any).handleWatcherEvent?.(event));
          const hbTimer = setInterval(() => {
            _updateHeartbeatFn(db as any, process.pid);
          }, HEARTBEAT_INTERVAL_MS);
          instance._timer = hbTimer;
          await c.fullIndex();
        }
        } catch (err) {
          console.error('[CodeLedger] healthcheck error', err);
        }
      }, HEALTHCHECK_INTERVAL_MS);
      instance._timer = timer;
    }

    // ── 7. Signal handlers ──────────────────────────────────────────────
    const signals: Array<string> = ['SIGTERM', 'SIGINT', 'beforeExit'];
    for (const sig of signals) {
      const handler = () => { instance.close().catch(err => console.error('[CodeLedger] close error during signal', sig, err)); };
      process.on(sig as any, handler);
      instance._signalHandlers.push([sig, handler]);
    }

    return instance;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Remove signal handlers
    for (const [sig, handler] of this._signalHandlers) {
      process.off(sig as any, handler);
    }
    this._signalHandlers = [];

    // Shutdown coordinator if owner
    if (this.coordinator) {
      await this.coordinator.shutdown();
    }

    // Close watcher if owner
    if (this.watcher) {
      await this.watcher.close();
    }

    // Clear timer (heartbeat or healthcheck)
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }

    // Release watcher role
    this._releaseWatcherRoleFn(this.db as any, process.pid);

    // Close DB
    this.db.close();
  }

  // ── Event subscription ──────────────────────────────────────────────────

  onIndexed(callback: (result: IndexResult) => void): () => void {
    this._onIndexedCallbacks.add(callback);
    if (!this.coordinator) {
      return () => { this._onIndexedCallbacks.delete(callback); };
    }
    const unsubscribe = this.coordinator.onIndexed(callback);
    return () => {
      this._onIndexedCallbacks.delete(callback);
      unsubscribe();
    };
  }

  // ── Stateless API ───────────────────────────────────────────────────────

  parseSource(filePath: string, sourceText: string): ParsedFile {
    const parsed = this._parseSourceFn(filePath, sourceText);
    this.parseCache.set(filePath, parsed);
    return parsed;
  }

  extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
    return this._extractSymbolsFn(parsed);
  }

  extractRelations(parsed: ParsedFile): CodeRelation[] {
    return this._extractRelationsFn(
      parsed.program as any,
      parsed.filePath,
      this._tsconfigPaths as any,
    );
  }

  // ── Search API ──────────────────────────────────────────────────────────

  async reindex(): Promise<IndexResult> {
    if (!this.coordinator) {
      throw new Error('CodeLedger: reindex() is not available for readers');
    }
    return this.coordinator.fullIndex();
  }

  get projects(): ProjectBoundary[] {
    return this._boundaries;
  }

  getStats(project?: string): SymbolStats {
    return (this.symbolRepo as any).getStats(project ?? this.defaultProject);
  }

  searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
    if (this._closed) throw new Error('CodeLedger: instance is closed');
    return this._symbolSearchFn({ symbolRepo: this.symbolRepo as any, project: this.defaultProject, query });
  }

  searchRelations(query: RelationSearchQuery): CodeRelation[] {
    if (this._closed) throw new Error('CodeLedger: instance is closed');
    return this._relationSearchFn({ relationRepo: this.relationRepo as any, project: this.defaultProject, query });
  }

  // ── Dependency graph helpers ────────────────────────────────────────────

  getDependencies(filePath: string, project?: string): string[] {
    return this._relationSearchFn({
      relationRepo: this.relationRepo as any,
      query: { srcFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit: 10_000 },
    }).map(r => r.dstFilePath);
  }

  getDependents(filePath: string, project?: string): string[] {
    return this._relationSearchFn({
      relationRepo: this.relationRepo as any,
      query: { dstFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit: 10_000 },
    }).map(r => r.srcFilePath);
  }

  async getAffected(changedFiles: string[], project?: string): Promise<string[]> {
    const g = new DependencyGraph({
      relationRepo: this.relationRepo as any,
      project: project ?? this.defaultProject,
    });
    await g.build();
    return g.getAffectedByChange(changedFiles);
  }

  async hasCycle(project?: string): Promise<boolean> {
    const g = new DependencyGraph({
      relationRepo: this.relationRepo as any,
      project: project ?? this.defaultProject,
    });
    await g.build();
    return g.hasCycle();
  }
}
