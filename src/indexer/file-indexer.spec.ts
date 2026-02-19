import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

// ── Mock node:fs glob ──────────────────────────────────────────────────────
const mockGlob = mock(async function* (): AsyncGenerator<string> {});

// ── Mock hashString ────────────────────────────────────────────────────────
const mockHashString = mock((_input: string) => 'mocked-hash');

import { detectChanges } from './file-indexer';

const PROJECT_ROOT = '/project';
const EXTENSIONS = ['.ts'];
const IGNORE_PATTERNS = ['**/node_modules/**'];

// ── Fake fileRepo ──────────────────────────────────────────────────────────
function makeFileRepo(filesMap: Map<string, any> = new Map()) {
  return {
    getFilesMap: mock(() => filesMap),
    upsertFile: mock(() => {}),
  };
}

function makeBunFile(opts: { size: number; lastModified: number; text?: string }) {
  return {
    size: opts.size,
    lastModified: opts.lastModified,
    text: mock(async () => opts.text ?? 'content'),
  } as any;
}

beforeEach(() => {
  mock.module('node:fs', () => ({
    promises: { glob: mockGlob },
  }));
  mock.module('../common/hasher', () => ({
    hashString: mockHashString,
  }));
  mockGlob.mockReset();
  mockHashString.mockReset();
  mockHashString.mockReturnValue('mocked-hash');
  spyOn(Bun, 'file').mockRestore();
});

afterEach(() => {
  spyOn(Bun, 'file').mockRestore();
});

describe('detectChanges', () => {
  // [HP] new file not in DB → ends up in changed[]
  it('should put new file in changed[] when it does not exist in DB', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/index.ts')).toBe(true);
  });

  // [HP] file in DB, mtime+size same → unchanged[]
  it('should put file in unchanged[] when mtime and size match DB record', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.unchanged.some((f) => f.filePath === 'src/index.ts')).toBe(true);
    expect(result.changed).toEqual([]);
  });

  // [HP] file in DB, mtime changed, content changed → changed[]
  it('should put file in changed[] when mtime changed and contentHash differs', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 9999, text: 'new content' }));
    mockHashString.mockReturnValue('new-hash');
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'old-hash' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/index.ts')).toBe(true);
  });

  // [CO] file in DB, mtime changed, content same → unchanged[] (optimization)
  it('should put file in unchanged[] when mtime changed but contentHash is same', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 9999, text: 'same content' }));
    mockHashString.mockReturnValue('same-hash');
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'same-hash' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.unchanged.some((f) => f.filePath === 'src/index.ts')).toBe(true);
    expect(result.changed).toEqual([]);
  });

  // [HP] file in DB but not on disk → deleted[]
  it('should put file in deleted[] when it exists in DB but not on disk', async () => {
    mockGlob.mockImplementation(async function* () {});
    const existing = new Map([['src/gone.ts', { filePath: 'src/gone.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.deleted).toContain('src/gone.ts');
  });

  // [ED] empty directory → all arrays empty
  it('should return all empty arrays when directory has no matching files and DB is empty', async () => {
    mockGlob.mockImplementation(async function* () {});
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  // [HP] contentHash computed for new files
  it('should compute contentHash for new files', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/new.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    mockHashString.mockReturnValue('computed-hash');
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed[0]?.contentHash).toBe('computed-hash');
  });

  // [HP] contentHash NOT computed for mtime+size unchanged (optimization)
  it('should not call hashString when mtime and size are unchanged', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(mockHashString).not.toHaveBeenCalled();
  });

  // [HP] extension filter: non-.ts file excluded
  it('should exclude files that do not match extensions', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/styles.css'; });
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
  });

  // [HP] ignorePattern matched file excluded
  it('should exclude files matching ignorePatterns', async () => {
    mockGlob.mockImplementation(async function* () { yield 'node_modules/lib/index.ts'; });
    const fileRepo = makeFileRepo(new Map());

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed).toEqual([]);
  });

  // [NE] Bun.file().text() throws → error propagates
  it('should propagate error when Bun.file().text() throws', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/bad.ts'; });
    spyOn(Bun, 'file').mockReturnValue({
      size: 50, lastModified: 500,
      text: mock(async () => { throw new Error('read error'); }),
    } as any);
    const fileRepo = makeFileRepo(new Map());

    await expect(
      detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any })
    ).rejects.toThrow('read error');
  });

  // [ID] detectChanges twice, no changes → same result
  it('should return same result on second call when no files changed', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/index.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 100, lastModified: 1000 }));
    const existing = new Map([['src/index.ts', { filePath: 'src/index.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const r1 = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });
    const r2 = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(r1.unchanged.length).toBe(r2.unchanged.length);
    expect(r1.changed.length).toBe(r2.changed.length);
  });

  // [CO] new + deleted in same scan
  it('should correctly categorize new and deleted files in the same scan', async () => {
    mockGlob.mockImplementation(async function* () { yield 'src/new.ts'; });
    spyOn(Bun, 'file').mockReturnValue(makeBunFile({ size: 50, lastModified: 500 }));
    const existing = new Map([['src/gone.ts', { filePath: 'src/gone.ts', mtimeMs: 1000, size: 100, contentHash: 'abc' }]]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/new.ts')).toBe(true);
    expect(result.deleted).toContain('src/gone.ts');
  });

  // [HP] mix: new + changed + unchanged + deleted all in one result
  it('should correctly categorize all four types simultaneously', async () => {
    mockGlob.mockImplementation(async function* () {
      yield 'src/new.ts';
      yield 'src/changed.ts';
      yield 'src/same.ts';
    });
    let callCount = 0;
    spyOn(Bun, 'file').mockImplementation((_p: any) => {
      callCount++;
      return makeBunFile({ size: 50, lastModified: 9999 });
    });
    mockHashString.mockImplementation((text: string) => text === 'same' ? 'hash-same' : 'hash-new');
    const existing = new Map([
      ['src/changed.ts', { filePath: 'src/changed.ts', mtimeMs: 1, size: 50, contentHash: 'hash-old' }],
      ['src/same.ts', { filePath: 'src/same.ts', mtimeMs: 9999, size: 50, contentHash: 'hash-same' }],
      ['src/deleted.ts', { filePath: 'src/deleted.ts', mtimeMs: 1, size: 50, contentHash: 'hash-x' }],
    ]);
    const fileRepo = makeFileRepo(existing);

    const result = await detectChanges({ projectRoot: PROJECT_ROOT, extensions: EXTENSIONS, ignorePatterns: IGNORE_PATTERNS, fileRepo: fileRepo as any });

    expect(result.changed.some((f) => f.filePath === 'src/new.ts')).toBe(true);
    expect(result.deleted).toContain('src/deleted.ts');
  });
});
