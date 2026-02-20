import { describe, expect, it } from "bun:test";
import { LruCache } from "./lru-cache";

describe("LruCache", () => {
  it("should return false from has when key does not exist", () => {
    const sut = new LruCache<string, number>(2);

    expect(sut.has("missing")).toBe(false);
  });

  it("should return undefined when key does not exist", () => {
    const sut = new LruCache<string, number>(2);

    expect(sut.get("missing")).toBeUndefined();
  });

  it("should evict least recently used entry when capacity is exceeded", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.set("c", 3);

    expect(sut.get("a")).toBeUndefined();
    expect(sut.get("b")).toBe(2);
    expect(sut.get("c")).toBe(3);
  });

  it("should move key to most recent when key is read", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    expect(sut.get("a")).toBe(1);
    sut.set("c", 3);

    expect(sut.get("a")).toBe(1);
    expect(sut.get("b")).toBeUndefined();
  });

  it("should delete a key when delete is called", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    const removed = sut.delete("a");

    expect(removed).toBe(true);
    expect(sut.has("a")).toBe(false);
  });

  it("should clear all entries when clear is called", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.clear();

    expect(sut.size).toBe(0);
  });

  it("should keep size when existing key is overwritten", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("a", 2);

    expect(sut.size).toBe(1);
    expect(sut.get("a")).toBe(2);
  });

  it("should keep only latest key when capacity is one", () => {
    const sut = new LruCache<string, number>(1);

    sut.set("a", 1);
    sut.set("b", 2);

    expect(sut.get("a")).toBeUndefined();
    expect(sut.get("b")).toBe(2);
  });

  it("should return false when delete is called on non-existent key", () => {
    const sut = new LruCache<string, number>(2);

    expect(sut.delete("missing")).toBe(false);
  });

  it("should treat capacity zero as one when constructed with zero", () => {
    const sut = new LruCache<string, number>(0);

    sut.set("a", 1);
    sut.set("b", 2);

    expect(sut.get("a")).toBeUndefined();
    expect(sut.get("b")).toBe(2);
    expect(sut.size).toBe(1);
  });

  it("should treat negative capacity as one when constructed with negative value", () => {
    const sut = new LruCache<string, number>(-5);

    sut.set("a", 1);
    sut.set("b", 2);

    expect(sut.get("a")).toBeUndefined();
    expect(sut.size).toBe(1);
  });

  it("should return zero value when zero is stored and retrieved", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("zero", 0);

    expect(sut.get("zero")).toBe(0);
  });

  it("should return false value when false is stored and retrieved", () => {
    const sut = new LruCache<string, boolean>(2);

    sut.set("flag", false);

    expect(sut.get("flag")).toBe(false);
  });

  it("should not evict when capacity is exactly filled", () => {
    const sut = new LruCache<string, number>(3);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.set("c", 3);

    expect(sut.size).toBe(3);
    expect(sut.get("a")).toBe(1);
    expect(sut.get("b")).toBe(2);
    expect(sut.get("c")).toBe(3);
  });

  it("should allow addition without eviction when delete creates room below capacity", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.delete("a");
    sut.set("c", 3);

    expect(sut.get("b")).toBe(2);
    expect(sut.get("c")).toBe(3);
    expect(sut.size).toBe(2);
  });

  it("should evict oldest entry and keep overwritten key when overwrite precedes capacity overflow", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.set("a", 10);
    sut.set("c", 3);

    expect(sut.get("a")).toBe(10);
    expect(sut.get("b")).toBeUndefined();
    expect(sut.get("c")).toBe(3);
  });

  it("should restore evicted key when re-inserted after eviction", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.set("c", 3);
    sut.set("a", 99);

    expect(sut.get("a")).toBe(99);
  });

  it("should work correctly when reused after clear", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.clear();

    sut.set("c", 3);

    expect(sut.size).toBe(1);
    expect(sut.get("c")).toBe(3);
    expect(sut.get("a")).toBeUndefined();
  });

  it("should return same value on repeated get calls", () => {
    const sut = new LruCache<string, number>(3);

    sut.set("a", 42);

    expect(sut.get("a")).toBe(42);
    expect(sut.get("a")).toBe(42);
  });

  it("should return false on repeated delete of non-existent key", () => {
    const sut = new LruCache<string, number>(2);

    expect(sut.delete("x")).toBe(false);
    expect(sut.delete("x")).toBe(false);
  });

  it("should evict b when a is accessed before c is inserted", () => {
    const sut = new LruCache<string, number>(2);

    sut.set("a", 1);
    sut.set("b", 2);
    sut.get("a");
    sut.set("c", 3);

    expect(sut.get("a")).toBe(1);
    expect(sut.get("b")).toBeUndefined();
    expect(sut.get("c")).toBe(3);
  });

  it("should evict different key depending on insertion order", () => {
    const sutAB = new LruCache<string, number>(2);
    sutAB.set("a", 1);
    sutAB.set("b", 2);
    sutAB.set("c", 3);

    const sutBA = new LruCache<string, number>(2);
    sutBA.set("b", 2);
    sutBA.set("a", 1);
    sutBA.set("c", 3);

    expect(sutAB.get("a")).toBeUndefined();
    expect(sutBA.get("b")).toBeUndefined();
  });

  // ── L-2: undefined 저장값 LRU 순서 갱신 ──────────────────────────────────

  // [ED] undefined 저장 키를 get 하면 LRU 순서가 갱신된다
  it('should update LRU order when a key storing undefined is accessed via get', () => {
    const sut = new LruCache<string, number | undefined>(2);
    sut.set('a', undefined);
    sut.set('b', 1);
    sut.get('a'); // 'a'를 MRU로 이동시켜야 함
    sut.set('c', 2); // 'a'가 아닌 'b'를 evict해야 함
    expect(sut.has('a')).toBe(true);
    expect(sut.has('b')).toBe(false);
  });

  // [ED] null을 저장한 키를 get하면 null을 반환한다 (undefined 아님)
  it('should return null as a cache hit when null is the stored value', () => {
    const sut = new LruCache<string, null | number>(1);
    sut.set('k', null);
    expect(sut.get('k')).toBeNull();
  });
});