import type { RelationRecord } from '../store/repositories/relation.repository';

export interface IDependencyGraphRepo {
  getByType(project: string, type: string): RelationRecord[];
}

export class DependencyGraph {
  private adjacencyList = new Map<string, Set<string>>();
  private reverseAdjacencyList = new Map<string, Set<string>>();

  constructor(
    private readonly options: {
      relationRepo: IDependencyGraphRepo;
      project: string;
    },
  ) {}

  async build(): Promise<void> {
    this.adjacencyList = new Map();
    this.reverseAdjacencyList = new Map();

    const relations = this.options.relationRepo.getByType(
      this.options.project,
      'imports',
    );

    for (const rel of relations) {
      const { srcFilePath, dstFilePath } = rel;

      if (!this.adjacencyList.has(srcFilePath)) {
        this.adjacencyList.set(srcFilePath, new Set());
      }
      this.adjacencyList.get(srcFilePath)!.add(dstFilePath);

      if (!this.reverseAdjacencyList.has(dstFilePath)) {
        this.reverseAdjacencyList.set(dstFilePath, new Set());
      }
      this.reverseAdjacencyList.get(dstFilePath)!.add(srcFilePath);
    }
  }

  getDependencies(filePath: string): string[] {
    return Array.from(this.adjacencyList.get(filePath) ?? []);
  }

  getDependents(filePath: string): string[] {
    return Array.from(this.reverseAdjacencyList.get(filePath) ?? []);
  }

  getTransitiveDependents(filePath: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [filePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dependent of this.reverseAdjacencyList.get(current) ?? []) {
        if (!visited.has(dependent)) {
          visited.add(dependent);
          queue.push(dependent);
        }
      }
    }

    return Array.from(visited);
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);

      for (const neighbor of this.adjacencyList.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of this.adjacencyList.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) return true;
      }
    }

    return false;
  }

  getAffectedByChange(changedFiles: string[]): string[] {
    const allAffected = new Set<string>();

    for (const file of changedFiles) {
      for (const dep of this.getTransitiveDependents(file)) {
        allAffected.add(dep);
      }
    }

    return Array.from(allAffected);
  }
}
