import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';

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
 * The same file with its comments removed.
 *
 * The reaches below are matched as **text**, and a comment saying why a file
 * does *not* take one of them names the shape it refuses — `ReturnsList` and
 * `SeoPage` both carry a sentence about `import.meta.env` explaining that they
 * take the kit's `apiBaseUrl` instead. Matching prose is the defect the check
 * estate refuses by reading literal AST nodes; this is the cheap version of the
 * same rule, and it is deliberately conservative: block comments go, and so do
 * whole lines that *begin* a line comment, but a `//` in mid-line is left alone
 * so a URL inside a string cannot truncate the code after it.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/**
 * The off-state proof `contracts/admin-contribution.md` R15 asks of each of
 * feature 091 batch 8's six converted modules — `seo`, `taxes`,
 * `credit_limits`, `delivery_methods`, `megamenu` and `returns`.
 *
 * **One file for six modules, and the reason is the subject rather than
 * economy.** Every one of them contributes exactly the two surfaces
 * `App.tsx`'s `ModuleRoute` and `composeNav`'s filter gate — a sidebar entry
 * and one or more routes — so the four cases are one table driven six times,
 * and a per-module file would be six copies of it differing in three literals.
 * Where a module has something of its own to assert it gets its own `it`
 * below: `taxes` is the batch's **locked** member (Ruling 2), `returns`
 * carries five routes of which four have no sidebar row of their own, and
 * `delivery_methods` renders a **zone**, which is this batch's real subject and
 * has a file to itself
 * (`admin/test/modules/delivery_methods/integrations-zone.test.tsx`).
 *
 * **The palette is not asserted here and cannot be.** The Actions group is
 * resolved by the server, from the manifests, against the effective
 * enabled-set; `credit_limits` and `delivery_methods` gain a manifest action in
 * this batch (their hand-written `PALETTE_ITEMS` rows go) and `megamenu` and
 * `returns` already had one. All four are proved in
 * `backend/test/integration/<module>/module-owned-surface-off-state.test.ts`.
 * What this file asserts about the palette is the half that is the admin's:
 * that the shell keeps no hand-written copy for the server's answer to
 * disagree with.
 *
 * The permission axis is asserted beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

interface Subject {
  /** The module id the presence projection is asked about. */
  readonly module: string;
  /** The landing route its nav entry points at. */
  readonly route: string;
  /** The code that opens it. */
  readonly permission: string;
  /**
   * A **real** code this module's gate must not accept — a near miss rather
   * than a straw one, so the case fails if the gate compares nothing.
   */
  readonly nearMiss: string;
  /** The module-relative label key its nav entry declares. */
  readonly labelKey: string;
  /** The bare specifier the generated registry must resolve it through. */
  readonly specifier: string;
  /** The nav section the entry declares. */
  readonly section: string;
  /** Every route the module contributes, in declaration order. */
  readonly routes: readonly string[];
  /** The `_i18n` key the shell must no longer name. */
  readonly retiredSharedKey: string | null;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'seo',
    route: '/seo',
    // The module never declared a code of its own: every `/api/v1/admin/seo/*`
    // route enforces `catalog:write`, and the hand-written sidebar entry
    // carried the same one.
    permission: 'catalog:write',
    nearMiss: 'catalog:read',
    labelKey: 'nav.seo.label',
    specifier: '@endora-commerce/mod-seo/admin',
    section: 'channels',
    routes: ['/seo'],
    retiredSharedKey: 'appShell.nav.seo',
  },
  {
    module: 'taxes',
    route: '/taxes',
    permission: 'taxes:read',
    nearMiss: 'taxes:write',
    labelKey: 'nav.taxes.label',
    specifier: '@endora-commerce/mod-taxes/admin',
    section: 'pricing',
    routes: ['/taxes'],
    retiredSharedKey: 'appShell.nav.taxes',
  },
  {
    module: 'credit_limits',
    route: '/credit-limits',
    permission: 'credit_limits:manage',
    // The row directly above it in the same *Customers* section, and the two
    // screens are about the same people.
    nearMiss: 'customers:read',
    labelKey: 'nav.creditLimits.label',
    specifier: '@endora-commerce/mod-credit-limits/admin',
    section: 'customers',
    routes: ['/credit-limits'],
    retiredSharedKey: 'appShell.nav.creditLimits',
  },
  {
    module: 'delivery_methods',
    route: '/delivery-methods',
    permission: 'delivery_methods:read',
    nearMiss: 'delivery_methods:write',
    labelKey: 'nav.deliveryMethods.label',
    specifier: '@endora-commerce/mod-delivery-methods/admin',
    section: 'pricing',
    routes: ['/delivery-methods'],
    // `appShell.nav.deliveryMethods` **stayed** in `_i18n` through this batch:
    // it was also the parent crumb of the `/delivery-methods/dhl-parcel` and
    // `/settings/inpost` trails the batch left standing. Batch 7's
    // `appShell.nav.paymentMethods` asymmetry, met a second time and for the
    // same reason — and this one has since drained. Feature 134's wave 1
    // (FR-023) retired both carrier `CRUMB_DICT` rules, because a host-owned
    // crumb table may not declare a trail whose destination only a module
    // declares, and the parent key went with them; so the entry that read
    // `null` is now the ordinary one, asserted like the rest.
    retiredSharedKey: 'appShell.nav.deliveryMethods',
  },
  {
    module: 'megamenu',
    route: '/megamenu',
    permission: 'megamenu.read',
    nearMiss: 'megamenu.write',
    labelKey: 'nav.megamenu.label',
    specifier: '@endora-commerce/mod-megamenu/admin',
    section: 'content',
    routes: ['/megamenu', '/megamenu/:id'],
    retiredSharedKey: 'appShell.nav.megamenu',
  },
  {
    module: 'returns',
    route: '/returns',
    permission: 'returns:read',
    nearMiss: 'returns:write',
    labelKey: 'nav.returns.label',
    specifier: '@endora-commerce/mod-returns/admin',
    section: 'sales',
    routes: [
      '/returns',
      '/returns/statuses',
      '/returns/reasons',
      '/returns/delivery-methods',
      '/returns/:id',
    ],
    retiredSharedKey: 'appShell.nav.returns',
  },
];

let presentModules = new Set<string>();
let permissions = new Set<string>();

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
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

/**
 * Every one of the six screens fetches on mount. The mock is at the **kit's**
 * barrel, which is the specifier a packaged screen resolves — the admin
 * resolves the same module, so one mock covers both sides of the move.
 *
 * The stub is a **pending** promise and not `{ data: [] }`, which is batch 7's
 * finding rather than a preference: an envelope that satisfies the `try` on the
 * way in leaves each of six screens reading a shape it did not get, and one of
 * those reads raced an unmount in a full-suite run. A pending promise leaves
 * every screen in its own loading state — still a screen, which is the whole of
 * what the positive control claims.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  const pending = (): Promise<never> => new Promise<never>(() => {});
  return {
    ...actual,
    apiClient: {
      get: vi.fn(pending),
      post: vi.fn(pending),
      put: vi.fn(pending),
      patch: vi.fn(pending),
      delete: vi.fn(pending),
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

const { App } = await import('../../../packages/admin-shell/src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.channels',
    'appShell.section.pricing',
    'appShell.section.customers',
    'appShell.section.content',
    'appShell.section.sales',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...Object.fromEntries(
    SUBJECTS.flatMap((subject) =>
      Object.entries(passthroughBundle(subject.module, [subject.labelKey])),
    ),
  ),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} modulePresence={modulePresence({ present: [...presentModules] })} />
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

describe.each(SUBJECTS)('$module owns its admin surface', (subject) => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.permission]);
    renderAt('/');
    expect(sidebarHrefs()).toContain(subject.route);
    expect(
      screen.getByRole('link', { name: new RegExp(subject.labelKey.replace(/\./g, '\\.')) }),
    ).toBeTruthy();
  });

  it('renders its screen at its own route while present', async () => {
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.permission]);
    renderAt(subject.route);
    // The screen's own content is behind a `React.lazy` boundary and a pending
    // fetch, so what is asserted is the gate's answer: `ModuleRoute` let the
    // route through, which is the opposite of the two cases below.
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
  });

  it('contributes no surface while the module is absent from the platform', async () => {
    // Principle XVII item 5, over both surfaces the module contributes. The
    // registry still names it — it answers "what could be here" — and the
    // render is what withdraws it, so an operator's flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set([subject.permission]);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain(subject.route);
    shell.unmount();

    const deepLink = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('contributes no surface to an operator without the code its route enforces', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. The codes are
    // opaque strings, so a near miss from the same module is not a match.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.nearMiss]);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain(subject.route);
    shell.unmount();

    const deepLink = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('restores both surfaces when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set([subject.permission]);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain(subject.route);
    off.unmount();

    presentModules = new Set([subject.module]);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain(subject.route);
    back.unmount();

    const screenBack = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
    screenBack.unmount();
  });
});

describe.each(SUBJECTS)('the shell no longer names $module by hand', (subject) => {
  it('has no host route, nav entry or palette row for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited. Leaving a `<Route>` standing beside the declaration would declare
    // the screen **twice**, with `react-router` silently taking the first
    // match, which D-23 calls the worst available failure.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    // The import is the assertion that carries the `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile,
    // so this one line refuses both halves. The route paths themselves are
    // asserted per declared path in the case below, which is the finer question
    // — a path can survive under a different component.
    expect(app).not.toContain(`modules/${subject.module}`);
    expect(shell).not.toContain(`to: '${subject.route}'`);
    if (subject.retiredSharedKey !== null) {
      expect(shell).not.toContain(subject.retiredSharedKey);
    }
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', async () => {
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-seo/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(subject.routes);
    for (const path of subject.routes) {
      expect(app).not.toContain(`<Route path="${path}"`);
    }
  });

  it('resolves its screens through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain(`from '${subject.specifier}'`);
    expect(registry).not.toContain('packages/modules');
  });

  it('loads every screen lazily, behind a dynamic-import factory', async () => {
    // FR-013. The property is a consequence of the declaration shape: the only
    // function-valued field is a dynamic-import factory, so Vite has a split
    // point whether or not anybody remembers to ask for one.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-seo/admin');
    for (const route of contributions.routes ?? []) {
      expect(typeof route.component).toBe('function');
      const loaded = await route.component();
      expect(typeof loaded.default).toBe('function');
    }
  });

  it('gates its route and its nav entry on the code its own API enforces', async () => {
    // `check:action-route-permissions` holds a module's palette action to the
    // code enforced on its own `targetRoute`; the route and nav declarations
    // are the same statement one layer down, and nothing else compares them.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-seo/admin');
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe(subject.permission);
    }
    expect(contributions.nav?.[0]?.requiredPermission).toBe(subject.permission);
    expect(contributions.nav?.[0]?.section).toBe(subject.section);
    expect(contributions.nav?.[0]?.labelKey).toBe(subject.labelKey);
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  it('names no `@/` alias and no sibling module package', () => {
    // The alias resolves to `admin/src` and to nothing an installed package can
    // reach, so a surviving one would be a screen that compiles here and not in
    // a consumer's install. A `@endora-commerce/mod-…` specifier would be a
    // boundary reach `check:module-boundary` counts.
    const files = [
      'seo/src/admin/pages/SeoPage.tsx',
      'taxes/src/admin/pages/TaxesPage.tsx',
      'credit_limits/src/admin/pages/CreditLimitsPage.tsx',
      'delivery_methods/src/admin/pages/DeliveryMethodsPage.tsx',
      'delivery_methods/src/admin/api/delivery-methods-client.ts',
      'delivery_methods/src/admin/renderers/registry.tsx',
      'megamenu/src/admin/pages/MegamenuEditor.tsx',
      'megamenu/src/admin/pages/MegamenuListPage.tsx',
      'megamenu/src/admin/components/BindingsPanel.tsx',
      'megamenu/src/admin/components/MenuItemConfigPanel.tsx',
      'megamenu/src/admin/components/MenuItemTree.tsx',
      'megamenu/src/admin/api/megamenu-client.ts',
      'returns/src/admin/pages/ReturnsList.tsx',
      'returns/src/admin/pages/ReturnDetail.tsx',
      'returns/src/admin/pages/ReturnReasonsPage.tsx',
      'returns/src/admin/pages/ReturnStatusesConfigPage.tsx',
      'returns/src/admin/pages/ReturnDeliveryMethodsPage.tsx',
      'returns/src/admin/api/returns-client.ts',
    ];
    for (const file of files) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).not.toMatch(/from '@\//m);
      expect(source, file).not.toMatch(/from '@endora-commerce\/mod-/m);
      // `import.meta.env` is Vite's and the package's own `tsconfig.ui.json`
      // carries no `vite/client` types. `ReturnsList` and `SeoPage` both read
      // `VITE_API_BASE_URL` by hand and both now take the kit's `apiBaseUrl` —
      // and both say so in a comment, which is why this reads `codeOf`.
      expect(source, file).not.toContain('import.meta.env');
    }
  });
});

describe('taxes is the batch’s locked member', () => {
  it('declares nonDeactivatable, so its operator axis is closed by the platform', async () => {
    // `plan.md`'s Ruling 2. What a lock removes is the **operator's** ability
    // to make `isPresent` answer `false`; it removes nothing from the
    // frontend's question, so the four cases above are driven for `taxes` like
    // every other member. This reads the lock off the manifest rather than
    // restating it, so a module that is unlocked one day fails here instead of
    // quietly keeping a test that says it cannot be switched off.
    const { manifest } = await import('@endora-commerce/mod-taxes');
    const activation = manifest.activation;
    expect(activation && 'nonDeactivatable' in activation).toBe(true);
  });
});

describe('returns declares its literal sub-routes before its parametric one', () => {
  it('puts /returns/:id last, so a configuration URL is not a detail screen', async () => {
    // The one ordering constraint in this batch. `react-router` ranks a static
    // segment above a dynamic one, but the registry's order is what the
    // generated table preserves, and a `:id` route matching `statuses` first
    // would render the detail screen over a configuration URL.
    const { contributions } = await import('@endora-commerce/mod-returns/admin');
    const paths = contributions.routes?.map((route) => route.path) ?? [];
    expect(paths[paths.length - 1]).toBe('/returns/:id');
    for (const literal of ['/returns/statuses', '/returns/reasons', '/returns/delivery-methods']) {
      expect(paths.indexOf(literal)).toBeLessThan(paths.indexOf('/returns/:id'));
    }
  });
});
