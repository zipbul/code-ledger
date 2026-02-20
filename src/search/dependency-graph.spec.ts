import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RelationRecord } from '../store/repositories/relation.repository';
import { DependencyGraph } from './dependency-graph';
import type { IDependencyGraphRepo } from './dependency-graph';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeImport(srcFilePath: string, dstFilePath: string): RelationRecord {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath,
    srcSymbolName: null,
    dstFilePath,
    dstSymbolName: null,
    metaJson: null,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

let mockGetByType: ReturnType<typeof mock>;
let mockRepo: IDependencyGraphRepo;
let graph: DependencyGraph;

beforeEach(() => {
  mockGetByType = mock((_project: string, _type: string) => [] as RelationRecord[]);
  mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
  graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DependencyGraph', () => {
  // ── build() ───────────────────────────────────────────────────────────────

  it('should populate adjacencyList from imports relations after build()', async () => {
    // Arrange
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    // Act
    await graph.build();
    // Assert
    expect(graph.getDependencies('src/a.ts')).toContain('src/b.ts');
  });

  it('should populate reverseAdjacencyList for reverse lookup after build()', async () => {
    // Arrange
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    // Act
    await graph.build();
    // Assert
    expect(graph.getDependents('src/b.ts')).toContain('src/a.ts');
  });

  it('should result in empty graph after build() when DB has no imports relations', async () => {
    // Arrange — default mock returns []
    // Act
    await graph.build();
    // Assert
    expect(graph.getDependencies('src/a.ts')).toEqual([]);
    expect(graph.getDependents('src/a.ts')).toEqual([]);
  });

  it('should only load relations of type "imports" during build()', async () => {
    // Arrange
    await graph.build();
    // Assert
    expect(mockGetByType).toHaveBeenCalledTimes(1);
    const [, type] = mockGetByType.mock.calls[0]!;
    expect(type).toBe('imports');
  });

  it('should replace old graph data when build() is called a second time', async () => {
    // Arrange — first build: a→b
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Re-setup with different data: c→d
    mockGetByType = mock(() => [makeImport('src/c.ts', 'src/d.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Assert — old edge gone, new edge present
    expect(graph.getDependencies('src/a.ts')).toEqual([]);
    expect(graph.getDependencies('src/c.ts')).toContain('src/d.ts');
  });

  // ── getDependencies() ─────────────────────────────────────────────────────

  it('should return direct dependencies of a file after build()', async () => {
    // Arrange
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/a.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getDependencies('src/a.ts');
    // Assert
    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/c.ts');
    expect(deps).toHaveLength(2);
  });

  it('should return [] from getDependencies when filePath is not in the graph', () => {
    // Arrange — no build needed; empty graph
    // Act
    const deps = graph.getDependencies('src/unknown.ts');
    // Assert
    expect(deps).toEqual([]);
  });

  it('should return [] from getDependencies when file has no outgoing imports', async () => {
    // Arrange — b.ts is only a destination, never a source
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getDependencies('src/b.ts');
    // Assert
    expect(deps).toEqual([]);
  });

  // ── getDependents() ───────────────────────────────────────────────────────

  it('should return files that directly import the given file after build()', async () => {
    // Arrange
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/x.ts'),
      makeImport('src/b.ts', 'src/x.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getDependents('src/x.ts');
    // Assert
    expect(deps).toContain('src/a.ts');
    expect(deps).toContain('src/b.ts');
    expect(deps).toHaveLength(2);
  });

  it('should return [] from getDependents when filePath is not imported by anyone', () => {
    // Arrange — empty graph
    // Act
    const deps = graph.getDependents('src/unknown.ts');
    // Assert
    expect(deps).toEqual([]);
  });

  it('should return [] from getDependents when file has no incoming imports', async () => {
    // Arrange — a.ts only imports, never imported
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getDependents('src/a.ts');
    // Assert
    expect(deps).toEqual([]);
  });

  // ── getTransitiveDependents() ─────────────────────────────────────────────

  it('should return all transitively dependent files via BFS after build()', async () => {
    // Arrange: a→b→c (c is deep dependency; a,b are dependents of c)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act — who depends on c.ts transitively?
    const deps = graph.getTransitiveDependents('src/c.ts');
    // Assert
    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/a.ts');
    expect(deps).toHaveLength(2);
  });

  it('should not include the input filePath itself in getTransitiveDependents result', async () => {
    // Arrange: a→b
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getTransitiveDependents('src/b.ts');
    // Assert
    expect(deps).not.toContain('src/b.ts');
    expect(deps).toContain('src/a.ts');
  });

  it('should return [] from getTransitiveDependents when filePath has no dependents', async () => {
    // Arrange: empty graph
    // Act
    const deps = graph.getTransitiveDependents('src/unknown.ts');
    // Assert
    expect(deps).toEqual([]);
  });

  it('should deduplicate results in getTransitiveDependents for diamond dependency', async () => {
    // Arrange: a→b, a→d, b→c, d→c (diamond; c is root)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/a.ts', 'src/d.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getTransitiveDependents('src/c.ts');
    // Assert — a.ts should appear only once despite two paths
    const count = deps.filter(f => f === 'src/a.ts').length;
    expect(count).toBe(1);
    expect(deps).toContain('src/b.ts');
    expect(deps).toContain('src/d.ts');
    expect(deps).toContain('src/a.ts');
  });

  it('should not loop infinitely when cycle exists during getTransitiveDependents', async () => {
    // Arrange: a→b→a (cycle)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act — should terminate thanks to visited set
    const deps = graph.getTransitiveDependents('src/b.ts');
    // Assert
    expect(Array.isArray(deps)).toBe(true);
  });

  it('should traverse long chain correctly in getTransitiveDependents', async () => {
    // Arrange: b→c→d→e (e is root; b,c,d all depend on e transitively)
    mockGetByType = mock(() => [
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/e.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getTransitiveDependents('src/e.ts');
    // Assert
    expect(deps).toContain('src/d.ts');
    expect(deps).toContain('src/c.ts');
    expect(deps).toContain('src/b.ts');
    expect(deps).toHaveLength(3);
  });

  it('should return an Array (not Set) from getTransitiveDependents', async () => {
    // Arrange
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getTransitiveDependents('src/b.ts');
    // Assert
    expect(Array.isArray(deps)).toBe(true);
  });

  // ── hasCycle() ────────────────────────────────────────────────────────────

  it('should return false from hasCycle() when there are no cycles', async () => {
    // Arrange: a→b→c (DAG)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act + Assert
    expect(graph.hasCycle()).toBe(false);
  });

  it('should return true from hasCycle() when a simple cycle exists', async () => {
    // Arrange: a→b→a
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act + Assert
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return true from hasCycle() when a self-loop exists', async () => {
    // Arrange: a→a
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/a.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act + Assert
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return false from hasCycle() when graph is empty', async () => {
    // Arrange — default mock returns []
    await graph.build();
    // Act + Assert
    expect(graph.hasCycle()).toBe(false);
  });

  it('should return true from hasCycle() when cycle exists in a subgraph (other part acyclic)', async () => {
    // Arrange: a→b (acyclic) + c→d→c (cycle)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/c.ts', 'src/d.ts'),
      makeImport('src/d.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act + Assert
    expect(graph.hasCycle()).toBe(true);
  });

  it('should return true from hasCycle() for a long cycle', async () => {
    // Arrange: a→b→c→a
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
      makeImport('src/c.ts', 'src/a.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act + Assert
    expect(graph.hasCycle()).toBe(true);
  });

  // ── getAffectedByChange() ─────────────────────────────────────────────────

  it('should return transitive dependents of a single changed file', async () => {
    // Arrange: a→b→c
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/b.ts'),
      makeImport('src/b.ts', 'src/c.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const affected = graph.getAffectedByChange(['src/c.ts']);
    // Assert
    expect(affected).toContain('src/b.ts');
    expect(affected).toContain('src/a.ts');
  });

  it('should return deduplicated union of transitive dependents for multiple changed files', async () => {
    // Arrange: a→x, b→x, c→y (x and y are both changed)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/x.ts'),
      makeImport('src/b.ts', 'src/x.ts'),
      makeImport('src/c.ts', 'src/y.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const affected = graph.getAffectedByChange(['src/x.ts', 'src/y.ts']);
    // Assert
    expect(affected).toContain('src/a.ts');
    expect(affected).toContain('src/b.ts');
    expect(affected).toContain('src/c.ts');
  });

  it('should return [] from getAffectedByChange when changed files have no dependents', async () => {
    // Arrange: a→b (only b has no dependents)
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const affected = graph.getAffectedByChange(['src/a.ts']);
    // Assert
    expect(affected).toEqual([]);
  });

  it('should return [] from getAffectedByChange when changedFiles is empty array', async () => {
    // Arrange
    await graph.build();
    // Act
    const affected = graph.getAffectedByChange([]);
    // Assert
    expect(affected).toEqual([]);
  });

  it('should return [] from getAffectedByChange when changed file is unknown', async () => {
    // Arrange — empty graph
    await graph.build();
    // Act
    const affected = graph.getAffectedByChange(['src/unknown.ts']);
    // Assert
    expect(affected).toEqual([]);
  });

  it('should deduplicate overlapping dependents across multiple changed files', async () => {
    // Arrange: a→x, a→y (a depends on both x and y)
    mockGetByType = mock(() => [
      makeImport('src/a.ts', 'src/x.ts'),
      makeImport('src/a.ts', 'src/y.ts'),
    ]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act — both x and y are changed; a.ts should appear once
    const affected = graph.getAffectedByChange(['src/x.ts', 'src/y.ts']);
    const countA = affected.filter(f => f === 'src/a.ts').length;
    // Assert
    expect(countA).toBe(1);
  });

  // ── ST: state transitions ─────────────────────────────────────────────────

  it('should return [] from getDependencies before build() is called', () => {
    // Arrange — no build called, fresh instance
    // Act
    const deps = graph.getDependencies('src/a.ts');
    // Assert
    expect(deps).toEqual([]);
  });

  it('should reflect loaded data from getDependencies after build()', async () => {
    // Arrange
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    // Act
    await graph.build();
    // Assert
    expect(graph.getDependencies('src/a.ts')).toEqual(['src/b.ts']);
  });

  it('should reflect new data after rebuild with different relations', async () => {
    // Arrange — first build: a→b
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Re-create with c→d and rebuild
    mockGetByType = mock(() => [makeImport('src/c.ts', 'src/d.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Assert
    expect(graph.getDependencies('src/a.ts')).toEqual([]);
    expect(graph.getDependencies('src/c.ts')).toEqual(['src/d.ts']);
  });

  it('should build a single-edge graph correctly', async () => {
    // Arrange: single relation a→b
    mockGetByType = mock(() => [makeImport('src/a.ts', 'src/b.ts')]);
    mockRepo = { getByType: mockGetByType } as IDependencyGraphRepo;
    graph = new DependencyGraph({ relationRepo: mockRepo, project: 'test-project' });
    await graph.build();
    // Act
    const deps = graph.getDependencies('src/a.ts');
    const revDeps = graph.getDependents('src/b.ts');
    // Assert
    expect(deps).toEqual(['src/b.ts']);
    expect(revDeps).toEqual(['src/a.ts']);
  });
});
