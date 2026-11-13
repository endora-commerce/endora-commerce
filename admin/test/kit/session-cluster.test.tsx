import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState, type ReactElement, type ReactNode } from 'react';
import { ADMIN_PREFERENCES_DEFAULTS } from '@endora-commerce/contracts';
import {
  apiClient,
  AuthProvider,
  ModulePresenceProvider,
  useAuth,
  useModulePresence,
  usePageSizePreference,
  useSurfaceVisibility,
  type AdminMe,
  type PageSizeOption,
} from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence } from '../helpers/render-with-session';

/**
 * The session cluster's own contract, as `@endora-commerce/admin-kit/lib`
 * publishes it (feature 091, P3).
 *
 * Everything here used to be reachable only through `@/lib/…`, so a packaged
 * module could not call it and every test that wanted to vary it replaced the
 * module instead. This file asserts the two things a consumer now depends on and
 * that no other file states directly: **`initial` seeds a provider without a
 * request**, and **`useSurfaceVisibility` is the conjunction of the two axes**.
 *
 * The no-request half is asserted rather than assumed because it is the seam the
 * 36 converted test files rest on. `admin/test/setup.ts` makes any escaping
 * `fetch` throw by name, so a provider that fetched here would fail loudly
 * instead of quietly answering `unauthenticated` — which is the shape of the
 * defect P3 found on a developer machine with `pnpm run dev` running.
 */

const SESSION: AdminMe = adminSession({ permissions: ['taxes:read'] });

function Wrap({ children }: { children: ReactNode }): ReactElement {
  return (
    <AuthProvider initial={SESSION}>
      <ModulePresenceProvider initial={modulePresence({ present: ['taxes'], absent: ['ksef'] })}>
        {children}
      </ModulePresenceProvider>
    </AuthProvider>
  );
}

describe('AuthProvider — seeded by `initial`', () => {
  it('is authenticated on the very first render, with no request', () => {
    function Probe(): ReactElement {
      const { status, me } = useAuth();
      return <span data-testid="status">{`${status}:${me?.adminUser.email ?? '-'}`}</span>;
    }
    // `renderToString` is one pass with no effects at all: if the provider
    // needed its boot fetch to reach `authenticated`, this is the render that
    // would still say `loading`.
    const html = renderToString(
      <AuthProvider initial={SESSION}>
        <Probe />
      </AuthProvider>,
    );
    expect(html).toContain('authenticated:admin@test.com');
  });

  it('answers hasPermission from the seeded codes, wildcard included', () => {
    const answers: string[] = [];
    function Probe(): ReactElement {
      const { hasPermission } = useAuth();
      answers.push(`taxes:read=${hasPermission('taxes:read')}`);
      answers.push(`taxes:write=${hasPermission('taxes:write')}`);
      return <span />;
    }
    render(
      <AuthProvider initial={SESSION}>
        <Probe />
      </AuthProvider>,
    );
    expect(answers).toContain('taxes:read=true');
    expect(answers).toContain('taxes:write=false');

    answers.length = 0;
    render(
      <AuthProvider initial={adminSession({ permissions: ['*'] })}>
        <Probe />
      </AuthProvider>,
    );
    expect(answers).toContain('taxes:write=true');
  });

  /**
   * Issue #458 — the any-of, written once in the kit so a module never spells it
   * `codes.some((code) => hasPermission(code))`: that form hides its codes from
   * the permission inventory, which reads only a literal argument.
   */
  it('answers hasAnyPermission true when any one code is held, false for none or an empty list', () => {
    const answers: string[] = [];
    function Probe(): ReactElement {
      const { hasAnyPermission } = useAuth();
      answers.push(`one-held=${hasAnyPermission(['taxes:write', 'taxes:read'])}`);
      answers.push(`none-held=${hasAnyPermission(['taxes:write', 'orders:read'])}`);
      answers.push(`empty=${hasAnyPermission([])}`);
      return <span />;
    }
    render(
      <AuthProvider initial={SESSION}>
        <Probe />
      </AuthProvider>,
    );
    expect(answers).toContain('one-held=true');
    expect(answers).toContain('none-held=false');
    expect(answers).toContain('empty=false');

    answers.length = 0;
    render(
      <AuthProvider initial={adminSession({ permissions: ['*'] })}>
        <Probe />
      </AuthProvider>,
    );
    expect(answers).toContain('none-held=true');
    expect(answers).toContain('empty=false');
  });
});

describe('ModulePresenceProvider — seeded by `initial`', () => {
  it('answers false for a module the projection does not list', () => {
    const answers: string[] = [];
    function Probe(): ReactElement {
      const { isPresent, isLoading } = useModulePresence();
      answers.push(`loading=${isLoading}`, `taxes=${isPresent('taxes')}`, `ksef=${isPresent('ksef')}`);
      answers.push(`never-heard-of=${isPresent('not_a_module')}`);
      return <span />;
    }
    render(<Wrap><Probe /></Wrap>);
    expect(answers).toEqual([
      'loading=false',
      'taxes=true',
      'ksef=false',
      // The fail-closed rule (feature 073), and the reason a seeded projection
      // has to name every id its subject asks about.
      'never-heard-of=false',
    ]);
  });
});

describe('useSurfaceVisibility — the conjunction, over the real providers', () => {
  function Surfaces(): ReactElement {
    const isVisible = useSurfaceVisibility();
    return (
      <ul>
        {isVisible({ module: 'taxes', requiredPermission: 'taxes:read' }) && <li>held-and-present</li>}
        {isVisible({ module: 'taxes', requiredPermission: 'taxes:write' }) && <li>not-held</li>}
        {isVisible({ module: 'ksef', requiredPermission: 'taxes:read' }) && <li>module-off</li>}
        {isVisible({ module: null, requiredPermission: 'taxes:read' }) && <li>no-module</li>}
        {isVisible({ module: 'taxes' }) && <li>no-permission-required</li>}
        {isVisible({ module: 'taxes', requiredPermission: ['nope:read', 'taxes:read'] }) && (
          <li>any-of</li>
        )}
      </ul>
    );
  }

  it('hides on either axis and shows only on both', () => {
    render(<Wrap><Surfaces /></Wrap>);
    expect(screen.queryByText('held-and-present')).not.toBeNull();
    expect(screen.queryByText('not-held')).toBeNull();
    expect(screen.queryByText('module-off')).toBeNull();
    expect(screen.queryByText('no-module')).not.toBeNull();
    expect(screen.queryByText('no-permission-required')).not.toBeNull();
    expect(screen.queryByText('any-of')).not.toBeNull();
  });
});

/**
 * A `localStorage` whose writes the page-size cases can read back. Feature 164
 * moved the page size to the server, so the assertion it serves is now the
 * opposite of what it was: **nothing** is written to browser storage (FR-010).
 */
function withLocalStorage(): Storage {
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

const PREFS_URL = '/api/v1/admin/me/preferences';

function sessionWithSizes(listPageSizes: Record<string, number> | undefined, id = 'admin-one'): AdminMe {
  const me = adminSession({ permissions: [], id });
  return listPageSizes === undefined
    ? me
    : { ...me, preferences: { ...ADMIN_PREFERENCES_DEFAULTS, listPageSizes } };
}

/**
 * Feature 164, US3 — the page size is the signed-in admin's, kept on the
 * server per list (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §3).
 * Read once at mount; written as that one list; never resizes an open list.
 */
describe('usePageSizePreference — the signed-in admin\'s, per list, on the server', () => {
  let patchSpy: ReturnType<typeof vi.spyOn>;
  let setSize: (next: PageSizeOption) => void = () => undefined;

  function Probe({ scope, testId = 'size' }: { scope: string; testId?: string }): ReactElement {
    const { pageSize, setPageSize } = usePageSizePreference(scope);
    if (testId === 'size') setSize = setPageSize;
    return <span data-testid={testId}>{String(pageSize)}</span>;
  }

  beforeEach(() => {
    withLocalStorage();
    patchSpy = vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
      data: { ...ADMIN_PREFERENCES_DEFAULTS, ...(body as object) },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reads the list\'s size from the session\'s preferences', () => {
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes({ orders: 50 })}>
          <Probe scope="orders" />
        </AuthProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId('size').textContent).toBe('50');
  });

  it('a list with nothing stored is at 20, and so is every list of a new admin (US3 AS-8)', () => {
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes({ orders: 50 })}>
          <Probe scope="returns" />
        </AuthProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId('size').textContent).toBe('20');
    cleanup();
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes(undefined, 'admin-new')}>
          <Probe scope="orders" />
        </AuthProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId('size').textContent).toBe('20');
  });

  it('a stored size that is not an option reads as 20 and is not rewritten (FR-015, US3 AS-7)', () => {
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes({ orders: 7 })}>
          <Probe scope="orders" />
        </AuthProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId('size').textContent).toBe('20');
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('two lists sharing a scope share one value (FR-014)', async () => {
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes({ 'catalog-products': 100 })}>
          <Probe scope="catalog-products" />
          <Probe scope="catalog-products" testId="dialog" />
        </AuthProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId('size').textContent).toBe('100');
    expect(screen.getByTestId('dialog').textContent).toBe('100');
  });

  it('setPageSize writes only that list, and nothing to browser storage (FR-010)', async () => {
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes({ returns: 50 })}>
          <Probe scope="orders" />
        </AuthProvider>
      </StrictMode>,
    );
    await act(async () => setSize(100));
    expect(screen.getByTestId('size').textContent).toBe('100');
    await waitFor(() =>
      expect((patchSpy.mock.calls as unknown[][]).map(([path, body]) => [path, body])).toEqual([
        [PREFS_URL, { listPageSizes: { orders: 100 } }],
      ]),
    );
    expect(window.localStorage.length).toBe(0);
  });

  it('a foreground refetch does not resize the open list; the next mount reads the new size', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
      if (path === PREFS_URL) return { data: { ...ADMIN_PREFERENCES_DEFAULTS, listPageSizes: { orders: 500 } } };
      throw new Error(`unexpected GET ${path}`);
    });
    function Toggle(): ReactElement {
      const [second, setSecond] = useState(false);
      return (
        <>
          <Probe scope="orders" />
          <button type="button" onClick={(): void => setSecond(true)}>mount</button>
          {second ? <Probe scope="orders" testId="next" /> : null}
        </>
      );
    }
    render(
      <StrictMode>
        <AuthProvider initial={sessionWithSizes({ orders: 50 })}>
          <Toggle />
        </AuthProvider>
      </StrictMode>,
    );
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith(PREFS_URL));
    expect(screen.getByTestId('size').textContent).toBe('50');
    await act(async () => screen.getByRole('button', { name: 'mount' }).click());
    expect(screen.getByTestId('next').textContent).toBe('500');
  });
});
