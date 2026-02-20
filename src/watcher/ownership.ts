import type { WatcherRole } from "./types";

interface WatcherOwnerRow {
  pid: number;
  heartbeat_at: string;
}

export interface WatcherOwnerStore {
  immediateTransaction<T>(fn: () => T): T;
  selectOwner(): WatcherOwnerRow | undefined;
  insertOwner(pid: number): void;
  replaceOwner(pid: number): void;
  touchOwner(pid: number): void;
  deleteOwner(pid: number): void;
}

interface AcquireOptions {
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  staleAfterSeconds?: number;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error) {
      return (error as { code?: string }).code !== "ESRCH";
    }

    return true;
  }
}

function toEpochMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function acquireWatcherRole(
  db: WatcherOwnerStore,
  pid: number,
  options: AcquireOptions = {},
): WatcherRole {
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const staleAfterSeconds = options.staleAfterSeconds ?? 90;

  return db.immediateTransaction(() => {
    const owner = db.selectOwner();
    if (!owner) {
      db.insertOwner(pid);
      return "owner";
    }

    const heartbeatAgeSeconds = Math.floor((now() - toEpochMs(owner.heartbeat_at)) / 1000);
    if (isAlive(owner.pid) && heartbeatAgeSeconds < staleAfterSeconds) {
      return "reader";
    }

    db.replaceOwner(pid);
    return "owner";
  });
}

export function releaseWatcherRole(db: WatcherOwnerStore, pid: number): void {
  db.deleteOwner(pid);
}

export function updateHeartbeat(db: WatcherOwnerStore, pid: number): void {
  db.touchOwner(pid);
}