/**
 * Makes `window.matchMedia` answer `min-width` / `max-width` queries as a
 * viewport of the given width would.
 *
 * The suite's default stub knows two tiers only (mobile and desktop at
 * 1024px), which is no answer for a component that asks about a wider
 * breakpoint. Call this in `beforeEach`, after the global setup has run.
 */
export function withViewportWidth(width: number): void {
  const matches = (query: string): boolean => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    if (min && width < Number(min[1])) return false;
    if (max && width > Number(max[1])) return false;
    return Boolean(min || max);
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: matches(query),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}
