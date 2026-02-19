import type {
  AsyncSubscription,
  FileEvent,
  SubscribeCallback,
  SubscribeOptions,
} from "@parcel/watcher";
import { subscribe as parcelSubscribe } from "@parcel/watcher";
import path from "node:path";
import { WatcherError } from "../errors";
import type { FileChangeEvent, FileChangeEventType, WatcherOptions } from "./types";

type SubscribeFn = (
  directoryPath: string,
  callback: SubscribeCallback,
  options?: SubscribeOptions,
) => Promise<AsyncSubscription>;

const WATCHER_IGNORE_GLOBS: readonly string[] = [
  "**/.git/**",
  "**/.zipbul/**",
  "**/dist/**",
  "**/node_modules/**",
];

const CONFIG_FILE_NAMES = new Set(["package.json", "tsconfig.json"]);

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function mapEventType(type: FileEvent["type"]): FileChangeEventType {
  if (type === "update") {
    return "change";
  }

  if (type === "create") {
    return "create";
  }

  return "delete";
}

export class ProjectWatcher {
  #subscription: AsyncSubscription | undefined;
  #rootPath: string;
  #ignoreGlobs: string[];
  #extensions: Set<string>;
  #subscribe: SubscribeFn;

  constructor(options: WatcherOptions, subscribeFn: SubscribeFn = parcelSubscribe) {
    this.#rootPath = options.projectRoot;
    this.#ignoreGlobs = [...WATCHER_IGNORE_GLOBS, ...(options.ignorePatterns ?? [])];
    this.#extensions = new Set(
      (options.extensions ?? [".ts", ".mts", ".cts"]).map((ext) =>
        ext.toLowerCase(),
      ),
    );
    this.#subscribe = subscribeFn;
  }

  async start(onChange: (event: FileChangeEvent) => void): Promise<void> {
    try {
      this.#subscription = await this.#subscribe(
        this.#rootPath,
        (error, events) => {
          if (error) {
            console.error(new WatcherError("Callback error", { cause: error }));
            return;
          }

          try {
            for (const rawEvent of events) {
              const relativePath = normalizePath(path.relative(this.#rootPath, rawEvent.path));

              if (relativePath.startsWith("..")) {
                continue;
              }

              const baseName = path.basename(relativePath);
              const extension = path.extname(relativePath).toLowerCase();
              const isConfigFile = CONFIG_FILE_NAMES.has(baseName);

              if (!isConfigFile && !this.#extensions.has(extension)) {
                continue;
              }

              if (relativePath.endsWith(".d.ts")) {
                continue;
              }

              onChange({
                eventType: mapEventType(rawEvent.type),
                filePath: relativePath,
              });
            }
          } catch (callbackError) {
            console.error(new WatcherError("Callback error", { cause: callbackError }));
          }
        },
        {
          ignore: this.#ignoreGlobs,
        },
      );
    } catch (error) {
      throw new WatcherError("Failed to subscribe watcher", { cause: error });
    }
  }

  async close(): Promise<void> {
    if (!this.#subscription) {
      return;
    }

    try {
      await this.#subscription.unsubscribe();
      this.#subscription = undefined;
    } catch (error) {
      throw new WatcherError("Failed to close watcher", { cause: error });
    }
  }
}