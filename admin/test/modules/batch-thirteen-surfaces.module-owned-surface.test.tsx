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
 * One of the repository's source files, read as text, relative to `admin/`.
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
 * The reaches below are matched as **text**, and the comments this batch wrote
 * into `App.tsx` and `AppShell.tsx` name the routes and the modules they record
 * having moved. Matching prose is the defect the check estate refuses by
 * reading literal AST nodes; this is the cheap version of the same rule, and it
 * is deliberately conservative: block comments go, and so do whole lines that
 * *begin* a line comment, but a `//` in mid-line is left alone so a URL inside a
 * string cannot truncate the code after it.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line))
    .join('\n');
}

/**
 * The off-state proof `contracts/admin-contribution.md` R15 asks of feature
 * 091 batch 13's four converted modules — `price_lists`, `quick_order`,
 * `inventory` and `pim_ergonode`.
 *
 * ## What is different about this batch
 *
 * Sixteen routes and nine registrations, and all four modules were **already
 * zone contributors** before a single screen moved: P4b gave `pim_ergonode`
 * its three field-protection contributions, P7a and P7b gave `price_lists`
 * three and `quick_order` two, P7c gave `inventory` one and P4d gave
 * `quick_order` the order-entry tab. That is the property the plan's row names
 * — `check:admin-registrations` counts routes and nav entries and a zone is
 * neither, so a contributor can be scheduled independently of the host that
 * renders its place — and it is why the batch's boundary **drain is zero**:
 * every reach these four carried was incoming, and each was repaired by the
 * publication that rendered the host mount.
 *
 * Re-derived on this branch before anything moved: none of the four owns a
 * `cross-module-imports` shard holding an admin key, none is named as a target
 * by any shard, `backend/scripts/ledgers/admin-surface.ts` is empty and
 * `foreign-module-ids.ts` names none of them. `inventory`'s shard survives with
 * one entry and it is a **backend** SQL reach that is feature 077's, not this
 * batch's.
 *
 * ## Two surface directories, one module
 *
 * `inventory` is the case AGENTS.md records for `check:module-boundary`:
 * `AppShell.tsx` attributes `/warehouses` to `module: 'inventory'`, so
 * `admin/src/modules/warehouses/` is that module's second surface directory and
 * moves with the first. Both are asserted gone below.
 *
 * ## The zones are asserted here as a **set**, and driven where they live
 *
 * Every one of the four already has a zone file of its own — `price-lists-zones`,
 * `quick-order-zones`, `channel-warehouses-zone` and `field-protection-zone` —
 * each of which drives the real `<AdminZone>` over the real provider and, for
 * the three switchable modules, its presence and permission off-states. What
 * this file adds is the claim those files cannot make: that the batch moved
 * sixteen routes and nine nav entries **without disturbing the contribution
 * set**, asserted as an equality per module so a zone silently dropped in the
 * move fails here.
 *
 * ## Three axes are real; one module has two
 *
 * `price_lists` declares `activation.nonDeactivatable` (*"B2B is contract
 * pricing"*), so an operator cannot produce its off state and the
 * operator-axis describe below excludes it — **derived from the manifest**,
 * never from the table, so a module locked or unlocked one day fails here
 * rather than quietly keeping a row that says otherwise. The platform axis is
 * still asserted for it: that state is not one an operator can create, but it
 * is what the declarations *mean* and what the platform would do the day the
 * lock is lifted (batch four's reasoning, arriving again).
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. `backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`
 * is that half. What this file asserts about the palette is the half that is
 * the admin's: that the shell keeps no hand-written copy for the server's
 * answer to disagree with.
 */

interface Subject {
  /** The module id the presence projection is asked about. */
  readonly module: string;
  /** The landing route its `index` route declares. */
  readonly route: string;
  /** The code that opens that landing route. */
  readonly permission: string;
  /**
   * A **real** code this module's gate must not accept — a near miss rather
   * than a straw one, so the case fails if the gate compares nothing.
   */
  readonly nearMiss: string;
  /**
   * The module-relative label key its landing nav entry declares, or `null`
   * for a module that contributes no sidebar entry at all.
   */
  readonly labelKey: string | null;
  /** The bare specifier the generated registry must resolve it through. */
  readonly specifier: string;
  /** The nav section its entries declare, or `null` when it declares none. */
  readonly section: string | null;
  /** Every route the module contributes, in declaration order. */
  readonly routes: readonly string[];
  /** Every nav destination it contributes, in declaration order. */
  readonly navTargets: readonly string[];
  /** The `_i18n` keys the shell must no longer name. */
  readonly retiredSharedKeys: readonly string[];
  /** The zones it contributes to, in declaration order. */
  readonly zones: readonly string[];
  /** Every surface directory it leaves behind under `admin/src/modules`. */
  readonly surfaceDirectories: readonly string[];
  /** Whether the manifest declares `activation.nonDeactivatable`. */
  readonly locked: boolean;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'price_lists',
    route: '/price-lists',
    permission: 'price_lists:read',
    // The module's own write code, and the sharp near miss: `routes.ts` builds
    // one `readGate` and one `writeGate`, every screen gates its save controls
    // on the second, and a gate that treated the two as interchangeable would
    // open all three screens and pass every case below.
    nearMiss: 'price_lists:write',
    labelKey: 'nav.priceLists.label',
    specifier: '@endora-commerce/mod-price-lists/admin',
    section: 'pricing',
    routes: ['/price-lists', '/price-lists/display-modes', '/price-lists/:id'],
    navTargets: ['/price-lists'],
    retiredSharedKeys: ['appShell.nav.priceLists', 'appShell.palette.sub.pricingRules'],
    zones: [
      'category.editor.after',
      'product.editor.pricing.after',
      'organization.detail.after',
    ],
    surfaceDirectories: ['price_lists'],
    locked: true,
  },
  {
    module: 'quick_order',
    route: '/orders/quick-order',
    // Read off the routes and not guessed: there is no `quick_order:*` code in
    // the platform at all, and both `POST`s behind this screen carry
    // `orders:write` (`src/backend/routes.admin.ts`). It is a write code for a
    // screen that also reads, which is honest here rather than a compromise —
    // the screen exists to place an order on a customer's behalf.
    permission: 'orders:write',
    // The neighbouring read code an order clerk plausibly holds: a gate that
    // compared nothing would let a read-only clerk place orders for customers.
    nearMiss: 'orders:read',
    labelKey: null,
    specifier: '@endora-commerce/mod-quick-order/admin',
    section: null,
    routes: ['/orders/quick-order'],
    // None, and it is not an omission: the host table's own comment records
    // that quick order *"is not a second destination — it is the other way of
    // getting lines into the same order"*, so it is reached from the tab strip
    // `order.entry.tabs` this module contributes into, never from the sidebar.
    navTargets: [],
    retiredSharedKeys: [],
    zones: [
      'organization.detail.after',
      'customer.detail.after',
      'order.entry.tabs',
    ],
    surfaceDirectories: ['quick_order'],
    locked: false,
  },
  {
    module: 'inventory',
    route: '/inventory',
    permission: 'inventory:read',
    // The module's own write code, which exactly one of its five sidebar rows
    // declares (`/inventory/import`) and which every mutation on the stock and
    // warehouse APIs enforces.
    nearMiss: 'inventory:write',
    labelKey: 'nav.stockOverview.label',
    specifier: '@endora-commerce/mod-inventory/admin',
    section: 'inventory',
    routes: [
      '/inventory',
      '/inventory/low-stock',
      '/inventory/notifications',
      '/inventory/import',
      '/warehouses',
      '/warehouses/new',
      '/warehouses/:id',
    ],
    navTargets: [
      '/inventory',
      '/warehouses',
      '/inventory/low-stock',
      '/inventory/notifications',
      '/inventory/import',
    ],
    retiredSharedKeys: [
      'appShell.nav.stockOverview',
      'appShell.nav.warehouses',
      'appShell.nav.lowStock',
      'appShell.nav.notifyWhenAvailable',
      'appShell.nav.importStock',
      'appShell.palette.sub.stockLevels',
    ],
    zones: ['sales_channel.editor.after'],
    // Two, and the second is the whole point: the nav attributes `/warehouses`
    // to `module: 'inventory'`, so that directory is this module's and moves
    // with the first.
    surfaceDirectories: ['inventory', 'warehouses'],
    locked: false,
  },
  {
    module: 'pim_ergonode',
    route: '/pim-ergonode',
    permission: 'pim_ergonode:read',
    // The module's own write code: starting an import, saving a mapping and
    // creating a price binding all enforce it, and every screen gates its
    // controls on it while opening on the read code.
    nearMiss: 'pim_ergonode:write',
    labelKey: 'nav.pimErgonode.label',
    specifier: '@endora-commerce/mod-pim-ergonode/admin',
    section: 'catalog',
    routes: [
      '/pim-ergonode',
      '/pim-ergonode/attribute-mappings',
      '/pim-ergonode/category-mappings',
      '/pim-ergonode/runs',
      '/pim-ergonode/runs/:runId',
    ],
    // One row for five screens, which the host table's own comment records as
    // deliberate: the other four are reached through the tab strip on the
    // connector page, and three sidebar rows for one connector read as three
    // destinations.
    navTargets: ['/pim-ergonode'],
    retiredSharedKeys: [
      'appShell.nav.pimErgonode',
      'appShell.nav.pimErgonodeRuns',
      'appShell.nav.pimErgonodeAttributeMappings',
      'appShell.nav.pimErgonodeCategoryMappings',
      'appShell.crumb.importRun',
    ],
    zones: [
      'product.editor.details.before',
      'product.editor.pricing.before',
      'product.editor.field.after',
    ],
    surfaceDirectories: ['pim_ergonode'],
    locked: false,
  },
];

/** The three modules an operator can genuinely switch off. */
const SWITCHABLE = SUBJECTS.filter((subject) => !subject.locked);

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

/**
 * Every screen in the batch fetches on mount. The mock is at the **kit's**
 * barrel, which is the specifier a packaged screen resolves — the admin
 * resolves the same module through its own shim, so one mock covers both sides
 * of the move.
 *
 * The stub is a **pending** promise and not `{ data: [] }`, which is batch 7's
 * finding rather than a preference: an envelope that satisfies the `try` on the
 * way in leaves a screen reading a shape it did not get, and one of those reads
 * raced an unmount in a full-suite run. A pending promise leaves each screen in
 * its own loading state — still a screen, which is the whole of what the
 * positive control claims.
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
    'appShell.section.inventory',
    'appShell.section.catalog',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...Object.fromEntries(
    SUBJECTS.flatMap((subject) =>
      subject.labelKey === null
        ? []
        : Object.entries(passthroughBundle(subject.module, [subject.labelKey])),
    ),
  ),
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

/**
 * A concrete URL for a declared route pattern.
 *
 * The deep-link cases below have to navigate somewhere real, and two of this
 * batch's sixteen routes are parametric. A pattern rendered verbatim would
 * navigate to a path with a literal `:id` in it, which `react-router` matches
 * just as happily and which therefore proves the gate over a URL no operator
 * can reach.
 */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, 'sample');
}

/** The module's `./admin` contribution set, off the bare specifier. */
async function contributionsOf(
  subject: Subject,
): Promise<typeof import('@endora-commerce/mod-price-lists/admin')['contributions']> {
  const loaded = (await import(/* @vite-ignore */ subject.specifier)) as typeof import(
    '@endora-commerce/mod-price-lists/admin'
  );
  return loaded.contributions;
}

/**
 * Every subject's contribution set, resolved once.
 *
 * A `describe.each` body runs at collection time, so the dynamic imports above
 * cannot be awaited inside a synchronous case. Resolving them here keeps every
 * assertion reading the **declaration a bundler will read** rather than a copy
 * of it.
 */
const CONTRIBUTIONS = new Map(
  await Promise.all(
    SUBJECTS.map(
      async (subject) => [subject.module, await contributionsOf(subject)] as const,
    ),
  ),
);

describe.each(SUBJECTS)('$module owns its admin surface', (subject) => {
  it('contributes its sidebar entries from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.permission, subject.nearMiss]);
    renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).toContain(target);
    }
    if (subject.labelKey === null) {
      // The nav-less module, and the claim is the negative one: `quick_order`
      // advertises no sidebar row at all, so the sidebar must hold none of its
      // routes. That is `plan.md` Ruling 1's case — the route is the subject,
      // and it is driven by the case below.
      for (const path of subject.routes) {
        expect(sidebarHrefs(), path).not.toContain(path);
      }
      return;
    }
    expect(
      screen.getByRole('link', { name: new RegExp(subject.labelKey.replace(/\./g, '\\.')) }),
    ).toBeTruthy();
  });

  it('renders every one of its screens at its own route while present', async () => {
    // All sixteen across the batch, not the landing ones: the batch's value is
    // the whole surface moving, and a registry that dropped a route would leave
    // the landing screen answering and the rest on the admin's not-found page.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.permission, subject.nearMiss]);
    for (const pattern of subject.routes) {
      const rendered = renderAt(concreteUrl(pattern));
      // The screen's own content is behind a `React.lazy` boundary and a
      // pending fetch, so what is asserted is the gate's answer: `ModuleRoute`
      // let the route through, which is the opposite of the two cases below.
      await waitFor(() => expect(notFoundIsRendered(), pattern).toBe(false));
      rendered.unmount();
    }
  });

  it('contributes no surface while the module is absent from the platform', async () => {
    // Principle XVII item 5, over every surface the module contributes, on the
    // **platform** axis. The registry still names it: the registry answers
    // "what could be here", and the render is what withdraws it, so an
    // operator's flip needs no rebuild.
    //
    // `price_lists` is locked, so this is not a state an operator can create —
    // it is asserted because it is what the declarations *mean* and what the
    // platform would do the day the lock is lifted (batch four's reasoning).
    presentModules = new Set();
    permissions = new Set([subject.permission, subject.nearMiss]);
    const shell = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).not.toContain(target);
    }
    shell.unmount();

    for (const pattern of subject.routes) {
      const deepLink = renderAt(concreteUrl(pattern));
      await waitFor(() => expect(notFoundIsRendered(), pattern).toBe(true));
      deepLink.unmount();
    }
  });

  it('contributes no surface to an operator without the code its route enforces', async () => {
    // The permission axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. The near miss is a
    // real code, so the case fails if the gate compares nothing.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.nearMiss]);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain(subject.route);
    shell.unmount();

    const deepLink = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('restores both surfaces when the code is granted again, with no rebuild', async () => {
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.nearMiss]);
    const withheld = renderAt('/');
    expect(sidebarHrefs()).not.toContain(subject.route);
    withheld.unmount();

    permissions = new Set([subject.permission]);
    const back = renderAt('/');
    // The landing row and not every row: `inventory`'s CSV importer declares
    // `inventory:write` and is the one entry in the batch that a holder of the
    // landing code alone does not see — which is the hand-written table's own
    // gate, kept, and is asserted in its own case below.
    if (subject.navTargets.length > 0) expect(sidebarHrefs()).toContain(subject.route);
    back.unmount();

    const screenBack = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
    screenBack.unmount();
  });
});

describe('the three switchable modules withdraw everything the operator switches off', () => {
  it.each(SWITCHABLE)('withdraws every $module surface when the operator switches it off', async (subject) => {
    // The frontend answers both axes from one presence projection, so the
    // assertion has the shape of the platform case above — what differs is that
    // an operator can produce this state at runtime, which is what Constitution
    // XVII item 5 is about. The server half, where a deactivation is a real
    // Setting write, is
    // `backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    //
    // The other subjects stay present throughout, so what is withdrawn is this
    // module's surface and not the shell's — a control the platform case above
    // cannot have, because there nothing is present at all.
    const others = SUBJECTS.filter((entry) => entry.module !== subject.module);
    presentModules = new Set(SUBJECTS.map((entry) => entry.module));
    permissions = new Set(SUBJECTS.flatMap((entry) => [entry.permission, entry.nearMiss]));
    const on = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).toContain(target);
    }
    on.unmount();

    presentModules = new Set(others.map((entry) => entry.module));
    const off = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).not.toContain(target);
    }
    for (const other of others) {
      for (const target of other.navTargets) {
        expect(sidebarHrefs(), target).toContain(target);
      }
    }
    off.unmount();

    for (const pattern of subject.routes) {
      const deepLink = renderAt(concreteUrl(pattern));
      await waitFor(() => expect(notFoundIsRendered(), pattern).toBe(true));
      deepLink.unmount();
    }
  });
});

describe.each(SUBJECTS)('the shell no longer names $module by hand', (subject) => {
  it('has no host route, nav entry or palette row for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited. Leaving a `<Route>` standing beside the declaration would declare
    // the screen **twice**, with `react-router` silently taking the first
    // match, which D-23 calls the worst available failure.
    const shell = codeOf('src/components/AppShell.tsx');
    for (const target of subject.navTargets) {
      expect(shell, target).not.toContain(`to: '${target}'`);
    }
    for (const key of subject.retiredSharedKeys) {
      expect(shell, key).not.toContain(key);
    }
  });

  it('drops the retired keys from the shared _i18n bundle, in both languages', () => {
    // The other end of the same statement. A key nothing renders is a key the
    // next module author copies, and `_i18n` is one of the four shared files
    // this feature exists to stop a module author having to edit. Both shipped
    // languages, because a key retired in one and left in the other is exactly
    // what `check:bundle-pairing` was built for one layer up.
    for (const language of ['en', 'pl']) {
      const shared = JSON.parse(
        sourceOf(`../packages/modules/_i18n/i18n/${language}.json`),
      ) as Record<string, string>;
      for (const key of subject.retiredSharedKeys) {
        expect(shared[key], `${key} (${language})`).toBeUndefined();
      }
    }
  });

  it('renders every nav label out of the module’s own bundle, in both languages', () => {
    // R8. The label keys are module-relative and resolve in the module's own
    // namespace, so the copy has to be in the module's own bundle — and a
    // missing key renders as the raw key, silently, which is the failure this
    // case exists to make loud. Every entry, not only the landing one:
    // `inventory` contributes five and a bundle short of one of them renders a
    // dotted key in the operator's sidebar.
    const contributions = CONTRIBUTIONS.get(subject.module);
    for (const language of ['en', 'pl']) {
      const own = JSON.parse(
        sourceOf(`../packages/modules/${subject.module}/i18n/${language}.json`),
      ) as Record<string, string>;
      for (const entry of contributions?.nav ?? []) {
        expect(own[entry.labelKey], `${entry.labelKey} (${language})`).toBeTruthy();
      }
    }
  });

  it('leaves no surface directory behind under admin/src/modules', () => {
    // Batch 8's finding, made an assertion. `check:module-boundary` exits 2 on
    // a directory named after a registered module that holds no file, and its
    // message sends the reader looking for a moved module root when the answer
    // is `rmdir`. For `inventory` it is two directories, `warehouses` being the
    // second surface directory the nav attributes to it — and its
    // `components/FulfilmentStrategyPicker.tsx` re-export shim goes with them:
    // its only remaining reader was `admin/test/kit/admin-kit-identity.test.ts`,
    // and both consumers of the picker already name the kit's subpath, so
    // keeping it would have kept a file alive for one assertion.
    for (const directory of subject.surfaceDirectories) {
      expect(() => sourceOf(`src/modules/${directory}`), directory).toThrow();
    }
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', () => {
    const app = codeOf('src/App.tsx');
    const contributions = CONTRIBUTIONS.get(subject.module);
    expect(contributions?.routes?.map((route) => route.path)).toEqual(subject.routes);
    for (const path of subject.routes) {
      expect(app, path).not.toContain(`<Route path="${path}"`);
    }
    // The import is the assertion that carries a `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile.
    // Read off the **code** rather than the source, because the comment this
    // batch left in `App.tsx` names all five module directories in prose.
    for (const directory of subject.surfaceDirectories) {
      expect(app, directory).not.toContain(`modules/${directory}`);
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
    const contributions = CONTRIBUTIONS.get(subject.module);
    for (const route of contributions?.routes ?? []) {
      expect(typeof route.component).toBe('function');
      const loaded = await route.component();
      expect(typeof loaded.default).toBe('function');
    }
  });

  it('gates its landing route, and its landing nav entry where it has one', () => {
    // `check:action-route-permissions` holds a module's palette action to the
    // code enforced on its own `targetRoute`; the route and nav declarations
    // are the same statement one layer down, and nothing else compares them.
    const contributions = CONTRIBUTIONS.get(subject.module);
    const landing = (contributions?.routes ?? []).find((route) => route.path === subject.route);
    expect(landing?.requiredPermission).toBe(subject.permission);
    expect(landing?.index).toBe(true);
    expect((contributions?.nav ?? []).map((nav) => nav.to)).toEqual(subject.navTargets);
    if (subject.labelKey === null) return;
    const entry = (contributions?.nav ?? []).find((nav) => nav.to === subject.route);
    expect(entry?.requiredPermission).toBe(subject.permission);
    expect(entry?.section).toBe(subject.section);
    expect(entry?.labelKey).toBe(subject.labelKey);
    // Every entry sits in the one section this module declares — a module
    // scattering rows across sections is a sidebar an operator cannot predict.
    for (const nav of contributions?.nav ?? []) {
      expect(nav.section, nav.to).toBe(subject.section);
    }
  });

  it('gates every nav entry on the code its own route enforces', () => {
    // Issue #232's rule one layer down, per row rather than per module. Four of
    // `inventory`'s five rows open on `inventory:read` and the CSV importer on
    // `inventory:write` — the hand-written table's own split, kept — so a
    // module-wide comparison would either lose that fact or report it as drift.
    // Nothing else in the estate compares a nav entry to the route beneath it.
    const contributions = CONTRIBUTIONS.get(subject.module);
    const byPath = new Map(
      (contributions?.routes ?? []).map((route) => [route.path, route.requiredPermission]),
    );
    for (const entry of contributions?.nav ?? []) {
      expect(entry.requiredPermission, entry.to).toBe(byPath.get(entry.to));
    }
  });

  it('points every nav entry at a route it also declares', () => {
    // A sidebar row whose destination no route declares is a link to the
    // admin's not-found page, and nothing else in the estate compares the two
    // arrays: `check:admin-registrations` counts them and
    // `check:action-route-permissions` reads the manifest, not this file.
    const contributions = CONTRIBUTIONS.get(subject.module);
    const declared = new Set((contributions?.routes ?? []).map((route) => route.path));
    for (const entry of contributions?.nav ?? []) {
      expect(declared.has(entry.to), entry.to).toBe(true);
    }
  });
});

describe('the axis each module has is read off its manifest, never carried in this table', () => {
  it.each(SUBJECTS)('$module declares the activation shape this file assumes', async (subject) => {
    // `plan.md`'s Ruling 2, asserted rather than restated. What a lock would
    // remove is the **operator's** ability to make `isPresent` answer `false`;
    // three of this batch's four are switchable and `price_lists` is not, so
    // reading it here is what makes a module locked or unlocked one day fail
    // this file instead of quietly keeping a table row that says otherwise —
    // and `SWITCHABLE` above, which decides who the operator-axis describe
    // drives, is derived from the same field.
    const { manifest } = (await import(
      /* @vite-ignore */ subject.specifier.replace('/admin', '')
    )) as typeof import('@endora-commerce/mod-price-lists');
    const activation = manifest.activation;
    const locked = Boolean(activation && 'nonDeactivatable' in activation);
    expect(locked).toBe(subject.locked);
    expect(activation).toBeDefined();
  });
});

describe('the surfaces each module does not contribute, derived from the contribution set', () => {
  it.each(SUBJECTS)('$module contributes exactly the zones its own zone file drives', (subject) => {
    // Ruling 1: the off-state test asserts every surface the module
    // contributes, and names the ones it does not **derived from the
    // contribution set** rather than asserted. All four of this batch are zone
    // contributors already — which is what let them be scheduled after their
    // hosts — so this is the case that fails if the move dropped one, and each
    // module's own file (`price-lists-zones`, `quick-order-zones`,
    // `channel-warehouses-zone`, `field-protection-zone`) drives the renderer
    // over the real provider, presence and permission included.
    const contributions = CONTRIBUTIONS.get(subject.module);
    expect((contributions?.zones ?? []).map((zone) => zone.zone)).toEqual(subject.zones);
  });

  it.each(SUBJECTS)('$module contributes no nav entry it does not declare a section for', (subject) => {
    // The derived negative for the nav-less module: `quick_order` declares no
    // `nav` array at all, so there is no sidebar row of its to withdraw and no
    // section for it to sit in. Written as a derivation rather than a table
    // row, so the day it grows one this case fails instead of the table
    // silently disagreeing with the declaration.
    const contributions = CONTRIBUTIONS.get(subject.module);
    const entries = contributions?.nav ?? [];
    expect(entries.length === 0).toBe(subject.section === null);
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  const MOVED = [
    'price_lists/src/admin/components/ApplicationRuleBuilder.tsx',
    'price_lists/src/admin/components/BracketGrid.tsx',
    'price_lists/src/admin/pages/DisplayModeOverridesPage.tsx',
    'price_lists/src/admin/pages/PriceListDetailPage.tsx',
    'price_lists/src/admin/pages/PriceListsPage.tsx',
    'quick_order/src/admin/api/quick-order-client.ts',
    'quick_order/src/admin/pages/QuickOrderOnBehalfPage.tsx',
    'inventory/src/admin/api/warehouses-client.ts',
    'inventory/src/admin/pages/AvailabilityNotificationsPage.tsx',
    'inventory/src/admin/pages/InventoryPage.tsx',
    'inventory/src/admin/pages/LowStockPage.tsx',
    'inventory/src/admin/pages/StockImportWizard.tsx',
    'inventory/src/admin/pages/WarehouseEditor.tsx',
    'inventory/src/admin/pages/WarehousesList.tsx',
    'pim_ergonode/src/admin/api/ergonode-client.ts',
    'pim_ergonode/src/admin/components/ErgonodeIssueGroups.tsx',
    'pim_ergonode/src/admin/components/ErgonodeRunStatusBadge.tsx',
    'pim_ergonode/src/admin/components/ErgonodeSectionTabs.tsx',
    'pim_ergonode/src/admin/format.ts',
    'pim_ergonode/src/admin/pages/ErgonodeAttributeMappingPage.tsx',
    'pim_ergonode/src/admin/pages/ErgonodeCategoryMappingPage.tsx',
    'pim_ergonode/src/admin/pages/ErgonodeConnectionPage.tsx',
    'pim_ergonode/src/admin/pages/ErgonodeRunDetailPage.tsx',
    'pim_ergonode/src/admin/pages/ErgonodeRunsPage.tsx',
  ];

  it('names no `@/` alias and reads no bundler environment', () => {
    // The alias resolves to `admin/src` and to nothing an installed package can
    // reach, so a surviving one would be a screen that compiles here and not in
    // a consumer's install. `import.meta.env` is Vite's, and a package's
    // `tsconfig.ui.json` carries no `vite/client` types — a read of it would
    // not compile, which is a stronger instrument than this line and is why
    // this line is cheap to keep.
    for (const file of MOVED) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).not.toMatch(/from '@\//m);
      expect(source, file).not.toContain('import.meta.env');
    }
  });

  it('names no sibling module package: the batch’s drain is zero', () => {
    // The row's claim, asserted rather than restated. All four modules were
    // zone contributors before a screen moved, so every reach they carried was
    // **incoming** and each was repaired by the publication that rendered the
    // host mount — in a module this batch does not move.
    // `check:module-boundary` refuses an *unledgered* reach; what it cannot say
    // is that the conversion did not swap a relative import for a package one,
    // which is the shape `module-package-layout.md` §0 measured as looking like
    // progress. So: no module package names another anywhere in these files.
    const reaching = MOVED.filter((file) =>
      codeOf(`../packages/modules/${file}`).includes('@endora-commerce/mod-'),
    );
    expect(reaching).toEqual([]);
  });

  it('keeps the two surface directories one module, with no reach between them', () => {
    // `inventory`'s warehouse screens and its stock screens were two
    // directories under `admin/src/modules` and are one `src/admin/` now, so
    // the reach `WarehousesList` made into `warehouses/api/warehouses-client`
    // is an intra-package relative import rather than a cross-directory one.
    // Asserted because the alternative — leaving the client behind — is what
    // would have made a package reach back into `admin/src`, which is the
    // failure P7c's `ChannelWarehouses` had to rebuild its way out of.
    const list = codeOf('../packages/modules/inventory/src/admin/pages/WarehousesList.tsx');
    expect(list).toContain("from '../api/warehouses-client.js'");
  });
});
