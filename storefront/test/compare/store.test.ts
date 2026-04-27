import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPARE_MAX_ITEMS,
  clearCompare,
  readCompareSlugs,
  subscribeCompare,
  toggleCompare,
} from '../../lib/compare/store';

/**
 * T239 / FR-006 — comparison store contract.
 *
 * Pure-DOM tests with a stubbed `localStorage` + `window` so we can run
 * under vitest's node environment without jsdom.
 */

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
}

class FakeWindow {
  localStorage = new FakeStorage();
  private listeners = new Map<string, Set<EventListener>>();
  addEventListener(name: string, fn: EventListener): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: EventListener): void {
    this.listeners.get(name)?.delete(fn);
  }
  dispatchEvent(event: Event): boolean {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
    return true;
  }
}

let fakeWindow: FakeWindow;

beforeEach(() => {
  fakeWindow = new FakeWindow();
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('localStorage', fakeWindow.localStorage);
  vi.stubGlobal('CustomEvent', class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('compare store', () => {
  it('starts empty', () => {
    expect(readCompareSlugs()).toEqual([]);
  });

  it('toggleCompare adds and removes', () => {
    expect(toggleCompare('alpha')).toEqual({ added: true, size: 1 });
    expect(readCompareSlugs()).toEqual(['alpha']);
    expect(toggleCompare('beta')).toEqual({ added: true, size: 2 });
    expect(readCompareSlugs()).toEqual(['alpha', 'beta']);
    expect(toggleCompare('alpha')).toEqual({ added: false, size: 1 });
    expect(readCompareSlugs()).toEqual(['beta']);
  });

  it('caps the list at MAX_ITEMS by dropping the oldest', () => {
    for (let i = 0; i < COMPARE_MAX_ITEMS + 2; i++) {
      toggleCompare(`p-${i}`);
    }
    const slugs = readCompareSlugs();
    expect(slugs).toHaveLength(COMPARE_MAX_ITEMS);
    expect(slugs.includes('p-0')).toBe(false);
    expect(slugs.includes(`p-${COMPARE_MAX_ITEMS + 1}`)).toBe(true);
  });

  it('clearCompare empties the store', () => {
    toggleCompare('alpha');
    toggleCompare('beta');
    clearCompare();
    expect(readCompareSlugs()).toEqual([]);
  });

  it('subscribeCompare fires on every mutation', () => {
    const handler = vi.fn();
    const unsub = subscribeCompare(handler);
    toggleCompare('alpha');
    toggleCompare('beta');
    clearCompare();
    expect(handler).toHaveBeenCalledTimes(3);
    unsub();
    toggleCompare('gamma');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('returns [] for malformed JSON in storage', () => {
    fakeWindow.localStorage.setItem('b2b.compare.slugs.v1', 'not-json');
    expect(readCompareSlugs()).toEqual([]);
  });
});
