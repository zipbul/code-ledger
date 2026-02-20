import { afterEach, describe, expect, it, spyOn, type Mock, mock } from "bun:test";
import { acquireWatcherRole, releaseWatcherRole, updateHeartbeat } from "./ownership";
import type { WatcherOwnerStore } from "./ownership";

type Row = { pid: number; heartbeat_at: string } | undefined;

function createFakeDb(initialRow?: Row): WatcherOwnerStore & {
  row: Row;
  selectOwner: Mock<() => Row>;
  insertOwner: Mock<(pid: number) => void>;
  replaceOwner: Mock<(pid: number) => void>;
  touchOwner: Mock<(pid: number) => void>;
  deleteOwner: Mock<(pid: number) => void>;
} {
  const state = { row: initialRow as Row };

  const db = {
    get row() { return state.row; },
    set row(v: Row) { state.row = v; },

    transaction: <T>(fn: () => T): T => fn(),
    immediateTransaction: <T>(fn: () => T): T => fn(),
    selectOwner: mock(() => state.row),
    insertOwner: mock((pid: number) => {
      state.row = { pid, heartbeat_at: new Date().toISOString() };
    }),
    replaceOwner: mock((pid: number) => {
      state.row = { pid, heartbeat_at: new Date().toISOString() };
    }),
    touchOwner: mock((pid: number) => {
      if (state.row?.pid === pid) {
        state.row = { pid, heartbeat_at: new Date().toISOString() };
      }
    }),
    deleteOwner: mock((pid: number) => {
      if (state.row?.pid === pid) {
        state.row = undefined;
      }
    }),
  };

  return db;
}

describe("acquireWatcherRole", () => {
  it("should return owner when owner row does not exist", () => {
    const db = createFakeDb();

    const role = acquireWatcherRole(db, 100, {
      now: () => 0,
      isAlive: () => false,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.insertOwner).toHaveBeenCalledTimes(1);
  });

  it("should return reader when existing owner is alive and heartbeat is fresh", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("reader");
    expect(db.row?.pid).toBe(7);
    expect(db.replaceOwner).not.toHaveBeenCalled();
  });

  it("should return owner when existing owner is stale", () => {
    const old = new Date(Date.now() - 200_000).toISOString();
    const db = createFakeDb({ pid: 7, heartbeat_at: old });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.replaceOwner).toHaveBeenCalledTimes(1);
  });

  it("should return owner when existing owner process is dead", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => false,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.replaceOwner).toHaveBeenCalledTimes(1);
  });

  it("should return owner when heartbeat age is exactly stale threshold", () => {
    const now = Date.now();
    const exactBoundary = new Date(now - 90_000).toISOString();
    const db = createFakeDb({ pid: 7, heartbeat_at: exactBoundary });

    const role = acquireWatcherRole(db, 100, {
      now: () => now,
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.replaceOwner).toHaveBeenCalledTimes(1);
  });

  it("should return owner when process is missing and default isAlive receives ESRCH", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(killSpy).toHaveBeenCalledWith(7, 0);
    killSpy.mockRestore();
  });

  it("should return reader when process exists but kill check throws EPERM", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      staleAfterSeconds: 90,
    });

    expect(role).toBe("reader");
    expect(db.row?.pid).toBe(7);
    killSpy.mockRestore();
  });

  it("should return reader when kill check throws error without code", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw { reason: "unknown" };
    });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      staleAfterSeconds: 90,
    });

    expect(role).toBe("reader");
    expect(db.row?.pid).toBe(7);
    killSpy.mockRestore();
  });

  it("should return owner when heartbeat string is invalid", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: "not-a-date" });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.replaceOwner).toHaveBeenCalledTimes(1);
  });

  it("should return owner when stale threshold is zero", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 0,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.replaceOwner).toHaveBeenCalledTimes(1);
  });

  it("should keep returning reader when acquired repeatedly against same live owner", () => {
    const now = Date.now();
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date(now).toISOString() });

    const first = acquireWatcherRole(db, 100, {
      now: () => now,
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    const second = acquireWatcherRole(db, 100, {
      now: () => now + 1_000,
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    expect(first).toBe("reader");
    expect(second).toBe("reader");
    expect(db.row?.pid).toBe(7);
    expect(db.replaceOwner).not.toHaveBeenCalled();
  });

  it("should re-acquire owner role after previous owner releases", () => {
    const db = createFakeDb({ pid: 7, heartbeat_at: new Date().toISOString() });

    releaseWatcherRole(db, 7);

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    expect(role).toBe("owner");
    expect(db.row?.pid).toBe(100);
    expect(db.insertOwner).toHaveBeenCalled();
  });

  it("should use default staleAfterSeconds of 90 when options are omitted", () => {
    const freshHeartbeat = new Date(Date.now() - 89_000).toISOString();
    const db = createFakeDb({ pid: 7, heartbeat_at: freshHeartbeat });

    const role = acquireWatcherRole(db, 100, {
      now: () => Date.now(),
      isAlive: () => true,
    });

    expect(role).toBe("reader");
  });

  // ── C-1: immediateTransaction 사용 검증 ────────────────────────────────────

  // [HP] acquireWatcherRole은 transaction이 아닌 immediateTransaction을 사용해야 한다
  it("should use immediateTransaction instead of transaction when acquiring watcher role", () => {
    let immediateTransactionCalled = false;
    const db = {
      ...createFakeDb(),
      immediateTransaction: <T>(fn: () => T): T => {
        immediateTransactionCalled = true;
        return fn();
      },
    } as any;

    acquireWatcherRole(db, 100, { now: () => 0, isAlive: () => false, staleAfterSeconds: 90 });

    expect(immediateTransactionCalled).toBe(true);
  });
});

describe("releaseWatcherRole", () => {
  it("should remove row when current pid is owner", () => {
    const db = createFakeDb({ pid: 123, heartbeat_at: new Date().toISOString() });

    releaseWatcherRole(db, 123);

    expect(db.row).toBeUndefined();
    expect(db.deleteOwner).toHaveBeenCalledTimes(1);
    expect(db.deleteOwner).toHaveBeenCalledWith(123);
  });

  it("should keep row when pid does not match current owner", () => {
    const db = createFakeDb({ pid: 123, heartbeat_at: new Date().toISOString() });

    releaseWatcherRole(db, 999);

    expect(db.row?.pid).toBe(123);
    expect(db.deleteOwner).toHaveBeenCalledTimes(1);
    expect(db.deleteOwner).toHaveBeenCalledWith(999);
  });
});

describe("updateHeartbeat", () => {
  it("should update timestamp when current pid is owner", () => {
    const db = createFakeDb({ pid: 123, heartbeat_at: new Date(0).toISOString() });

    updateHeartbeat(db, 123);

    expect(db.touchOwner).toHaveBeenCalledTimes(1);
    expect(db.touchOwner).toHaveBeenCalledWith(123);
    expect(db.row?.pid).toBe(123);
  });

  it("should not update when pid does not match current owner", () => {
    const originalHeartbeat = new Date(0).toISOString();
    const db = createFakeDb({ pid: 123, heartbeat_at: originalHeartbeat });

    updateHeartbeat(db, 999);

    expect(db.touchOwner).toHaveBeenCalledTimes(1);
    expect(db.touchOwner).toHaveBeenCalledWith(999);
    expect(db.row?.heartbeat_at).toBe(originalHeartbeat);
  });
});

describe("updateHeartbeat", () => {
  it("should increment touchOwner call when heartbeat is called immediately after acquire", () => {
    const db = createFakeDb();

    acquireWatcherRole(db, 42, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    updateHeartbeat(db, 42);

    expect(db.touchOwner).toHaveBeenCalledTimes(1);
  });
});

describe("releaseWatcherRole", () => {
  it("should clear row when release is called after acquire and heartbeat", () => {
    const db = createFakeDb();

    acquireWatcherRole(db, 42, {
      now: () => Date.now(),
      isAlive: () => true,
      staleAfterSeconds: 90,
    });

    updateHeartbeat(db, 42);
    releaseWatcherRole(db, 42);

    expect(db.row).toBeUndefined();
    expect(db.deleteOwner).toHaveBeenCalledTimes(1);
  });
});