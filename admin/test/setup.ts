import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { installMemoryStorage } from './helpers/memory-storage';

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
 *
 * **One request is answered here, and only one** (issue #463): the i18n bundle
 * the shell's own `TranslationProvider` asks for on boot. It goes through the
 * kit's internal client, which a test's `vi.mock` of the kit's public `lib`
 * barrel does not replace, so no test file could stub it through its usual
 * seam — every file mounting `<App/>` or the shell logged
 * `[i18n] bundle fetch failed … unstubbed network call` and depended on the
 * refusal being harmless. The answer is an empty bundle, which is what the
 * provider held while the refusal left it unanswered, so every screen renders
 * exactly as it did; a test that wants real copy hands the provider an
 * `initialBundle` (`renderWithI18n`), and a test about a *failing* bundle fetch
 * replaces `globalThis.fetch` itself.
 */
const I18N_BUNDLES_PATH = '/api/v1/admin/i18n/bundles';

globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname === I18N_BUNDLES_PATH) {
    const language = parsed.searchParams.get('language') ?? 'en';
    return new Response(JSON.stringify({ data: { language, version: 0, bundles: {} } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
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

/**
 * Every test gets its own empty, in-memory `localStorage` and `sessionStorage`
 * (issue #442).
 *
 * jsdom's own storage cannot be relied on to reach the global: from Node 25 the
 * runtime defines `localStorage` and `sessionStorage` itself, and vitest's jsdom
 * environment copies a window key onto the global only when the global lacks it.
 * Node's then wins — `undefined` on Node 26 without `--localstorage-file`, so
 * every test calling `window.localStorage.clear()` failed with a `TypeError`.
 * Installing our own storage in the setup file makes the suite independent of
 * the Node major, and installing a fresh one per test means nothing a test
 * stored, or a storage a test swapped in, leaks into the next.
 *
 * Installed once at load as well, so a module that touches storage while the
 * test file is being imported finds a working one.
 */
const STORAGE_NAMES = ['localStorage', 'sessionStorage'] as const;
const installStorages = (): void => {
  for (const name of STORAGE_NAMES) installMemoryStorage(globalThis, name);
};
installStorages();
beforeEach(installStorages);

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
  if (document.querySelector('[class*="_Puck_"]')) puckMountedInThisFile = true;
  cleanup();
  setMobileViewport(false);
});

/**
 * Puck 0.23 starts a 500 ms timer when its canvas mounts
 * (`setTimeout(() => setShowLoader(true), 500)` in `@puckeditor/core`'s
 * `dist/chunk-55V3NZVF.mjs`) and never clears it on unmount. Unmounting is
 * harmless while the file's jsdom is alive — React drops the update — but a
 * file whose last mount is under 500 ms before the end lets the timer fire
 * after jsdom has been torn down, and React's `dispatchSetState` then reads
 * `window` and throws `ReferenceError: window is not defined`. Vitest reports
 * it as an unhandled error and fails the run with every test green — PR #478's
 * `test:frontend`, blamed on `test/modules/cms/section-presets.test.tsx`.
 *
 * So a file that mounted Puck outlives that timer before its environment goes:
 * one wait per such file, none for any other.
 */
const PUCK_LOADER_TIMER_MS = 500;
let puckMountedInThisFile = false;

afterAll(async () => {
  if (!puckMountedInThisFile) return;
  await new Promise((settle) => setTimeout(settle, PUCK_LOADER_TIMER_MS + 100));
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

/**
 * jsdom lays nothing out, and ProseMirror — the editor under the CRM's
 * formatted fields (`specs/158-crm-opportunity-inline-editing/`) — asks the
 * layout where the caret is after every keystroke it reads. These answer "at
 * the origin, with no size", which is what a DOM without layout means; a
 * screen that positions something by them falls back as it would in a browser
 * that could not say.
 */
const emptyRect = (): DOMRect =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
const emptyRects = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (typeof document !== 'undefined') {
  document.elementFromPoint ??= (() => null) as typeof document.elementFromPoint;
  Range.prototype.getClientRects ??= emptyRects;
  Range.prototype.getBoundingClientRect ??= emptyRect;
  const text = Text.prototype as unknown as { getClientRects?: () => DOMRectList };
  text.getClientRects ??= emptyRects;
}
