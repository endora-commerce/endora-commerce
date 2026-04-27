'use client';

/**
 * Product-comparison local store (T239 / FR-006).
 *
 * State is a list of product slugs persisted to `localStorage`. The
 * intentionally tiny event bus lets multiple components on the same page
 * stay in sync without a state-management library (Constitution Principle
 * IV — minimal dependencies).
 */

const STORAGE_KEY = 'b2b.compare.slugs.v1';
const MAX_ITEMS = 4;
const EVENT_NAME = 'b2b:compare:changed';

export function readCompareSlugs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function writeCompareSlugs(slugs: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs.slice(0, MAX_ITEMS)));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function toggleCompare(slug: string): { added: boolean; size: number } {
  const current = readCompareSlugs();
  const exists = current.includes(slug);
  let next: string[];
  if (exists) {
    next = current.filter((s) => s !== slug);
  } else {
    if (current.length >= MAX_ITEMS) {
      // Replace the oldest entry to keep the list bounded.
      next = [...current.slice(1), slug];
    } else {
      next = [...current, slug];
    }
  }
  writeCompareSlugs(next);
  return { added: !exists, size: next.length };
}

export function clearCompare(): void {
  writeCompareSlugs([]);
}

export function subscribeCompare(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = (): void => handler();
  window.addEventListener(EVENT_NAME, onChange);
  // Cross-tab sync — `storage` events fire on other tabs when localStorage changes.
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) handler();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export const COMPARE_MAX_ITEMS = MAX_ITEMS;
