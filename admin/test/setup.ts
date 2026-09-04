import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * The budget a DOM assertion gets before it gives up, declared rather than
 * defaulted.
 *
 * Testing Library's `asyncUtilTimeout` default is **1000 ms**, and every
 * `waitFor` and `findBy*` in this suite silently inherits it. That number is a
 * developer's-idle-laptop default, and this suite is neither idle nor a laptop:
 * it runs 149 files across a fork per core, beside whatever else the host is
 * doing — on CI, a shared runner that also carries another project's test
 * server (see AGENTS.md § *Which backend test command to use*).
 *
 * Measured, on a 16-core host, one full admin run with the backend fast unit
 * suite and 16 spinners for company: 137 async waits took 150 ms or more,
 * **five of them took longer than 1000 ms**, and the slowest took **2062 ms**.
 * Every one of them resolved. So the failures this removes were never a race
 * and never a hang — they were assertions whose wall-clock budget expired while
 * the process was descheduled, and the file that lost the coin toss differed
 * from run to run, which is why each of them passed in isolation.
 *
 * Two things this is deliberately not.
 *
 * It is **not hiding a slow product path**. Several of these waits are not
 * waiting for application state at all: a module screen reaches the DOM through
 * `React.lazy`, so the wait covers vite-node transforming that screen's module
 * graph on demand — a cost of the test runner that does not exist in the
 * browser, and one with no bounded size.
 *
 * And it is **not a delay**. The budget is a ceiling, not a sleep: a passing
 * assertion resolves the moment its element appears and costs exactly what it
 * costs. The whole price of raising it is paid by an assertion that is already
 * failing, once, and it stays far below `testTimeout` (30 s) so a genuinely
 * dead assertion still fails with Testing Library's own diagnostic — the text
 * it looked for, and the DOM it looked in — rather than with vitest's bare
 * "test timed out", which names nothing.
 *
 * If this stops being enough, re-measure before raising it: a wait that needs
 * more than a few seconds on a loaded host is a different finding from the one
 * this number answers.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * No admin test reaches the network.
 *
 * `@endora-commerce/admin-kit/lib`'s `createApiClient` captures the global
 * `fetch` when it is called, and the kit calls it once at module scope — so this
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

/**
 * jsdom implements no `ResizeObserver`, and the admin's charting primitive keeps
 * its chart sized to its container with one.
 *
 * A test that renders a screen carrying an `<EChart>` therefore died inside
 * `useEffect` with `ReferenceError: ResizeObserver is not defined`, which React
 * reports by unmounting the tree — an empty `<body>` and a Testing Library error
 * naming the text it could not find, which says nothing about the cause. It was
 * invisible while every such screen was the admin's own, because those tests
 * stub `@/components/charts/echart`; a screen that reaches the kit's chart
 * through the kit's own internals is past that seam, and mocking a path inside
 * another package's `dist` is not a seam anybody should be asked to name.
 *
 * The stub observes nothing on purpose. Under jsdom every element measures
 * zero, so a real observer would report one resize to zero and nothing after —
 * the callback has nothing true to say, and a test that depended on it would be
 * asserting jsdom's layout rather than the product's.
 */
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class ResizeObserver {
    observe(): void {
      /* jsdom lays nothing out; there is no size change to report */
    }
    unobserve(): void {
      /* the same, in reverse */
    }
    disconnect(): void {
      /* nothing was ever observed */
    }
  };
}

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
