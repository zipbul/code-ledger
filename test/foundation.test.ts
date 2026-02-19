import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { discoverProjects, resolveFileProject } from "../src/common/project-discovery";
import { clearTsconfigPathsCache, loadTsconfigPaths } from "../src/common/tsconfig-resolver";
import { ProjectWatcher } from "../src/watcher/project-watcher";

const TEST_ROOT = join(process.cwd(), ".tmp-foundation-integration");

afterEach(async () => {
  clearTsconfigPathsCache();
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("foundation integration", () => {
  it("should discover projects and resolve the owning project when monorepo package manifests exist", async () => {
    const root = join(TEST_ROOT, "workspace");
    await mkdir(join(root, "apps/web"), { recursive: true });
    await mkdir(join(root, "apps/mobile"), { recursive: true });

    await Bun.write(join(root, "package.json"), JSON.stringify({ name: "@ws/root" }));
    await Bun.write(join(root, "apps/web/package.json"), JSON.stringify({ name: "@ws/web" }));
    await Bun.write(join(root, "apps/mobile/package.json"), JSON.stringify({ name: "@ws/mobile" }));

    const boundaries = await discoverProjects(root);
    const project = resolveFileProject("apps/web/src/app.ts", boundaries, "@ws/root");

    expect(boundaries.map((item) => item.project)).toEqual([
      "@ws/mobile",
      "@ws/web",
      "@ws/root",
    ]);
    expect(project).toBe("@ws/web");
  });

  it("should load path aliases when tsconfig has baseUrl and paths", async () => {
    const root = join(TEST_ROOT, "workspace-alias");
    await mkdir(root, { recursive: true });

    await Bun.write(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: "./",
          paths: {
            "@app/*": ["src/*"],
          },
        },
      }),
    );

    const result = await loadTsconfigPaths(root);

    expect(result?.baseUrl).toBe(root);
    expect(result?.paths.get("@app/*")).toEqual(["src/*"]);
  });

  it("should emit change event for package json when watcher detects modification", async () => {
    const root = join(TEST_ROOT, "watcher-discovery");
    await mkdir(join(root, "packages/core"), { recursive: true });

    await Bun.write(join(root, "package.json"), JSON.stringify({ name: "@ws/root" }));
    await Bun.write(join(root, "packages/core/package.json"), JSON.stringify({ name: "@ws/core" }));

    const detectedEvents: Array<{ eventType: string; filePath: string }> = [];

    let capturedCallback: ((error: Error | null, events: Array<{ type: string; path: string }>) => void) | undefined;

    const fakeSubscribe = async (
      _dir: string,
      cb: (error: Error | null, events: Array<{ type: string; path: string }>) => void,
    ) => {
      capturedCallback = cb;
      return { unsubscribe: async () => {} };
    };

    const watcher = new ProjectWatcher({ projectRoot: root }, fakeSubscribe as never);
    await watcher.start((event) => detectedEvents.push(event));

    capturedCallback?.(null, [{ type: "update", path: join(root, "packages/core/package.json") }]);

    const boundaries = await discoverProjects(root);
    const project = resolveFileProject(
      detectedEvents[0]?.filePath ?? "",
      boundaries,
      "@ws/root",
    );

    expect(detectedEvents[0]?.filePath).toBe("packages/core/package.json");
    expect(project).toBe("@ws/core");

    await watcher.close();
  });

  it("should resolve file project using tsconfig baseUrl alias prefix when paths are loaded", async () => {
    const root = join(TEST_ROOT, "alias-resolution");
    await mkdir(join(root, "apps/web"), { recursive: true });

    await Bun.write(join(root, "package.json"), JSON.stringify({ name: "@ws/root" }));
    await Bun.write(join(root, "apps/web/package.json"), JSON.stringify({ name: "@ws/web" }));
    await Bun.write(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@web/*": ["apps/web/src/*"] },
        },
      }),
    );

    const [boundaries, tsconfigPaths] = await Promise.all([
      discoverProjects(root),
      loadTsconfigPaths(root),
    ]);

    const project = resolveFileProject("apps/web/src/index.ts", boundaries, "@ws/root");

    expect(project).toBe("@ws/web");
    expect(tsconfigPaths?.paths.get("@web/*")).toEqual(["apps/web/src/*"]);
  });
});