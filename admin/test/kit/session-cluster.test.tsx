import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import {
  AuthProvider,
  ModulePresenceProvider,
  useAuth,
  useModulePresence,
  usePageSizePreference,
  useSurfaceVisibility,
  type AdminMe,
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
 * jsdom is configured here without a `localStorage`, so the hook's own
 * `try`/`catch` swallows the absence and every call returns the default. That is
 * correct behaviour for a browser that refuses storage, and it means the
 * persistence half has never been exercised by anything — so this file supplies
 * the API rather than asserting over its absence.
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

describe('usePageSizePreference — keyed by the signed-in admin', () => {
  it('reads a value the same admin stored, and not another admin’s', () => {
    withLocalStorage();
    const scope = 'p3-session-scope';
    const mine = adminSession({ permissions: [], id: 'admin-one' });
    const theirs = adminSession({ permissions: [], id: 'admin-two' });
    window.localStorage.setItem(`b2b-admin.page-size.${scope}.admin-one`, '50');
    window.localStorage.setItem(`b2b-admin.page-size.${scope}.admin-two`, '100');

    function Probe(): ReactElement {
      const { pageSize } = usePageSizePreference(scope);
      return <span data-testid="size">{String(pageSize)}</span>;
    }

    const { unmount } = render(<AuthProvider initial={mine}><Probe /></AuthProvider>);
    expect(screen.getByTestId('size').textContent).toBe('50');
    unmount();

    render(<AuthProvider initial={theirs}><Probe /></AuthProvider>);
    expect(screen.getByTestId('size').textContent).toBe('100');
  });

  it('falls back to the default for a stored value that is not an option', () => {
    withLocalStorage();
    const scope = 'p3-session-bad-value';
    window.localStorage.setItem(`b2b-admin.page-size.${scope}.admin-one`, '7');
    function Probe(): ReactElement {
      const { pageSize } = usePageSizePreference(scope);
      return <span data-testid="size">{String(pageSize)}</span>;
    }
    render(
      <AuthProvider initial={adminSession({ permissions: [], id: 'admin-one' })}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('size').textContent).toBe('20');
  });
});
