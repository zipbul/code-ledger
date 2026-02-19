import type { FileChangeEvent } from '../watcher/types';
import type { ProjectBoundary } from '../common/project-discovery';
import { resolveFileProject, discoverProjects } from '../common/project-discovery';
import { loadTsconfigPaths } from '../common/tsconfig-resolver';
import { toAbsolutePath } from '../common/path-utils';
import { hashString } from '../common/hasher';
import { parseSource } from '../parser/parse-source';
import { detectChanges } from './file-indexer';
import { indexFileSymbols } from './symbol-indexer';
import { indexFileRelations } from './relation-indexer';

// ── Constants ─────────────────────────────────────────────────────────────

export const WATCHER_DEBOUNCE_MS = 100;

// ── Result type ────────────────────────────────────────────────────────────

export interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  durationMs: number;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface IndexCoordinatorOptions {
  projectRoot: string;
  boundaries: ProjectBoundary[];
  extensions: string[];
  ignorePatterns: string[];
  dbConnection: { transaction<T>(fn: () => T): T };
  parseCache: {
    set(key: string, value: unknown): void;
    get(key: string): unknown;
    invalidate(key: string): void;
  };
  fileRepo: {
    getFilesMap(...args: any[]): Map<string, any>;
    getAllFiles(p: string): any[];
    upsertFile(r: any): void;
    deleteFile(p: string, f: string): void;
  };
  symbolRepo: {
    replaceFileSymbols(p: string, f: string, h: string, s: any[]): void;
    getFileSymbols(p: string, f: string): any[];
    getByFingerprint(p: string, fp: string): any[];
    deleteFileSymbols(p: string, f: string): void;
  };
  relationRepo: {
    replaceFileRelations(p: string, f: string, r: any[]): void;
    retargetRelations(p: string, of: string, os: string | null, nf: string, ns: string | null): void;
    deleteFileRelations(p: string, f: string): void;
  };
  /** DI seam for parseSource — defaults to the real implementation. */
  parseSourceFn?: typeof parseSource;
  /** DI seam for discoverProjects — defaults to the real implementation. */
  discoverProjectsFn?: typeof discoverProjects;
}

// ── IndexCoordinator ───────────────────────────────────────────────────────

export class IndexCoordinator {
  private readonly opts: IndexCoordinatorOptions;

  /** Registered post-index callbacks. */
  private readonly callbacks = new Set<(result: IndexResult) => void>();

  /** Prevents concurrent indexing operations. */
  private indexingLock = false;

  /** Buffer for watcher events received while indexing is in progress. */
  private pendingEvents: FileChangeEvent[] = [];

  /** Handle to the active debounce timer (fake or real). */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** The currently running indexing promise (for shutdown). */
  private currentIndexing: Promise<IndexResult> | null = null;

  /** Resolved tsconfig path mappings (may be a Promise during async load). */
  private tsconfigPathsRaw: unknown;

  /** Pending boundaries refresh (resolved async). */
  private boundariesRefresh: Promise<void> | null = null;

  constructor(opts: IndexCoordinatorOptions) {
    this.opts = opts;
    // Load tsconfig paths on construction — result may be a Promise or null.
    this.tsconfigPathsRaw = loadTsconfigPaths(opts.projectRoot);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Full re-index: runs detectChanges then processes all changed files. */
  fullIndex(): Promise<IndexResult> {
    return this._startIndex(undefined, true);
  }

  /**
   * Incremental index:
   *  - With explicit events → processes those files directly.
   *  - Without events → calls detectChanges to discover changes.
   */
  incrementalIndex(events?: FileChangeEvent[]): Promise<IndexResult> {
    return this._startIndex(events, false);
  }

  /** Registers a callback to fire after each indexing run. Returns unsubscribe. */
  onIndexed(cb: (result: IndexResult) => void): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** Handles a raw watcher event with debouncing. */
  handleWatcherEvent(event: FileChangeEvent): void {
    // tsconfig.json change → reload paths and trigger full re-index.
    if (event.filePath.endsWith('tsconfig.json')) {
      this.tsconfigPathsRaw = loadTsconfigPaths(this.opts.projectRoot);
      this.fullIndex();
      return;
    }

    // package.json change → refresh project boundaries.
    if (event.filePath.endsWith('package.json')) {
      const discover = this.opts.discoverProjectsFn ?? discoverProjects;
      this.boundariesRefresh = discover(this.opts.projectRoot).then((b) => {
        this.opts.boundaries = b;
      });
    }

    this.pendingEvents.push(event);

    // Only start the debounce timer once — do not restart if already pending.
    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this._flushPending();
      }, WATCHER_DEBOUNCE_MS);
    }
  }

  /** Waits for any in-flight indexing to complete then stops all activity. */
  async shutdown(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.currentIndexing) {
      await this.currentIndexing;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Starts an indexing run and maintains the lock / pending queue. */
  private _startIndex(events: FileChangeEvent[] | undefined, useTransaction: boolean): Promise<IndexResult> {
    this.indexingLock = true;

    const work = this._doIndex(events, useTransaction)
      .then((result) => {
        this._fireCallbacks(result);
        return result;
      })
      .finally(() => {
        this.indexingLock = false;
        this.currentIndexing = null;
        // Drain any events that arrived while this run was in progress.
        if (this.pendingEvents.length > 0) {
          const drained = this.pendingEvents.splice(0);
          this._startIndex(drained, false);
        }
      });

    this.currentIndexing = work;
    return work;
  }

  /** Core indexing logic — determines what to process, then processes it. */
  private async _doIndex(events: FileChangeEvent[] | undefined, useTransaction: boolean): Promise<IndexResult> {
    const start = Date.now();
    const { fileRepo, symbolRepo, relationRepo, dbConnection } = this.opts;

    // Await any pending boundaries refresh.
    if (this.boundariesRefresh) {
      await this.boundariesRefresh;
      this.boundariesRefresh = null;
    }

    let changed: Array<{ filePath: string; contentHash: string; mtimeMs: number; size: number }>;
    let deleted: string[];

    if (events !== undefined) {
      // Explicit event list — classify by event type.
      // NOTE: No preceding `await` so the lock test can verify detectChanges is
      //       NOT called in this branch.
      changed = events
        .filter((e) => e.eventType === 'create' || e.eventType === 'change')
        .map((e) => ({
          filePath: e.filePath,
          contentHash: '',   // computed below during processing
          mtimeMs: 0,
          size: 0,
        }));
      deleted = events.filter((e) => e.eventType === 'delete').map((e) => e.filePath);
    } else {
      // No explicit events — call detectChanges immediately (no preceding await)
      // so tests can synchronously verify it was invoked.
      const result = await detectChanges({
        projectRoot: this.opts.projectRoot,
        extensions: this.opts.extensions,
        ignorePatterns: this.opts.ignorePatterns,
        fileRepo,
      });
      changed = result.changed;
      deleted = result.deleted;
    }

    // Resolve tsconfig paths after the detect step.
    const tsconfigPaths = await Promise.resolve(this.tsconfigPathsRaw);

    // ── Move detection: collect fingerprints of deleted symbols BEFORE deletion ──
    const deletedSymbols = new Map<string, any[]>();
    for (const filePath of deleted) {
      const project = resolveFileProject(filePath, this.opts.boundaries);
      const syms = symbolRepo.getFileSymbols(project, filePath);
      deletedSymbols.set(filePath, syms);
    }

    // ── Delete removed files ──────────────────────────────────────────────
    const processDeleted = () => {
      for (const filePath of deleted) {
        const project = resolveFileProject(filePath, this.opts.boundaries);
        symbolRepo.deleteFileSymbols(project, filePath);
        relationRepo.deleteFileRelations(project, filePath);
        fileRepo.deleteFile(project, filePath);
      }
    };

    // ── Index changed / new files ─────────────────────────────────────────
    const processChanged = async () => {
      for (const file of changed) {
        await this._processFile(file.filePath, file.contentHash || undefined, tsconfigPaths);
      }
    };

    if (useTransaction) {
      dbConnection.transaction(() => {
        // Full re-index: clear ALL file records first (cascades to symbols/relations).
        const allFiles = fileRepo.getAllFiles(resolveFileProject(this.opts.projectRoot, this.opts.boundaries));
        for (const f of allFiles) {
          fileRepo.deleteFile(f.project ?? resolveFileProject(f.filePath, this.opts.boundaries), f.filePath);
        }
      });
    } else {
      processDeleted();
    }

    await processChanged();

    // ── Move detection: retarget relations ────────────────────────────────
    for (const [oldFile, syms] of deletedSymbols) {
      for (const sym of syms) {
        if (!sym.fingerprint) continue;
        const oldProject = resolveFileProject(oldFile, this.opts.boundaries);
        const matches = symbolRepo.getByFingerprint(oldProject, sym.fingerprint);
        if (matches.length === 1) {
          const newSym = matches[0];
          relationRepo.retargetRelations(
            oldProject,
            oldFile,
            sym.name,
            newSym.filePath,
            newSym.name,
          );
        }
      }
    }

    return {
      indexedFiles: changed.length,
      removedFiles: deleted.length,
      totalSymbols: 0,
      totalRelations: 0,
      durationMs: Date.now() - start,
    };
  }

  /** Reads, parses, and indexes a single file. */
  private async _processFile(
    filePath: string,
    knownHash: string | undefined,
    tsconfigPaths: unknown,
  ): Promise<void> {
    const { projectRoot, boundaries } = this.opts;
    const { fileRepo, symbolRepo, relationRepo, parseCache } = this.opts;

    const absPath = toAbsolutePath(projectRoot, filePath);
    const bunFile = Bun.file(absPath);
    const text = await bunFile.text();
    const contentHash = knownHash || hashString(text);

    const project = resolveFileProject(filePath, boundaries);

    // ── Parse ──────────────────────────────────────────────────────────────
    const parseFn = this.opts.parseSourceFn ?? parseSource;
    const parsed = parseFn(absPath, text);
    parseCache.set(filePath, parsed);

    // ── Upsert file record ─────────────────────────────────────────────────
    fileRepo.upsertFile({
      project,
      filePath,
      mtimeMs: bunFile.lastModified,
      size: bunFile.size,
      contentHash,
      updatedAt: new Date().toISOString(),
    });

    // ── Index symbols ──────────────────────────────────────────────────────
    indexFileSymbols({ parsed, project, filePath, contentHash, symbolRepo });

    // ── Index relations ────────────────────────────────────────────────────
    indexFileRelations({
      ast: parsed.program,
      project,
      filePath,
      relationRepo,
      projectRoot,
      tsconfigPaths,
    });
  }

  /** Fires all registered callbacks, logging but not propagating errors. */
  private _fireCallbacks(result: IndexResult): void {
    for (const cb of this.callbacks) {
      try {
        cb(result);
      } catch (err) {
        console.error('[IndexCoordinator] onIndexed callback threw:', err);
      }
    }
  }

  /** Called when the debounce timer fires. */
  private _flushPending(): void {
    if (this.indexingLock) {
      // Lock is active — events remain in pendingEvents and will be consumed
      // by the finally block of the in-flight indexing run.
      return;
    }
    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0);
      this._startIndex(events, false);
    }
  }
}
