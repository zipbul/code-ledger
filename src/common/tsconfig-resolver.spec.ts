import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { clearTsconfigPathsCache, loadTsconfigPaths } from "./tsconfig-resolver";

const PROJECT_ROOT = "/fake/project";
const TSCONFIG_PATH = join(PROJECT_ROOT, "tsconfig.json");
const JSCONFIG_PATH = join(PROJECT_ROOT, "jsconfig.json");

function makeBunFile(content: Record<string, unknown> | null): ReturnType<typeof Bun.file> {
  return {
    exists: async () => content !== null,
    json: async () => content,
  } as ReturnType<typeof Bun.file>;
}

afterEach(() => {
  clearTsconfigPathsCache();
  spyOn(Bun, "file").mockRestore();
});

describe("loadTsconfigPaths", () => {
  it("should return null when tsconfig file does not exist", async () => {
    spyOn(Bun, "file").mockImplementation(() => makeBunFile(null));

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return parsed baseUrl and paths when tsconfig has compiler options", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should return null when tsconfig has no baseUrl and no paths", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) return makeBunFile({ compilerOptions: {} });
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return null when tsconfig does not exist", async () => {
    spyOn(Bun, "file").mockImplementation((_p) => {
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return cached value when file changes without invalidation", async () => {
    let callCount = 0;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        callCount += 1;
        const alias = callCount === 1 ? "src/*" : "next/*";
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": [alias] } } });
      }
      return makeBunFile(null);
    });

    const first = await loadTsconfigPaths(PROJECT_ROOT);
    const second = await loadTsconfigPaths(PROJECT_ROOT);

    expect(first?.paths.get("@/*")).toEqual(["src/*"]);
    expect(second?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should refresh cached value when project cache is cleared", async () => {
    let callCount = 0;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        callCount += 1;
        const alias = callCount === 1 ? "src/*" : "updated/*";
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": [alias] } } });
      }
      return makeBunFile(null);
    });

    await loadTsconfigPaths(PROJECT_ROOT);
    clearTsconfigPathsCache(PROJECT_ROOT);
    const refreshed = await loadTsconfigPaths(PROJECT_ROOT);

    expect(refreshed?.paths.get("@/*")).toEqual(["updated/*"]);
  });

  it("should return null when tsconfig has no compilerOptions field", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) return makeBunFile({ include: ["src"] });
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return result with empty paths map when only baseUrl is present", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) return makeBunFile({ compilerOptions: { baseUrl: "." } });
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.size).toBe(0);
  });

  it("should return result with projectRoot as baseUrl when only paths is present", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({ compilerOptions: { paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should skip entry when paths value is not an array", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({
          compilerOptions: { baseUrl: ".", paths: { "@/*": "src/*", "#/*": ["lib/*"] } },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.paths.has("@/*")).toBe(false);
    expect(result?.paths.get("#/*")).toEqual(["lib/*"]);
  });

  it("should filter non-string values from paths array entries", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*", 42, null, "lib/*"] } },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.paths.get("@/*")).toEqual(["src/*", "lib/*"]);
  });

  it("should return null on second call when cached value is null", async () => {
    spyOn(Bun, "file").mockImplementation(() => makeBunFile(null));

    const first = await loadTsconfigPaths(PROJECT_ROOT);
    const second = await loadTsconfigPaths(PROJECT_ROOT);

    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("should reload all projects when clearTsconfigPathsCache is called without argument", async () => {
    const rootA = "/fake/project-a";
    const rootB = "/fake/project-b";
    let callCountA = 0;

    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === join(rootA, "tsconfig.json")) {
        callCountA += 1;
        const alias = callCountA === 1 ? "old/*" : "new/*";
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": [alias] } } });
      }
      if (s === join(rootB, "tsconfig.json")) {
        return makeBunFile({ compilerOptions: { baseUrl: "." } });
      }
      return makeBunFile(null);
    });

    await loadTsconfigPaths(rootA);
    await loadTsconfigPaths(rootB);

    clearTsconfigPathsCache();

    const refreshedA = await loadTsconfigPaths(rootA);
    const refreshedB = await loadTsconfigPaths(rootB);

    expect(refreshedA?.paths.get("@/*")).toEqual(["new/*"]);
    expect(refreshedB?.paths.size).toBe(0);
  });
});
