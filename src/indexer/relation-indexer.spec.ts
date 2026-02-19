import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ── Mock ../extractor/relation-extractor ──────────────────────────────────
const mockExtractRelations = mock((_ast: any, _filePath: string, _tsconfig?: any) => [] as any[]);

// ── Mock ../common/path-utils ──────────────────────────────────────────────
const mockToRelativePath = mock((_root: string, _abs: string) => '');
const mockToAbsolutePath = mock((_root: string, _rel: string) => '');

import { indexFileRelations } from './relation-indexer';

const PROJECT = 'test-project';
const PROJECT_ROOT = '/project';
const REL_FILE = 'src/index.ts';
const ABS_FILE = '/project/src/index.ts';

function makeRelation(overrides: Partial<{
  type: string; srcFilePath: string; srcSymbolName: string | null;
  dstFilePath: string; dstSymbolName: string | null; metaJson: string | null;
}> = {}) {
  return {
    type: 'imports',
    srcFilePath: ABS_FILE,
    srcSymbolName: null,
    dstFilePath: '/project/src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

function makeRelationRepo() {
  return { replaceFileRelations: mock((_p: any, _f: any, _rels: any) => {}) };
}

beforeEach(() => {
  mock.module('../extractor/relation-extractor', () => ({ extractRelations: mockExtractRelations }));
  mock.module('../common/path-utils', () => ({
    toRelativePath: mockToRelativePath,
    toAbsolutePath: mockToAbsolutePath,
  }));
  mockExtractRelations.mockReset();
  mockExtractRelations.mockReturnValue([]);
  mockToRelativePath.mockReset();
  mockToAbsolutePath.mockReset();
  mockToAbsolutePath.mockImplementation((_root: string, rel: string) => `/project/${rel}`);
  mockToRelativePath.mockImplementation((_root: string, abs: string) =>
    abs.replace('/project/', ''),
  );
});

describe('indexFileRelations', () => {
  // [HP] in-project dst → relation included in output
  it('should include relation when dst is within project root', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
  });

  // [NE] out-of-project dst ('../other/file.ts') → filtered out
  it('should filter out relation when dst normalizes to path starting with ..', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ dstFilePath: '/other/project/file.ts' })]);
    mockToRelativePath.mockImplementation((_root: string, abs: string) =>
      abs.startsWith('/project') ? abs.replace('/project/', '') : `../other/project/${abs.split('/').pop()}`,
    );
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  // [HP] extractRelations called with absolute filePath
  it('should call extractRelations with the absolute filePath', () => {
    mockToAbsolutePath.mockReturnValue(ABS_FILE);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    expect(mockExtractRelations).toHaveBeenCalledWith(expect.anything(), ABS_FILE, undefined);
  });

  // [HP] replaceFileRelations called with relative filePath
  it('should call replaceFileRelations with the relative (not absolute) filePath', () => {
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, filePath] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(filePath).toBe(REL_FILE);
  });

  // [HP] dst absolute path normalized to relative
  it('should normalize absolute dst paths to relative in output relations', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ dstFilePath: '/project/src/utils.ts' })]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].dstFilePath).toBe('src/utils.ts');
  });

  // [ED] 0 relations → replaceFileRelations([]) called
  it('should call replaceFileRelations with empty array when extractRelations returns nothing', () => {
    mockExtractRelations.mockReturnValue([]);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  // [CO] mix: in-project + out-of-project → only in-project survive
  it('should retain only in-project relations when mix of in/out-project are returned', () => {
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/project/src/utils.ts' }),
      makeRelation({ dstFilePath: '/external/lib.ts' }),
    ]);
    mockToRelativePath.mockImplementation((_root: string, abs: string) =>
      abs.startsWith('/project') ? 'src/utils.ts' : '../external/lib.ts',
    );
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
    expect(rels[0].dstFilePath).toBe('src/utils.ts');
  });

  // [HP] tsconfigPaths passed through to extractRelations
  it('should pass tsconfigPaths to extractRelations when provided', () => {
    const tsconfigPaths = { baseUrl: '/project', paths: new Map() };
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, tsconfigPaths });

    expect(mockExtractRelations).toHaveBeenCalledWith(expect.anything(), expect.anything(), tsconfigPaths);
  });

  // [NE] all relations filtered → empty array to replaceFileRelations
  it('should pass empty array to replaceFileRelations when all relations are filtered', () => {
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/other1/file.ts' }),
      makeRelation({ dstFilePath: '/other2/file.ts' }),
    ]);
    mockToRelativePath.mockReturnValue('../other/file.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  // [ID] same input twice → same result
  it('should produce identical calls on second invocation with same input', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });
    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels1] = relationRepo.replaceFileRelations.mock.calls[0]!;
    const [, , rels2] = relationRepo.replaceFileRelations.mock.calls[1]!;
    expect(rels1.length).toBe(rels2.length);
  });

  // [HP] src filePath relative (not absolute) in output
  it('should set srcFilePath to relative path in relation output', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ srcFilePath: ABS_FILE })]);
    mockToRelativePath.mockImplementation((_root: string, abs: string) => {
      if (abs === ABS_FILE) return REL_FILE;
      return 'src/utils.ts';
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].srcFilePath).toBe(REL_FILE);
  });
});
