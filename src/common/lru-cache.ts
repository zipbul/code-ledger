export class LruCache<K, V> {
  #capacity: number;
  #map = new Map<K, V>();

  constructor(capacity: number) {
    this.#capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.#map.size;
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  get(key: K): V | undefined {
    if (!this.#map.has(key)) {
      return undefined;
    }
    const value = this.#map.get(key)!;
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.#map.has(key)) {
      this.#map.delete(key);
    }

    this.#map.set(key, value);

    if (this.#map.size > this.#capacity) {
      const oldestKey = this.#map.keys().next().value as K | undefined;
      if (oldestKey !== undefined) {
        this.#map.delete(oldestKey);
      }
    }
  }

  delete(key: K): boolean {
    return this.#map.delete(key);
  }

  clear(): void {
    this.#map.clear();
  }
}