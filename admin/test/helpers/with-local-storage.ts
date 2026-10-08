/**
 * Installs an in-memory `localStorage` on `window` and returns it.
 *
 * jsdom is configured in this suite without one, so a component that persists
 * a preference degrades to its default under test — the right behaviour for a
 * browser that refuses storage, and no proof at all that the preference is
 * written or read. A test about persistence supplies the API; call this in
 * `beforeEach` for a store that starts empty.
 */
export function withLocalStorage(): Storage {
  const store = new Map<string, string>();
  const api: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null => [...store.keys()][index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, 'localStorage', { value: api, configurable: true });
  return api;
}
