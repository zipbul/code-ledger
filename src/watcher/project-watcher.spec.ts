import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AsyncSubscription, SubscribeCallback, SubscribeOptions } from "@parcel/watcher";
import { ProjectWatcher } from "./project-watcher";
import { WatcherError } from "../errors";

function createFakeSubscription(): AsyncSubscription {
  return {
    unsubscribe: async () => {},
  };
}

describe("ProjectWatcher", () => {
  it("should map raw update event to change when subscribed event is valid source file", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (
      _path: string,
      cb: SubscribeCallback,
      _opts?: SubscribeOptions,
    ): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher(
      {
        projectRoot: "/repo",
        extensions: [".ts"],
      },
      subscribe,
    );

    await watcher.start((event) => {
      events.push(event);
    });

    callback?.(undefined, [{ type: "update", path: "/repo/src/main.ts" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "src/main.ts" }]);
  });

  it("should ignore file outside project root when callback receives outside path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher(
      {
        projectRoot: "/repo",
        extensions: [".ts"],
      },
      subscribe,
    );

    await watcher.start((event) => {
      events.push(event);
    });

    callback?.(undefined, [{ type: "create", path: "/other/outside.ts" }]);

    expect(events).toEqual([]);
  });

  it("should close subscription when close is called after start", async () => {
    const unsubscribeFn = mock(async () => {});
    const subscribe = async (): Promise<AsyncSubscription> => ({
      unsubscribe: unsubscribeFn,
    });

    const watcher = new ProjectWatcher(
      {
        projectRoot: "/repo",
      },
      subscribe,
    );

    await watcher.start(() => {});
    await watcher.close();

    expect(unsubscribeFn).toHaveBeenCalledTimes(1);
  });

  it("should map create and delete events when callback receives both types", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [
      { type: "create", path: "/repo/src/new.ts" },
      { type: "delete", path: "/repo/src/old.ts" },
    ]);

    expect(events).toEqual([
      { eventType: "create", filePath: "src/new.ts" },
      { eventType: "delete", filePath: "src/old.ts" },
    ]);
  });

  it("should ignore declaration file when callback receives dts path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "update", path: "/repo/src/types.d.ts" }]);

    expect(events).toEqual([]);
  });

  it("should bypass extension filter when callback receives package json", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "update", path: "/repo/apps/web/package.json" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "apps/web/package.json" }]);
  });

  it("should ignore file when extension is not allowed and file is not config", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "update", path: "/repo/assets/logo.svg" }]);

    expect(events).toEqual([]);
  });

  it("should wrap watcher subscribe error when start fails", async () => {
    const subscribe = async (): Promise<AsyncSubscription> => {
      throw new Error("subscription failed");
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, subscribe);

    await expect(watcher.start(() => {})).rejects.toBeInstanceOf(WatcherError);
  });

  it("should log watcher callback error when callback receives error as first argument", async () => {
    const errors: Error[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (first instanceof Error) {
        errors.push(first);
      }
    });

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start(() => {});

    try {
      callback?.(new Error("watch callback failed"), []);
    } finally {
      errorSpy.mockRestore();
    }

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(WatcherError);
  });

  it("should log watcher callback error when onChange throws", async () => {
    const errors: Error[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (first instanceof Error) {
        errors.push(first);
      }
    });

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start(() => {
      throw new Error("consumer failed");
    });

    try {
      callback?.(undefined, [{ type: "update", path: "/repo/src/main.ts" }]);
    } finally {
      errorSpy.mockRestore();
    }

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(WatcherError);
  });

  it("should treat extension match as case-insensitive when configured extension is lowercase", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "update", path: "/repo/src/MAIN.TS" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "src/MAIN.TS" }]);
  });

  it("should not throw when close is called before start", async () => {
    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, async () => {
      throw new Error("should not be called");
    });

    await expect(watcher.close()).resolves.toBeUndefined();
  });

  it("should throw WatcherError when close fails to unsubscribe", async () => {
    const subscribe = async (): Promise<AsyncSubscription> => ({
      unsubscribe: async () => {
        throw new Error("unsubscribe failed");
      },
    });

    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, subscribe);
    await watcher.start(() => {});

    await expect(watcher.close()).rejects.toBeInstanceOf(WatcherError);
  });

  it("should pass tsconfig json as config file when callback receives tsconfig path", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "update", path: "/repo/tsconfig.json" }]);

    expect(events).toEqual([{ eventType: "change", filePath: "tsconfig.json" }]);
  });

  it("should ignore jsconfig json since JSX/JS config is not supported", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "update", path: "/repo/jsconfig.json" }]);

    expect(events).toEqual([]);
  });

  it("should include additional ignore patterns when ignorePatterns option is provided", async () => {
    let capturedOptions: SubscribeOptions | undefined;
    const subscribe = async (
      _path: string,
      _cb: SubscribeCallback,
      opts?: SubscribeOptions,
    ): Promise<AsyncSubscription> => {
      capturedOptions = opts;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher(
      { projectRoot: "/repo", ignorePatterns: ["**/coverage/**"] },
      subscribe,
    );
    await watcher.start(() => {});

    expect(capturedOptions?.ignore).toContain("**/coverage/**");
  });

  it("should pass mts file when default extensions are used", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo" }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [{ type: "create", path: "/repo/src/module.mts" }]);

    expect(events).toEqual([{ eventType: "create", filePath: "src/module.mts" }]);
  });

  it("should deliver batch events in order when callback receives multiple events", async () => {
    const events: Array<{ eventType: string; filePath: string }> = [];

    let callback: SubscribeCallback | undefined;
    const subscribe = async (_path: string, cb: SubscribeCallback): Promise<AsyncSubscription> => {
      callback = cb;
      return createFakeSubscription();
    };

    const watcher = new ProjectWatcher({ projectRoot: "/repo", extensions: [".ts"] }, subscribe);
    await watcher.start((event) => events.push(event));

    callback?.(undefined, [
      { type: "create", path: "/repo/src/a.ts" },
      { type: "update", path: "/repo/src/b.ts" },
      { type: "delete", path: "/repo/src/c.ts" },
    ]);

    expect(events).toEqual([
      { eventType: "create", filePath: "src/a.ts" },
      { eventType: "change", filePath: "src/b.ts" },
      { eventType: "delete", filePath: "src/c.ts" },
    ]);
  });
});