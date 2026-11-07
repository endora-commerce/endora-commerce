import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { RenderResult } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';

/**
 * Issue #859 — an admin who is already signed in and opens `/login` (a
 * bookmark, a link in an e-mail) was shown the shell's "Page not found": the
 * login screen is rendered only while unauthenticated, and the authenticated
 * router has no `/login` route.
 *
 * `/login` now leads a signed-in admin to the dashboard, or to the `?next=`
 * target when it is a path of this application. `next` is read with the same
 * rule as `?returnTo=` (`readReturnTo` in `@endora-commerce/admin-kit/lib`):
 * never a scheme, a host or `//`, so a crafted link cannot send the admin
 * anywhere else. And `?error=` is still never printed (#813/#826).
 *
 * The whole `App` is rendered, as in the module-owned-surface files: the route
 * table is `App.tsx`'s, and mounting a component directly would prove nothing
 * about it. `LocationProbe` sits beside `App` inside the router and reports
 * where the router ended up.
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: [] })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../packages/admin-shell/src/App');

const bundle = passthroughBundle('core', ['app.notFound', 'app.moduleScreenLoading']);

function LocationProbe(): ReactNode {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string): RenderResult {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} modulePresence={modulePresence({ present: [] })} />
        <LocationProbe />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
    bundle,
  );
}

const location = (): string | null => screen.getByTestId('location').textContent;
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

describe('a signed-in admin opening /login (issue #859)', () => {
  it('lands on the dashboard, not on "Page not found"', async () => {
    renderAt('/login');
    await waitFor(() => expect(location()).toBe('/'));
    expect(notFoundIsRendered()).toBe(false);
  });

  it('lands on a safe ?next= target', async () => {
    renderAt(`/login?next=${encodeURIComponent('/orders?status=open')}`);
    await waitFor(() => expect(location()).toBe('/orders?status=open'));
  });

  it.each([
    ['a protocol-relative host', '//evil.example/phish'],
    ['an absolute URL', 'https://evil.example/phish'],
    ['a backslash host', '/\\evil.example/phish'],
    ['a scheme', 'javascript:alert(1)'],
    ['a relative path', 'orders'],
  ])('ignores an unsafe ?next= (%s) and lands on the dashboard', async (_label, next) => {
    renderAt(`/login?next=${encodeURIComponent(next)}`);
    await waitFor(() => expect(location()).toBe('/'));
    expect(notFoundIsRendered()).toBe(false);
  });

  it('never prints a forged ?error= while redirecting', async () => {
    const forged = 'Your account is locked, call +00 000 000 to unlock it';
    renderAt(`/login?error=${encodeURIComponent(forged)}`);
    await waitFor(() => expect(location()).toBe('/'));
    expect(document.body.textContent).not.toContain(forged);
  });
});
