import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * No admin test reaches the network.
 *
 * `@endora-commerce/api-client`'s `createApiClient` captures the global `fetch`
 * when it is called, and the kit calls it once at module scope — so this
 * assignment has to happen before the test module graph is loaded, which is what
 * a setup file is. Every request a screen makes therefore fails here, by name,
 * instead of leaving the process.
 *
 * It was a real dependency and not a hypothetical one, found while feature 091's
 * P3 converted the permission-gating tests to drive the real `AuthProvider`:
 * `App.tsx` mounts its own `TranslationProvider` with no `initialBundle`, so
 * every `<App/>` test fetched `/api/v1/admin/i18n/bundles` for real. On a
 * developer machine with `pnpm run dev` up, that returned a genuine **401** —
 * which the real provider correctly read as an expired session and answered with
 * the login page, so the test's subject never mounted. In CI the same call is a
 * refused connection and nothing happens. A suite that behaves differently
 * depending on whether a dev server is listening is not measuring anything.
 *
 * A rejection is what CI already produced, so this makes the two agree rather
 * than inventing a third behaviour. A test that needs a response stubs its
 * collaborator — `vi.mock('@endora-commerce/admin-kit/lib', …)` replacing
 * `apiClient` is the seam every packaged screen's test uses.
 */
globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  throw new Error(
    `[admin test] unstubbed network call to ${url} — stub the collaborator this screen calls ` +
      '(see admin/test/setup.ts).',
  );
}) as typeof fetch;

// jsdom does not implement scrollIntoView; components that call it (e.g. the
// organization picker's active-option scroll) would throw under test. Polyfill
// it globally so tests don't depend on call ordering across files.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no-op in jsdom */
  };
}

// `globals: false` in the base vitest config means Testing Library's
// auto-cleanup isn't registered. Do it explicitly so each test gets a
// fresh DOM and findBy* queries don't collide with leftovers.
afterEach(() => {
  cleanup();
  setMobileViewport(false);
});

/** Default: desktop tier (min-width 1024px) for layout tests. */
let mobileViewport = false;

export function setMobileViewport(mobile: boolean): void {
  mobileViewport = mobile;
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 1024px')
        ? !mobileViewport
        : query.includes('max-width')
          ? mobileViewport
          : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
