import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { contributions as dhlParcelContributions } from '@endora-commerce/mod-dhl-parcel/admin';
import { contributions as inpostContributions } from '@endora-commerce/mod-inpost/admin';
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
 * `dhl_parcel` and `inpost` own their admin surfaces — feature 091's Phase 4
 * batch five, and the batch's **carrier pair**.
 *
 * They are one file because they are one repair.
 * `backend/scripts/ledgers/cross-module-imports/orders.ts` recorded both
 * reaches and said so in the `inpost` entry: *"both carriers are one shipment
 * tab reaching two adapters, so the Phase 4 batch that moves this consumer
 * takes both or neither; a repair naming one is a repair that has not
 * understood the shape"*. `admin/src/modules/orders/OrderShipmentsTab.tsx`
 * imported `dhlParcelAdminClient` for the label, the handover protocol and the
 * courier booking, and `inpostAdminClient` for the label path; it now builds
 * all four from the published `apiClient` in its own
 * `api/carrier-documents-client.ts`, so neither carrier is named by a file it
 * does not own and both ledger entries are deleted.
 *
 * **Neither module contributes a sidebar entry, and neither is given one.**
 * That is `plan.md`'s Ruling 1 applied: the off-state test's subject is the
 * **route**, which `admin/src/App.tsx`'s `ModuleRoute` gates on
 * `useSurfaceVisibility` — presence *and* permission — rendering the admin's
 * own unknown-path answer. A hidden route is what an operator following a stale
 * deep link meets; a sidebar that omits an entry is not evidence that a screen
 * is unreachable. Adding a sidebar row to two carrier settings screens that
 * have never had one would be a product change bought to make a test
 * assertable.
 *
 * **What each off-state case asserts, in this file's own words** — because
 * Ruling 1 asks a nav-less batch member's test to name the surfaces it does not
 * contribute and why, derived rather than asserted by omission:
 *
 *  * *the module is present and the operator holds the code the route
 *    enforces* — the screen's own heading is on the page. The positive control,
 *    and it is first, because an absence proves nothing until a presence has
 *    been seen;
 *  * *the module is switched off* — the admin's `app.notFound` treatment is on
 *    the page and the heading is not. The registry still names the module (it
 *    answers "what could be here"), so the withdrawal is at render and an
 *    operator's activation flip needs no rebuild;
 *  * *the operator holds no code the route enforces* — the same not-found
 *    treatment, driven on its own axis, because a test that only switched
 *    presence would pass with the permission gate missing entirely;
 *  * *the module comes back* — the heading again, with no rebuild between.
 *
 * The **sidebar** is asserted as an absence in the second `describe` below, and
 * the **palette** — the third surface Constitution XVII item 5 lists — is the
 * server's answer and is proved in
 * `backend/test/integration/{dhl_parcel,inpost}/module-owned-surface-off-state.test.ts`.
 * Both carriers do declare a palette action, so those files drive it rather
 * than assert an emptiness.
 *
 * The whole `App` is rendered rather than the screen, deliberately: the gate is
 * `App.tsx`'s, and a test that mounted the component directly would prove the
 * component renders, which nobody doubted.
 */

let presentModules = new Set<string>();
let permissions = new Set<string>();



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

/** A carrier configuration shaped enough for the screen to render its form. */
const DHL_CONFIG = {
  enabled: true,
  mode: 'sandbox',
  labelType: 'BLP',
  sapClientNumber: '',
  webapiUsername: '',
  webapiPasswordIsSet: false,
  apiPsUsername: '',
  apiPsPasswordIsSet: false,
  senderName: '',
  senderStreet: '',
  senderCity: '',
  senderPostalCode: '',
  senderCountry: 'PL',
  senderPhone: '',
  senderEmail: '',
};

const INPOST_CONFIG = {
  salesChannelId: null,
  mode: 'sandbox',
  active: true,
  organizationIdTest: '',
  organizationIdLive: '',
  accessTokenTestIsSet: false,
  accessTokenLiveIsSet: false,
  geowidgetTokenTest: '',
  geowidgetTokenLive: '',
  defaultSendingMethod: 'parcel_locker',
  defaultParcelTemplate: 'small',
  defaultSenderPoint: '',
  labelSize: 'A6',
  autoCreateOnPaid: false,
  autoInsure: false,
  defaultInsuranceAmount: 0,
  webhookUrl: 'https://example.test/api/v1/public/inpost/webhook',
};

// Both screens call their own config endpoint on mount. The mock sits on the
// kit's barrel, which is the specifier the packaged screens resolve — the admin
// resolves the same module, so one mock covers both sides of the move.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (url: string) => ({
        data: url.includes('/inpost/') ? INPOST_CONFIG : DHL_CONFIG,
      })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/**
 * `App.tsx` imports every host screen statically, and one of them (`cms`' Puck
 * editor) reaches `@dnd-kit/dom`, which constructs a `ResizeObserver` at module
 * scope. jsdom has none. The stub is a module-load accommodation and nothing
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
  ]),
  ...passthroughBundle('dhl_parcel', ['admin.page.title', 'admin.page.subtitle']),
  ...passthroughBundle('inpost', ['page.title', 'page.subtitle']),
};

function renderAt(path: string): RenderResult {
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

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

interface Carrier {
  readonly id: string;
  readonly route: string;
  /** The heading key the screen renders, as its passthrough placeholder. */
  readonly headingKey: RegExp;
  /** The code the screen's own configuration endpoint enforces. */
  readonly code: string;
  /** A real code of another module — held instead of `code`, never as well. */
  readonly foreignCode: string;
  /**
   * The module's `./admin` contribution set, imported statically.
   *
   * Statically because a `import(carrier.specifier)` is a specifier Vite
   * cannot analyse, and the registry's own rule is that a contribution set is
   * enumerable without being executed — both entries here cost the two
   * declaration objects and none of the screen code behind their factories.
   */
  readonly contributions: AdminContributions;
  /**
   * Every zone this carrier contributes to, in declaration order.
   *
   * Written down per carrier rather than compared to a single literal, because
   * the two stopped agreeing at P7d: `dhl_parcel` contributes twice to the
   * order's footer bar (its two actions split by permission code) and `inpost`
   * once to the shipment row.
   */
  readonly zones: readonly string[];
  readonly page: string;
}

const CARRIERS: readonly Carrier[] = [
  {
    id: 'dhl_parcel',
    route: '/delivery-methods/dhl-parcel',
    headingKey: /admin\.page\.title/,
    // `requireAdmin('dhl_parcel:read')` on `GET /api/v1/admin/dhl-parcel/config`.
    code: 'dhl_parcel:read',
    // The module's own write code, and the codes are opaque strings: holding
    // `dhl_parcel:write` does not satisfy a `dhl_parcel:read` gate. This is the
    // near-miss an operator actually has, and the one a sloppy declaration
    // would let through.
    foreignCode: 'dhl_parcel:write',
    contributions: dhlParcelContributions,
    zones: [
      'delivery_method.list.integrations',
      // P7d: the label + protocol at `dhl_parcel:read`, the courier booking at
      // `dhl_parcel:write`. Two contributions because one declares one code.
      'order.shipments.tab.actions',
      'order.shipments.tab.actions',
    ],
    page: '../packages/modules/dhl_parcel/src/admin/pages/DhlParcelSettingsPage.tsx',
  },
  {
    id: 'inpost',
    route: '/settings/inpost',
    headingKey: /page\.title/,
    // Every `/api/v1/admin/inpost/*` route enforces this one code — this module
    // never split read from write.
    code: 'inpost:manage',
    foreignCode: 'dhl_parcel:read',
    contributions: inpostContributions,
    // P7d: the label button on a shipment row, narrowed by `match`.
    zones: ['delivery_method.list.integrations', 'order.shipment.row.actions'],
    page: '../packages/modules/inpost/src/admin/pages/InpostSettingsPage.tsx',
  },
];

describe.each(CARRIERS)('$id owns its admin surface, and its proof is the route', (carrier) => {
  const headingIsRendered = (): boolean =>
    screen.queryAllByText(carrier.headingKey).length > 0;

  it('renders the screen while the module is present and the code is held', async () => {
    presentModules = new Set([carrier.id]);
    permissions = new Set([carrier.code]);
    renderAt(carrier.route);
    await waitFor(() => expect(headingIsRendered()).toBe(true));
  });

  it('renders the not-found treatment while the module is switched off', async () => {
    presentModules = new Set();
    permissions = new Set([carrier.code]);
    renderAt(carrier.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(headingIsRendered()).toBe(false);
  });

  it('renders the not-found treatment for an operator without the code the route enforces', async () => {
    presentModules = new Set([carrier.id]);
    permissions = new Set([carrier.foreignCode]);
    renderAt(carrier.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(headingIsRendered()).toBe(false);
  });

  it('restores the screen when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set([carrier.code]);
    const off = renderAt(carrier.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    off.unmount();

    presentModules = new Set([carrier.id]);
    renderAt(carrier.route);
    await waitFor(() => expect(headingIsRendered()).toBe(true));
  });

  it('declares one lazily-loaded route, one gate, no nav entry and its zones', async () => {
    // FR-013, and the declaration this whole file is about. `nav` being absent
    // is the contribution set saying so, which is what Ruling 1 asks a nav-less
    // batch member's test to derive rather than assert by omission.
    const routes = carrier.contributions.routes ?? [];
    expect(routes.map((route) => route.path)).toEqual([carrier.route]);
    expect(routes.map((route) => route.requiredPermission)).toEqual([carrier.code]);
    expect(carrier.contributions.nav ?? []).toEqual([]);
    const loaded = await routes[0]!.component();
    expect(typeof loaded.default).toBe('function');

    // **One zone since feature 091's batch 8**, and this line read `toEqual([])`
    // until then. `delivery_methods` used to render a hard-coded block naming
    // this carrier — its title, its description, its route and its code, in a
    // file its author does not own — which
    // `backend/scripts/ledgers/foreign-module-ids.ts` recorded as a
    // `visibility-gate` coupling with this conversion as its retiring
    // condition. The card is the carrier's own contribution now, gated on the
    // same code as the screen it links to so it never advertises a 403. The
    // ordering of the two carriers' cards is asserted where it is observable:
    // `admin/test/modules/delivery_methods/integrations-zone.test.tsx`.
    //
    // **P7d added the order-surface contributions**, so this assertion is the
    // integrations card *plus* whatever that row gave each carrier, and it is
    // written as a first-member check rather than as an equality: an equality
    // here would make every future contribution of either carrier a failure in
    // a file whose subject is the settings route. Each carrier's own zone test
    // asserts its declaration in full —
    // `admin/test/modules/inpost/inpost-shipment-row-zone.test.tsx` and
    // `admin/test/modules/dhl_parcel/dhl-shipment-actions-zone.test.tsx`.
    const zones = carrier.contributions.zones ?? [];
    expect(zones[0]?.zone).toBe('delivery_method.list.integrations');
    expect(zones[0]?.requiredPermission).toBe(carrier.code);
    expect(zones.map((zone) => zone.zone)).toEqual(carrier.zones);
    const card = await zones[0]!.component();
    expect(typeof card.default).toBe('function');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install.
    expect(sourceOf(carrier.page)).not.toMatch(/^import .* from '@\//m);
  });
});

describe('the shell no longer names either carrier by hand', () => {
  it('has no host route for either screen, and neither ever had a nav entry', () => {
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('DhlParcelSettingsPage');
    expect(app).not.toContain('InpostSettingsPage');
    expect(app).not.toContain('modules/dhl_parcel');
    expect(app).not.toContain('modules/inpost');
    expect(shell).not.toContain("to: '/settings/inpost'");
    expect(shell).not.toContain("to: '/delivery-methods/dhl-parcel'");
  });

  it('keeps the `/settings/dhl-parcel` redirect, which is the admin application', () => {
    // The one `<Route>` naming this module's URL space that stays: a
    // `<Navigate>` for the deep links predating the screen's move, whose
    // element comes from `react-router-dom` rather than from a surface
    // directory. `check:admin-registrations` attributes it to `host` and its
    // `host-owned (routes=4 nav=3)` is unchanged by this batch, which is the
    // arithmetic this assertion pins.
    const app = sourceOf('src/App.tsx');
    expect(app).toContain('path="/settings/dhl-parcel"');
    expect(app).toContain('to="/delivery-methods/dhl-parcel"');
  });

  it('resolves both screens through the module packages, never through admin/src', () => {
    // R3 / D-149: a relative reach into a package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-dhl-parcel/admin'");
    expect(registry).toContain("from '@endora-commerce/mod-inpost/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('leaves orders reaching neither carrier package', () => {
    // The drain, asserted where it was paid. `OrderShipmentsTab.tsx` named both
    // adapters' admin clients and now names its own, so the two ledger entries
    // in `backend/scripts/ledgers/cross-module-imports/orders.ts` are deleted
    // rather than re-keyed. Deleting the entries without this assertion would
    // leave nothing in the tree saying the coupling is gone.
    const tab = sourceOf('src/modules/orders/OrderShipmentsTab.tsx');
    expect(tab).not.toContain('modules/dhl_parcel');
    expect(tab).not.toContain('modules/inpost');
    expect(tab).not.toContain('@endora-commerce/mod-dhl-parcel');
    expect(tab).not.toContain('@endora-commerce/mod-inpost');
    // **This line asserted the client file until P7d**, which is the half of
    // the drain batch five could pay: `orders` built the calls itself rather
    // than importing a carrier's client. P7d gave both carriers a place to
    // contribute to, so the calls went home and the file went with them — the
    // exit its own header ruled for when it said *"both carriers are one
    // shipment tab reaching two adapters"*.
    // The import, not the word: the file's own header still cites the client by
    // name to say where those calls went, which is the record this assertion
    // exists to keep rather than something to scrub.
    expect(tab).not.toContain("from './api/carrier-documents-client'");
    expect(tab).not.toContain('carrierDocumentsClient');
    expect(
      existsSync(resolve(process.cwd(), 'src/modules/orders/api/carrier-documents-client.ts')),
    ).toBe(false);
    expect(tab).toContain('name="order.shipment.row.actions"');
    expect(tab).toContain('name="order.shipments.tab.actions"');
  });
});
