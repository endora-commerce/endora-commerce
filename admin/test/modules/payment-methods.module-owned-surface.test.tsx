import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * One of the admin's own source files, read as text.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one.
 */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * `payment_methods` is the **switchable-with-nav** member of feature 091's
 * Phase 4 batch 7, and this is the off-state proof
 * `contracts/admin-contribution.md` R15 asks of a converted module.
 *
 * The module contributes a **route** and a **sidebar entry**; both are asserted
 * here. The **palette action** is the server's — it has existed since feature
 * 076 (D-83 item 8) — resolved by `AdminActionsService` against the effective
 * enabled-set, and is proved in
 * `backend/test/integration/payment_methods/module-owned-surface-off-state.test.ts`.
 *
 * The permission axis is driven beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing. The
 * near miss is `catalog:read`/`catalog:write`, which is not an arbitrary
 * negative: until 2026-08-28 those two codes were what gated every one of this
 * module's six admin routes, so whoever could edit a product could rewrite
 * which methods a checkout offers.
 */

let presentModules = new Set<string>(['payment_methods']);
let permissions = new Set<string>(['payment_methods:read']);

vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('@/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

// The screen makes three reads on mount (methods, order statuses, adapters).
// The mock is at the kit's barrel, which is the specifier the packaged screen
// resolves — the admin resolves the same module, so one mock covers both sides
// of the move. An empty list from all three is enough: this file asserts the
// heading, not a row.
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

/**
 * `@dnd-kit/dom` constructs a `ResizeObserver` at module scope, and jsdom has
 * none. This read *"`App.tsx` imports every host screen statically, and one of
 * them (`cms`' Puck editor)"* until feature 091's batch 16 moved that editor
 * into `@endora-commerce/mod-cms`; the stub stays because a lazily loaded
 * screen reaches the same constructor, and only the reason changed. The stub is a module-load accommodation and nothing
 * this file asserts touches it.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.pricing',
    'app.moduleScreenLoading',
    'app.notFound',
    // The screen resolves its own copy in `core` over `_i18n`'s shared bundle,
    // which this conversion does not change — batch four's shape, the same one
    // `admin_users`' and `audit_logs`' screens are in. Only the sidebar entry's
    // label moved into the package.
    'legacyMethods.payment.title',
    'legacyMethods.payment.description',
    'legacyMethods.payment.empty',
  ]),
  ...passthroughBundle('payment_methods', ['nav.paymentMethods.label']),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App modulePresence={modulePresence({ present: [...presentModules] })} />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...permissions] }) },
    ),
    bundle,
  );
}

function sidebarHrefs(): (string | null)[] {
  return [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
}

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

/** The screen's own heading key, rendered as its passthrough placeholder. */
const screenIsRendered = (): boolean =>
  screen.queryAllByText(/legacyMethods\.payment\.title/).length > 0;

describe('payment_methods owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['payment_methods']);
    permissions = new Set(['payment_methods:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/payment-methods');
    // The label resolves in the **module's** namespace, not in `core`.
    expect(screen.getByRole('link', { name: /nav\.paymentMethods\.label/ })).toBeTruthy();
  });

  it('renders its screen at its own route while present', async () => {
    presentModules = new Set(['payment_methods']);
    permissions = new Set(['payment_methods:read']);
    renderAt('/payment-methods');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });

  it('contributes no surface while the module is switched off', async () => {
    // Principle XVII item 5, over both surfaces the module contributes. The
    // registry still names it — it answers "what could be here" — and the
    // render is what withdraws it, so an operator's activation flip needs no
    // rebuild.
    presentModules = new Set();
    permissions = new Set(['payment_methods:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/payment-methods');
    shell.unmount();

    const deepLink = renderAt('/payment-methods');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
    deepLink.unmount();
  });

  it('contributes no surface to an operator without the code its route enforces', async () => {
    // The second axis, moved on its own. `catalog:write` is the code that used
    // to open this screen, which makes it the discriminating negative rather
    // than an arbitrary one; the codes are opaque strings.
    presentModules = new Set(['payment_methods']);
    permissions = new Set(['catalog:read', 'catalog:write']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/payment-methods');
    shell.unmount();

    const deepLink = renderAt('/payment-methods');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
    deepLink.unmount();
  });

  it('restores both surfaces when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['payment_methods:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/payment-methods');
    off.unmount();

    presentModules = new Set(['payment_methods']);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain('/payment-methods');
    back.unmount();

    const screenBack = renderAt('/payment-methods');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
    screenBack.unmount();
  });
});

describe('the shell no longer names payment_methods by hand', () => {
  it('has no host route, nav entry, breadcrumb rule or palette row for the screen', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither declares the screen now, and both are still there.
    // Leaving one standing would declare it twice, with `react-router` silently
    // taking the first match.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('<PaymentMethodsPage');
    expect(app).not.toContain('modules/payment_methods');
    expect(shell).not.toContain("to: '/payment-methods'");
    // The palette's Actions group is the server's; what the admin must not do
    // is carry a second, hand-written copy in `PALETTE_ITEMS`.
    expect(shell).not.toContain("to: '/payment-methods'");
    // `CRUMB_DICT`'s own rule for this screen goes, so `registryCrumbs` derives
    // the trail from the nav contribution instead.
    expect(shell).not.toContain('\\/payment-methods\\/?$');
  });

  it('keeps the shared label the five gateway breadcrumbs still name', () => {
    // Deliberate, and the one asymmetry in this batch. `appShell.nav.paymentMethods`
    // stays in `_i18n`'s bundle because it is also the **parent crumb** of five
    // `CRUMB_DICT` trails batch five left standing — `/settings/{tpay,stripe,
    // payu,autopay,paypal}` — those five modules contributing no nav entry for
    // `registryCrumbs` to derive from. Deleting it would render a raw key on
    // five screens this batch does not touch.
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(shell).toContain("labelKey: 'appShell.nav.paymentMethods', href: '/payment-methods'");
    const shared = JSON.parse(
      sourceOf('../packages/modules/_i18n/i18n/en.json'),
    ) as Record<string, string>;
    expect(shared['appShell.nav.paymentMethods']).toBe('Payment methods');
  });

  it('resolves the screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-payment-methods/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('gates its route and its nav entry on the code its own API enforces', async () => {
    // `check:action-route-permissions` holds this module's palette action to
    // the code enforced on its own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. `GET /api/v1/admin/payment-methods` is behind
    // `requireAdmin('payment_methods:read')`.
    const { contributions } = await import('@endora-commerce/mod-payment-methods/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(['/payment-methods']);
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe('payment_methods:read');
      // FR-013: the only function-valued field is a dynamic-import factory, so
      // Vite has a split point whether or not anybody asks for one.
      expect(typeof route.component).toBe('function');
    }
    expect(contributions.nav?.[0]?.requiredPermission).toBe('payment_methods:read');
    expect(contributions.nav?.[0]?.section).toBe('pricing');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install. `renderers/registry.tsx` is included because it looks
    // like a cross-module seam and is not: every entry in it is this module's
    // own markup over this module's own client.
    for (const file of [
      '../packages/modules/payment_methods/src/admin/pages/PaymentMethodsPage.tsx',
      '../packages/modules/payment_methods/src/admin/renderers/registry.tsx',
      '../packages/modules/payment_methods/src/admin/api/payment-methods-client.ts',
    ]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/^import .* from '@\//m);
      expect(source).not.toMatch(/^import .* from '@endora-commerce\/mod-/m);
    }
  });
});
