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
 * 091 batch 15's two converted modules — `catalog` and `orders`.
 *
 * ## What is different about this batch
 *
 * These are the two **largest** hosts of the drain: twelve routes and thirteen
 * registrations between them, against batch 14's eight and six. And they are
 * the batch where a host's zone mounts stop being one member each:
 * `ProductEditor.tsx` alone renders five members over eight `<AdminZone>`
 * elements, `CategoriesTree.tsx` renders `category.editor.after`, and `orders`
 * mounts four members across three screens — `order.detail.payment`,
 * `order.shipment.row.actions`, `order.shipments.tab.actions` and the
 * `order.entry.tabs` strip, which is a `<RouteTabsZone>` rather than an
 * `<AdminZone>`.
 *
 * A screen that moved into a package and lost a mount on the way would leave
 * those contributions rendering nowhere. `check:admin-zones` calls that
 * `unrendered-zone` and every contribution to it
 * `contribution-to-unrendered-zone`, which is a build failure rather than a
 * silence — but only once somebody runs it. Here it is a test, in the file
 * whose subject is the move, and the mounts are counted per member so a
 * `<AdminZone>` deleted from one of `ProductEditor`'s five field slots fails
 * rather than passing behind the other four.
 *
 * ## Both modules are locked, which is a first for this drain
 *
 * `catalog` declares `activation.nonDeactivatable` (*"a commerce platform
 * without a catalogue is a different product"*) and so does `orders` (*"the
 * order is the transaction this platform exists to record"*). So **no** subject
 * in this batch has an operator axis at all — `SWITCHABLE` is empty — and the
 * operator-axis `describe` below asserts that emptiness from the manifests
 * rather than omitting itself. The day either lock is lifted, that case fails
 * and the drive has to be written; a silently empty `it.each` would not.
 *
 * The platform axis is still asserted for both: that state is not one an
 * operator can create, but it is what the declarations *mean* and what the
 * platform would do the day a lock is lifted (batch four's reasoning, arriving
 * again).
 *
 * ## The drain is zero, and it is zero for batch 13 and 14's reason
 *
 * Re-derived on this branch before anything moved: `catalog` owns a
 * `cross-module-imports` shard and **every key in it is a backend SQL join** —
 * `carts/cart_items`, `orders/order_items` and the kernel's
 * `sales_channel_products` — features 077 and 080's debt, in files this batch
 * does not open. `orders` owns no shard and is named as a target by none.
 * `backend/scripts/ledgers/admin-surface.ts` is empty and
 * `foreign-module-ids.ts` names neither. `check:module-boundary` reads
 * `cross-module reaches=7 (imports=3 sql=4) ledger-size=7 shards=4` on both
 * sides of the move, and that agreement is the measurement rather than a
 * silence.
 *
 * ## One route tightens, and it is recorded rather than glossed
 *
 * `/orders/new` was `App.tsx`'s and therefore **ungated**, while the sidebar
 * row that advertised it carried `orders:write` and the `order.entry.tabs`
 * contribution P4d declared carries the same code. The route is this module's
 * own now and takes it, which is `credentials`' shape from batch 10 and
 * `sales_channels`' from batch 14: a screen whose only purpose is a write opens
 * on the write code.
 *
 * `/catalog/products/new` does **not** tighten, and the difference is worth
 * stating because it looks like an omission. There is no such route: the
 * product create form is `/catalog/products/:id` with the id `new`, which is
 * what `ProductEditor`'s own `isNew` reads. Declaring a static
 * `/catalog/products/new` beside it would be inventing a route in a batch whose
 * job is to move one, so `new-product`'s target is paired against the route
 * **pattern** that serves it rather than against an exact path.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. `backend/test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`
 * is that half. What this file asserts about the palette is the half that is
 * the admin's: that the shell keeps no hand-written copy for the server's
 * answer to disagree with.
 */

interface Subject {
  /** The module id the presence projection is asked about. */
  readonly module: string;
  /** The landing route its `index` route declares. */
  readonly route: string;
  /** The code, or any-of codes, that open that landing route. */
  readonly permission: string | readonly string[];
  /**
   * A **real** code this module's gate must not accept — a near miss rather
   * than a straw one, so the case fails if the gate compares nothing.
   */
  readonly nearMiss: string;
  /** The module-relative label key its landing nav entry declares. */
  readonly labelKey: string;
  /** The bare specifier the generated registry must resolve it through. */
  readonly specifier: string;
  /**
   * Every nav section its entries declare, in declaration order.
   *
   * A **list**, where batch 14's table carried one section per module, because
   * `catalog` is the first converted module to contribute to two: five rows in
   * *Catalog* and `/catalog/bulk-operations` in *System*, which is where the
   * hand-written table put it (*"bulk operations may span many domains, so the
   * entry lives under System"*). Asserting one section per module would have
   * had to be relaxed to nothing for this batch; asserting the declared set is
   * the same claim with the number derived.
   */
  readonly sections: readonly string[];
  /**
   * Every route the module contributes, in declaration order, with the
   * requirement each one enforces.
   *
   * A pair rather than a path, because `orders` is this batch's split case:
   * `/orders/new` lands straight on an entry form and takes the **write** code.
   */
  readonly routes: readonly (readonly [path: string, permission: string | readonly string[]])[];
  /** Every nav destination it contributes, in declaration order. */
  readonly navTargets: readonly string[];
  /** The `_i18n` keys the shell must no longer name. */
  readonly retiredSharedKeys: readonly string[];
  /** The zones it contributes **to**, in declaration order. */
  readonly zones: readonly string[];
  /**
   * The zone members it **renders**, the moved file each mount is in, and how
   * many mounts of that member that file holds.
   *
   * The count is the field batch 14's table did not need. `ProductEditor.tsx`
   * mounts `product.editor.field.after` five times — once per editable core
   * field — and a table that only asked whether the name appears would pass
   * with four of the five deleted.
   */
  readonly mounts: readonly (readonly [file: string, member: string, count: number])[];
  /** Every surface directory it leaves behind under `admin/src/modules`. */
  readonly surfaceDirectories: readonly string[];
  /** Whether the manifest declares `activation.nonDeactivatable`. */
  readonly locked: boolean;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'catalog',
    route: '/catalog/products',
    permission: 'catalog:read',
    // The module's own write code, and the sharp near miss: every save on the
    // product editor and every bulk edit enforces it, so a gate that treated
    // the two as interchangeable would open all eight screens and pass every
    // case below.
    nearMiss: 'catalog:write',
    labelKey: 'nav.products.label',
    specifier: '@endora-commerce/mod-catalog/admin',
    sections: ['catalog', 'system'],
    routes: [
      ['/catalog/products', 'catalog:read'],
      ['/catalog/products/:id', 'catalog:read'],
      ['/catalog/categories', 'catalog:read'],
      ['/catalog/attributes', 'catalog:read'],
      ['/catalog/attribute-sets', 'catalog:read'],
      ['/catalog/attachment-types', 'catalog:read'],
      ['/catalog/bulk-operations', 'catalog:read'],
      ['/catalog/bulk-operations/:id', 'catalog:read'],
    ],
    navTargets: [
      '/catalog/products',
      '/catalog/categories',
      '/catalog/attributes',
      '/catalog/attribute-sets',
      '/catalog/attachment-types',
      '/catalog/bulk-operations',
    ],
    retiredSharedKeys: [
      'appShell.nav.products',
      'appShell.nav.categories',
      'appShell.nav.attributes',
      'appShell.nav.attributeSets',
      'appShell.nav.attachmentTypes',
      'appShell.nav.bulkOperations',
      'appShell.palette.sub.catalogRows',
      'appShell.palette.sub.categoryTree',
      'appShell.palette.sub.attributeDefinitions',
    ],
    // A host and nothing else: this module contributes to no zone.
    zones: [],
    mounts: [
      ['catalog/src/admin/pages/ProductEditor.tsx', 'product.editor.details.before', 1],
      ['catalog/src/admin/pages/ProductEditor.tsx', 'product.editor.field.after', 5],
      ['catalog/src/admin/pages/ProductEditor.tsx', 'product.editor.pricing.before', 1],
      ['catalog/src/admin/pages/ProductEditor.tsx', 'product.editor.pricing.after', 1],
      ['catalog/src/admin/pages/ProductEditor.tsx', 'product.editor.channels', 1],
      ['catalog/src/admin/components/ProductAttributesTab.tsx', 'product.editor.field.after', 1],
      ['catalog/src/admin/pages/CategoriesTree.tsx', 'category.editor.after', 1],
    ],
    surfaceDirectories: ['catalog'],
    locked: true,
  },
  {
    module: 'orders',
    route: '/orders',
    permission: 'orders:read',
    // The module's own write code: the order-entry form, the bulk status
    // dialog and every status transition enforce it, so a gate that treated the
    // two as interchangeable would open the whole surface — and it is the code
    // `/orders/new` genuinely takes, which is what makes it the sharpest
    // available here rather than merely a real one.
    nearMiss: 'orders:write',
    labelKey: 'nav.orders.label',
    specifier: '@endora-commerce/mod-orders/admin',
    sections: ['sales'],
    routes: [
      ['/orders', 'orders:read'],
      // The entry form, opened by the code the create demands — the tightening
      // this batch records, and the reason `routes` is a pair.
      ['/orders/new', 'orders:write'],
      ['/orders/statuses', 'orders:read'],
      ['/orders/:id', 'orders:read'],
    ],
    navTargets: ['/orders', '/orders/new', '/orders/statuses'],
    retiredSharedKeys: [
      'appShell.nav.orders',
      'appShell.nav.newOrder',
      'appShell.nav.orderStatuses',
      'appShell.nav.quickOrder',
      'appShell.palette.sub.openOrders',
      'appShell.crumb.detail',
    ],
    // The one contribution this module already had: P4d declared the standard
    // order-entry tab while these screens were still `App.tsx`'s.
    zones: ['order.entry.tabs'],
    mounts: [
      ['orders/src/admin/pages/OrderDetail.tsx', 'order.detail.payment', 1],
      ['orders/src/admin/components/OrderShipmentsTab.tsx', 'order.shipment.row.actions', 1],
      ['orders/src/admin/components/OrderShipmentsTab.tsx', 'order.shipments.tab.actions', 1],
      ['orders/src/admin/pages/OrderCreatePage.tsx', 'order.entry.tabs', 1],
    ],
    surfaceDirectories: ['orders'],
    locked: true,
  },
];

/**
 * The subjects an operator can genuinely switch off — **empty in this batch**.
 *
 * Derived rather than declared, and the `describe` it drives asserts the
 * emptiness rather than skipping itself: see the header.
 */
const SWITCHABLE = SUBJECTS.filter((subject) => !subject.locked);

/** Every code that opens a subject's landing route, as a list to grant. */
function codesFor(subject: Subject): readonly string[] {
  return typeof subject.permission === 'string' ? [subject.permission] : subject.permission;
}

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

const { App } = await import('../../../packages/admin-shell/src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.catalog',
    'appShell.section.sales',
    'appShell.section.system',
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

/**
 * A concrete URL for a declared route pattern.
 *
 * The deep-link cases below have to navigate somewhere real, and three of this
 * batch's twelve routes are parametric. A pattern rendered verbatim would
 * navigate to a path with a literal `:id` in it, which `react-router` matches
 * just as happily and which therefore proves the gate over a URL no operator
 * can reach.
 *
 * `sample` rather than `new`, deliberately: `/catalog/products/new` is a real
 * screen state (`ProductEditor`'s `isNew`), so substituting it would prove the
 * gate over the create form and say nothing about the edit form beside it.
 */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, 'sample');
}

/** The module's `./admin` contribution set, off the bare specifier. */
async function contributionsOf(
  subject: Subject,
): Promise<typeof import('@endora-commerce/mod-orders/admin')['contributions']> {
  const loaded = (await import(/* @vite-ignore */ subject.specifier)) as typeof import(
    '@endora-commerce/mod-orders/admin'
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
    permissions = new Set([...codesFor(subject), subject.nearMiss]);
    renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).toContain(target);
    }
    expect(
      screen.getByRole('link', { name: new RegExp(subject.labelKey.replace(/\./g, '\\.')) }),
    ).toBeTruthy();
  });

  it('renders every one of its screens at its own route while present', async () => {
    // All twelve across the batch, not the landing ones: the batch's value is
    // the whole surface moving, and a registry that dropped a route would leave
    // the landing screen answering and the rest on the admin's not-found page.
    presentModules = new Set([subject.module]);
    permissions = new Set([...codesFor(subject), subject.nearMiss]);
    for (const [pattern] of subject.routes) {
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
    // Both modules are locked, so this is not a state an operator can create —
    // it is asserted because it is what the declarations *mean* and what the
    // platform would do the day a lock is lifted (batch four's reasoning).
    presentModules = new Set();
    permissions = new Set([...codesFor(subject), subject.nearMiss]);
    const shell = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).not.toContain(target);
    }
    shell.unmount();

    for (const [pattern] of subject.routes) {
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

  it('restores both surfaces when any one of its codes is granted again', async () => {
    for (const code of codesFor(subject)) {
      presentModules = new Set([subject.module]);
      permissions = new Set([subject.nearMiss]);
      const withheld = renderAt('/');
      expect(sidebarHrefs(), code).not.toContain(subject.route);
      withheld.unmount();

      permissions = new Set([code]);
      const back = renderAt('/');
      expect(sidebarHrefs(), code).toContain(subject.route);
      back.unmount();

      const screenBack = renderAt(subject.route);
      await waitFor(() => expect(notFoundIsRendered(), code).toBe(false));
      screenBack.unmount();
    }
  });
});

describe('the operator axis, which neither module in this batch has', () => {
  it('has no switchable subject, and says so from the manifests rather than by omission', async () => {
    // **This case is the batch's first, and it is written rather than skipped.**
    // Every previous batch had at least one module an operator can switch off,
    // so `it.each(SWITCHABLE)` below always drove something; here it drives
    // nothing, and an empty `it.each` in a file this size is indistinguishable
    // from a describe somebody deleted.
    //
    // So the emptiness is asserted, and asserted **against the manifests**: the
    // day either lock is lifted, this case fails and whoever lifted it has to
    // write the operator-axis drive rather than discovering later that a
    // switchable module shipped with no proof it withdraws anything.
    expect(SWITCHABLE).toEqual([]);
    for (const subject of SUBJECTS) {
      const { manifest } = (await import(
        /* @vite-ignore */ subject.specifier.replace('/admin', '')
      )) as typeof import('@endora-commerce/mod-orders');
      expect(
        Boolean(manifest.activation && 'nonDeactivatable' in manifest.activation),
        subject.module,
      ).toBe(true);
    }
  });

  it.each(SWITCHABLE)('withdraws every $module surface when the operator switches it off', async (subject) => {
    // Drives nothing today, by the case above's own measurement. It is kept
    // rather than deleted because it is the assertion the case above says has
    // to exist the day a lock is lifted, and a test that has to be re-invented
    // is a test that will be re-invented differently.
    const others = SUBJECTS.filter((entry) => entry.module !== subject.module);
    presentModules = new Set(SUBJECTS.map((entry) => entry.module));
    permissions = new Set(SUBJECTS.flatMap((entry) => [...codesFor(entry), entry.nearMiss]));
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
    off.unmount();

    for (const [pattern] of subject.routes) {
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
    const shell = codeOf('../packages/admin-shell/src/components/AppShell.tsx');
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
    // `catalog` contributes six and a bundle short of one of them renders a
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
    // is `rmdir`. For both of these the directory also carried re-export shims
    // published members already forward — `catalog`'s `ProductPicker` and
    // `orders`' `Section`, `StatusTransitionGraph` and `orderStatusColor` — and
    // all four go with it.
    for (const directory of subject.surfaceDirectories) {
      expect(() => sourceOf(`../packages/admin-shell/src/modules/${directory}`), directory).toThrow();
    }
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', () => {
    const app = codeOf('../packages/admin-shell/src/App.tsx');
    const contributions = CONTRIBUTIONS.get(subject.module);
    expect(
      contributions?.routes?.map((route) => [route.path, route.requiredPermission]),
    ).toEqual(subject.routes.map(([path, permission]) => [path, permission]));
    for (const [path] of subject.routes) {
      expect(app, path).not.toContain(`<Route path="${path}"`);
    }
    // The import is the assertion that carries a `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile.
    // Read off the **code** rather than the source, because the comments this
    // batch left in `App.tsx` name both module directories in prose.
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

  it('gates its landing route, and its landing nav entry, on the same requirement', () => {
    // `check:action-route-permissions` holds a module's palette action to the
    // code enforced on its own `targetRoute`; the route and nav declarations
    // are the same statement one layer down, and nothing else compares them.
    const contributions = CONTRIBUTIONS.get(subject.module);
    const landing = (contributions?.routes ?? []).find((route) => route.path === subject.route);
    expect(landing?.requiredPermission).toEqual(subject.permission);
    expect(landing?.index).toBe(true);
    expect((contributions?.nav ?? []).map((nav) => nav.to)).toEqual(subject.navTargets);
    const entry = (contributions?.nav ?? []).find((nav) => nav.to === subject.route);
    expect(entry?.requiredPermission).toEqual(subject.permission);
    expect(entry?.labelKey).toBe(subject.labelKey);
    // The sections a module scatters rows across, asserted as the declared set
    // rather than as "one". `catalog` is the first module to need two, and a
    // module that grew a third fails here.
    expect([...new Set((contributions?.nav ?? []).map((nav) => nav.section))]).toEqual([
      ...subject.sections,
    ]);
  });

  it('gates every nav entry on the code its own route enforces', () => {
    // Issue #232's rule one layer down, per row rather than per module. Nothing
    // else in the estate compares a nav entry to the route beneath it, and this
    // batch is where it bites: `orders` contributes three rows over routes that
    // do **not** all carry the same code, and `/orders/new`'s row advertised
    // `orders:write` against an ungated host route until this merge request.
    const contributions = CONTRIBUTIONS.get(subject.module);
    const byPath = new Map(
      (contributions?.routes ?? []).map((route) => [route.path, route.requiredPermission]),
    );
    for (const entry of contributions?.nav ?? []) {
      expect(entry.requiredPermission, entry.to).toEqual(byPath.get(entry.to));
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

describe('the surfaces each module does not contribute, derived from the contribution set', () => {
  it.each(SUBJECTS)('$module contributes exactly the zones its declaration names', (subject) => {
    // Ruling 1: the off-state test asserts every surface the module
    // contributes, and names the ones it does not **derived from the
    // contribution set** rather than asserted. `catalog` contributes to no zone
    // at all — it is a host and nothing else — and `orders` contributes the one
    // P4d declared while its screens were still `App.tsx`'s. Asserted as an
    // equality, so a zone silently dropped in the move fails here;
    // `order-entry-tabs-zone.test.tsx` drives that one over the real provider.
    const contributions = CONTRIBUTIONS.get(subject.module);
    expect((contributions?.zones ?? []).map((zone) => zone.zone)).toEqual(subject.zones);
  });

  it.each(SUBJECTS)('$module contributes a sidebar row for every section it names', (subject) => {
    // The derived negative. A section this module names and puts no row in is a
    // heading with nothing under it, and `catalog` is the batch's case: it
    // names two, and a row lost from *System* would leave `/catalog/bulk-operations`
    // reachable only by URL while the declaration still claimed the section.
    const entries = CONTRIBUTIONS.get(subject.module)?.nav ?? [];
    for (const section of subject.sections) {
      expect(entries.some((entry) => entry.section === section), section).toBe(true);
    }
  });
});

describe('the two hosts still mount their zones from inside their packages', () => {
  it.each(SUBJECTS)('$module renders every zone member it hosts, as many times as it did', (subject) => {
    // **The assertion this batch exists for**, and the one that is counted
    // rather than merely found. `ProductEditor.tsx` mounts
    // `product.editor.field.after` five times, once per editable core field; a
    // table that only asked whether the member appears would pass with four of
    // the five deleted, and `check:admin-zones` would agree with it — the
    // member is still rendered, so it is not `unrendered-zone`.
    for (const [file, member, count] of subject.mounts) {
      const source = sourceOf(`../packages/modules/${file}`);
      const found = source.match(new RegExp(`name="${member.replace(/\./g, '\\.')}"`, 'g')) ?? [];
      expect(found.length, `${file}: ${member}`).toBe(count);
      expect(source, member).toContain("from '@endora-commerce/admin-kit/zones'");
    }
  });

  it.each(SUBJECTS)('$module names no zone member the enum does not carry', async (subject) => {
    // The other direction, off the published enum rather than off this table.
    // `AdminZoneNameSchema` is what `check:admin-zones` reconciles renders
    // against; a mount naming a member it does not carry is `unpublished-zone`
    // there and a typo here, and comparing the two is what stops this table
    // being a second author of the same fact.
    const { AdminZoneNameSchema } = await import('@endora-commerce/admin-kit/contributions');
    const published = new Set(AdminZoneNameSchema.options as readonly string[]);
    for (const [, member] of subject.mounts) {
      expect(published.has(member), member).toBe(true);
    }
    for (const member of subject.zones) {
      expect(published.has(member), member).toBe(true);
    }
  });

  it('mounts the order-entry strip through the kit’s tab renderer, not a bare zone', () => {
    // `order.entry.tabs` is the one member in this batch whose host mount is a
    // `<RouteTabsZone>` rather than an `<AdminZone>`: the strip counts what the
    // hook already filtered and renders nothing when fewer than two tabs
    // survive. Asserted on its own because the case above matches `name="…"`,
    // which both elements carry — so it would pass with the strip degraded to a
    // plain zone, which would render one tab as a lone tab.
    const source = sourceOf('../packages/modules/orders/src/admin/pages/OrderCreatePage.tsx');
    expect(source).toMatch(/<RouteTabsZone\s+name="order\.entry\.tabs"/);
  });
});

describe('the one route that tightens says so in its own declaration', () => {
  it('opens the order-entry form on the code the entry demands', () => {
    // Asserted on its own rather than folded into the equality above, because
    // an equality passes whichever way the split falls and this is the batch's
    // one operator-visible tightening. `/orders/new` was `App.tsx`'s and
    // therefore ungated, while the sidebar row that advertised it and the
    // `order.entry.tabs` contribution P4d declared both carried `orders:write`.
    const routes = CONTRIBUTIONS.get('orders')?.routes ?? [];
    const byPath = new Map(routes.map((route) => [route.path, route.requiredPermission]));
    expect(byPath.get('/orders/new')).toBe('orders:write');
    expect(byPath.get('/orders/statuses')).toBe('orders:read');
    expect(byPath.get('/orders/:id')).toBe('orders:read');
    expect(byPath.get('/orders')).toBe('orders:read');
  });

  it('leaves the product create form on the edit route, which is where it lives', () => {
    // The other half, and it is a **non**-change stated so it cannot be read as
    // an omission. `catalog`'s `new-product` action targets
    // `/catalog/products/new`, and there is no such route: the create form is
    // `/catalog/products/:id` with the id `new`, which `ProductEditor`'s own
    // `isNew` reads. Declaring a static route beside it would be inventing a
    // route in a batch whose job is to move one — and it would tighten
    // `catalog:read` to `catalog:write` for a screen an operator reaches from a
    // list they can already open.
    const paths = new Set((CONTRIBUTIONS.get('catalog')?.routes ?? []).map((r) => r.path));
    expect(paths.has('/catalog/products/new')).toBe(false);
    expect(paths.has('/catalog/products/:id')).toBe(true);
    const editor = sourceOf('../packages/modules/catalog/src/admin/pages/ProductEditor.tsx');
    expect(editor).toContain("params.id === 'new'");
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  const MOVED = [
    'catalog/src/admin/pages/AttachmentTypesPage.tsx',
    'catalog/src/admin/pages/AttributeSetsPage.tsx',
    'catalog/src/admin/pages/AttributesManager.tsx',
    'catalog/src/admin/pages/BulkOperationDetailPage.tsx',
    'catalog/src/admin/pages/BulkOperationsPage.tsx',
    'catalog/src/admin/pages/CategoriesTree.tsx',
    'catalog/src/admin/pages/ProductEditor.tsx',
    'catalog/src/admin/pages/ProductsList.tsx',
    'catalog/src/admin/components/PackagingUnitsEditor.tsx',
    'catalog/src/admin/components/ProductAttributesTab.tsx',
    'catalog/src/admin/components/ProductInventoryTab.tsx',
    'catalog/src/admin/components/ProductScopeEditor.tsx',
    'catalog/src/admin/components/ProductsBulkEditDialog.tsx',
    'catalog/src/admin/lib/resolve-product-selection.ts',
    'orders/src/admin/pages/OrderCreatePage.tsx',
    'orders/src/admin/pages/OrderDetail.tsx',
    'orders/src/admin/pages/OrderStatusConfigPage.tsx',
    'orders/src/admin/pages/OrdersList.tsx',
    'orders/src/admin/components/OrderSavedViews.tsx',
    'orders/src/admin/components/OrderShipmentsTab.tsx',
    'orders/src/admin/components/OrdersBulkStatusDialog.tsx',
    'orders/src/admin/components/StatusColorPicker.tsx',
    'orders/src/admin/lib/paymentStatus.ts',
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
    // The row's claim, asserted rather than restated. `check:module-boundary`
    // refuses an *unledgered* reach; what it cannot say is that the conversion
    // did not swap a relative import for a package one, which is the shape
    // `module-package-layout.md` §0 measured as looking like progress. So: no
    // module package names another anywhere in these files.
    const reaching = MOVED.filter((file) =>
      codeOf(`../packages/modules/${file}`).includes('@endora-commerce/mod-'),
    );
    expect(reaching).toEqual([]);
  });

  it('keeps the four published members one copy, the kit’s own', () => {
    // Four re-export shims stood in these two directories and go with them:
    // `catalog`'s `components/ProductPicker.tsx` (P2), `orders`'
    // `StatusTransitionGraph.tsx` (batch 8), `Section.tsx` (P8) and
    // `orderStatusColor.ts` (P8). Each forwarded a member the kit publishes,
    // and once the directory is gone the old spelling resolves to nothing — so
    // the moved files have to name the subpath directly, which is what this
    // asserts rather than that the shims are absent (the directory case above
    // says that).
    const editor = codeOf('../packages/modules/catalog/src/admin/pages/ProductEditor.tsx');
    expect(editor).toContain("from '@endora-commerce/admin-kit/components'");
    const statuses = codeOf('../packages/modules/orders/src/admin/pages/OrderStatusConfigPage.tsx');
    expect(statuses).toContain("from '@endora-commerce/admin-kit/components'");
    expect(statuses).toContain("from '@endora-commerce/admin-kit/lib'");
    const shipments = codeOf('../packages/modules/orders/src/admin/components/OrderShipmentsTab.tsx');
    expect(shipments).toContain("from '@endora-commerce/admin-kit/ui'");
  });
});
