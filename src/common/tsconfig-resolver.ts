import path from "node:path";

export interface TsconfigPaths {
  baseUrl: string;
  paths: Map<string, string[]>;
}

const cache = new Map<string, TsconfigPaths | null>();

async function readConfig(configPath: string): Promise<Record<string, unknown> | null> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return null;
  }

  const parsed = await file.json();
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

export async function loadTsconfigPaths(projectRoot: string): Promise<TsconfigPaths | null> {
  if (cache.has(projectRoot)) {
    return cache.get(projectRoot) ?? null;
  }

  const tsconfigPath = path.join(projectRoot, "tsconfig.json");

  const config = await readConfig(tsconfigPath);
  if (!config) {
    cache.set(projectRoot, null);
    return null;
  }

  const compilerOptions =
    typeof config.compilerOptions === "object" && config.compilerOptions !== null
      ? (config.compilerOptions as Record<string, unknown>)
      : null;

  if (!compilerOptions) {
    cache.set(projectRoot, null);
    return null;
  }

  const rawBaseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : null;
  const rawPaths =
    typeof compilerOptions.paths === "object" && compilerOptions.paths !== null
      ? (compilerOptions.paths as Record<string, unknown>)
      : null;

  if (!rawBaseUrl && !rawPaths) {
    cache.set(projectRoot, null);
    return null;
  }

  const resolvedBaseUrl = rawBaseUrl ? path.resolve(projectRoot, rawBaseUrl) : projectRoot;
  const paths = new Map<string, string[]>();

  if (rawPaths) {
    for (const [pattern, targets] of Object.entries(rawPaths)) {
      if (!Array.isArray(targets)) {
        continue;
      }

      const normalizedTargets = targets.filter((value): value is string => typeof value === "string");
      paths.set(pattern, normalizedTargets);
    }
  }

  const result: TsconfigPaths = {
    baseUrl: resolvedBaseUrl,
    paths,
  };

  cache.set(projectRoot, result);
  return result;
}

export function clearTsconfigPathsCache(projectRoot?: string): void {
  if (projectRoot) {
    cache.delete(projectRoot);
    return;
  }

  cache.clear();
}