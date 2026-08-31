import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readdirSync, readFileSync } from 'node:fs';
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
 * `product_feeds` is the heaviest member of feature 091's Phase 4 batch 7 on
 * the route axis — **ten** routes behind **one** sidebar entry — and this is
 * the off-state proof `contracts/admin-contribution.md` R15 asks of a converted
 * module.
 *
 * **Nine of the ten routes have no sidebar row and never will.** Templates,
 * category mapping and taxonomy revisions are reached through the tab strip on
 * the feeds page; the run, detail and editor screens are reached from a list. A
 * nav entry is a landing surface, so a file that only drove `/product-feeds`
 * would pass with nine deep links ungated — and a deep link is exactly what an
 * operator following a stale bookmark meets. Every one of the ten is asserted.
 *
 * The **palette actions** are the server's — `open-product-feeds`,
 * `create-product-feed`, `open-feed-templates` and two more — resolved by
 * `AdminActionsService` against the effective enabled-set, and are proved in
 * `backend/test/integration/product_feeds/module-owned-surface-off-state.test.ts`.
 *
 * The permission axis is driven beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['product_feeds']);
let permissions = new Set<string>(['product_feeds:read']);

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

const FEED_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Every one of the ten screens reads on mount, and this file's subject is the
 * **gate** rather than the data. The client therefore never settles, and that is
 * a decision rather than laziness — the two obvious alternatives were both
 * measured and both are wrong here.
 *
 * A single `{ data: [] }` answer is not neutral: the ten screens read six
 * different envelopes, and an empty array satisfies the `try` on the way in, so
 * `ProductFeedDetailPage` sets `feed` to an array and `FeedLinkCard` reads
 * `feed.token.revokedAt` off `undefined`. That surfaced as an unhandled error in
 * one run of three, because it is a race with the unmount.
 *
 * A **rejecting** client is worse, and what it found is worth recording rather
 * than working around silently: `ProductFeedCreatePage.tsx:47` and
 * `CategoryMappingPage.tsx:61` load with `void client.x().then(…)` and no
 * `.catch`, so a failed request is an unhandled rejection rather than an error
 * state — a live defect in two screens this batch moved and did not write. It is
 * reported rather than repaired here; a test that hid it would be the worse
 * outcome, and a test that reproduced it every run would be an unhandled error
 * in every pipeline.
 *
 * A pending promise is the only answer that is neutral for all ten: every screen
 * stays in its own loading state, which is still a **screen**, and that is the
 * whole of what the positive control below claims. The screens' own data
 * behaviour is covered by the eleven tests under `test/modules/product_feeds/`,
 * which drive the module's client directly.
 *
 * The mock is at the kit's barrel, which is the specifier the packaged screens
 * resolve; the admin resolves the same module, so one mock covers both sides of
 * the move.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  const pending = (): Promise<never> => new Promise<never>(() => undefined);
  return {
    ...actual,
    apiClient: { get: pending, post: pending, put: pending, patch: pending, delete: pending },
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
    'appShell.section.catalog',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('product_feeds', [
    'nav.productFeeds.label',
    'page.title',
    'page.subtitle',
    'create.title',
    'templates.title',
    'templates.startFrom.title',
    'templates.import.title',
    'editor.title',
    'mapping.title',
    'revisions.title',
    'runs.detail.title',
  ]),
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

/** Every route the module declares, in its own declaration order. */
const ROUTES: readonly string[] = [
  '/product-feeds',
  '/product-feeds/new',
  '/product-feeds/templates',
  '/product-feeds/templates/new',
  '/product-feeds/templates/import',
  `/product-feeds/templates/${TEMPLATE_ID}`,
  '/product-feeds/category-mapping',
  '/product-feeds/taxonomy-revisions',
  `/product-feeds/${FEED_ID}/runs/${RUN_ID}`,
  `/product-feeds/${FEED_ID}`,
];

describe('product_feeds owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['product_feeds']);
    permissions = new Set(['product_feeds:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/product-feeds');
    // The label resolves in the **module's** namespace, not in `core`: its
    // `appShell.nav.productFeeds` entry is gone from the shared `_i18n` bundle.
    expect(screen.getByRole('link', { name: /nav\.productFeeds\.label/ })).toBeTruthy();
  });

  it('renders a screen rather than the not-found treatment at every one of its routes', async () => {
    // The positive control for the nine sub-routes, and it is deliberately an
    // assertion about `NotFoundPage` rather than about each screen's own
    // heading: ten headings would be ten more strings to keep current, and what
    // the off-state case below negates is exactly this — that the route
    // resolves at all. The `waitFor` is what makes it non-vacuous: the lazy
    // chunk has to have loaded and replaced `app.moduleScreenLoading` before
    // anything is judged, so a screen that never mounted fails here rather than
    // passing as "not the not-found page".
    presentModules = new Set(['product_feeds']);
    permissions = new Set(['product_feeds:read']);
    for (const path of ROUTES) {
      const rendered = renderAt(path);
      await waitFor(() =>
        expect(screen.queryAllByText(/app\.moduleScreenLoading/).length === 0).toBe(true),
      );
      expect(notFoundIsRendered(), `${path} must resolve to a screen`).toBe(false);
      rendered.unmount();
    }
  });

  it('contributes no surface while the module is switched off — every deep link included', async () => {
    // Principle XVII item 5, over every surface the module contributes. The
    // registry still names it — it answers "what could be here" — and the
    // render is what withdraws it, so an operator's activation flip needs no
    // rebuild.
    presentModules = new Set();
    permissions = new Set(['product_feeds:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/product-feeds');
    shell.unmount();

    for (const path of ROUTES) {
      const rendered = renderAt(path);
      await waitFor(() => expect(notFoundIsRendered()).toBe(true));
      rendered.unmount();
    }
  });

  it('contributes no surface to an operator without the code its routes enforce', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `catalog:read` is a
    // real code and the sharpest near miss this module has — three of its
    // routes require it *in addition to* `product_feeds:read`, so holding it
    // alone is the state an operator who can see products but not feeds is
    // actually in. The codes are opaque strings.
    presentModules = new Set(['product_feeds']);
    permissions = new Set(['catalog:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/product-feeds');
    shell.unmount();

    for (const path of ROUTES) {
      const rendered = renderAt(path);
      await waitFor(() => expect(notFoundIsRendered()).toBe(true));
      rendered.unmount();
    }
  });

  it('does not open its screens to the write code alone', async () => {
    // `product_feeds:write` is a real code this module declares — it gates
    // generation, rotation, revocation and the download that carries prices —
    // and it is not what its read routes enforce. Without this case a
    // declaration that named the write code would pass every assertion above.
    presentModules = new Set(['product_feeds']);
    permissions = new Set(['product_feeds:write']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/product-feeds');
    shell.unmount();

    const rendered = renderAt('/product-feeds');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    rendered.unmount();
  });

  it('restores every surface when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['product_feeds:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/product-feeds');
    off.unmount();

    presentModules = new Set(['product_feeds']);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain('/product-feeds');
    back.unmount();

    const deepLink = renderAt('/product-feeds/templates');
    await waitFor(() =>
      expect(screen.queryAllByText(/app\.moduleScreenLoading/).length === 0).toBe(true),
    );
    expect(notFoundIsRendered()).toBe(false);
    deepLink.unmount();
  });

  it('keeps its position last in the Catalog section', () => {
    // The entry's position does not change: `/product-feeds` was the last row
    // of *Catalog* and every other row there is still host-declared, so
    // `composeNav` appends the registry's after all of them — which is exactly
    // where the hand-written table had it. The declared weight (1000) is what
    // will keep it there once that section's other rows convert.
    presentModules = new Set(['product_feeds', 'catalog']);
    permissions = new Set(['product_feeds:read', 'catalog:read']);
    renderAt('/');
    const hrefs = sidebarHrefs().filter((href) => href !== null);
    expect(hrefs.indexOf('/catalog/products')).toBeLessThan(hrefs.indexOf('/product-feeds'));
  });
});

describe('the shell no longer names product_feeds by hand', () => {
  it('has no host route, nav entry or breadcrumb rule for any of the ten screens', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither declares any of the ten now, and both are still there.
    // Leaving one standing would declare it twice, with `react-router` silently
    // taking the first match.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    for (const component of [
      '<ProductFeedsListPage',
      '<ProductFeedCreatePage',
      '<ProductFeedDetailPage',
      '<FeedTemplatesListPage',
      '<FeedTemplateStartFromPage',
      '<FeedTemplateEditorPage',
      '<FeedTemplateImportPage',
      '<FeedRunDetailPage',
      '<CategoryMappingPage',
      '<TaxonomyRevisionsPage',
    ]) {
      expect(app).not.toContain(component);
    }
    expect(app).not.toContain('modules/product_feeds');
    expect(shell).not.toContain("to: '/product-feeds'");
    expect(shell).not.toContain('appShell.nav.productFeeds');
    // `CRUMB_DICT`'s ten rules for this module go, so `registryCrumbs` derives
    // the trail from the nav contribution instead.
    expect(shell).not.toContain('\\/product-feeds');
  });

  it('derives the sub-screens’ breadcrumbs from the nav contribution', () => {
    // The operator-visible consequence this conversion carries, asserted rather
    // than left to a reader of the plan, and it is the largest in the batch:
    // ten hand-written trails go, some of which built four crumbs (the
    // taxonomy-revisions rule named section, feeds, category mapping and the
    // leaf). `registryCrumbs` matches anything beneath a contributed entry's
    // `to` and builds two — the section, and the entry itself as a link back to
    // the list. The trail still leads home; it is shorter, and the intermediate
    // *Feed templates* step is what it loses.
    presentModules = new Set(['product_feeds']);
    permissions = new Set(['product_feeds:read']);
    renderAt('/product-feeds/templates');
    const crumbs = [...document.querySelectorAll('.b2b-topbar__crumbs a.crumb-link')].map((a) =>
      a.getAttribute('href'),
    );
    expect(crumbs).toContain('/product-feeds');
    expect(
      document.querySelectorAll('.b2b-topbar__crumbs .crumb-link, .b2b-topbar__crumbs .crumb-cur'),
    ).toHaveLength(2);
  });

  it('resolves every screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-product-feeds/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('gates all ten routes and the nav entry on the code its own API enforces', async () => {
    // `check:action-route-permissions` holds this module's palette actions to
    // the code enforced on their own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. Every read handler across `routes.admin.ts`,
    // `routes.templates.ts`, `routes.taxonomies.ts` and `routes.delivery.ts` is
    // behind `deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION)`.
    const { contributions } = await import('@endora-commerce/mod-product-feeds/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual([
      '/product-feeds',
      '/product-feeds/new',
      '/product-feeds/templates',
      '/product-feeds/templates/new',
      '/product-feeds/templates/import',
      '/product-feeds/templates/:templateId',
      '/product-feeds/category-mapping',
      '/product-feeds/taxonomy-revisions',
      '/product-feeds/:feedId/runs/:runId',
      '/product-feeds/:feedId',
    ]);
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe('product_feeds:read');
      // FR-013: the only function-valued field is a dynamic-import factory, so
      // Vite has a split point whether or not anybody asks for one.
      expect(typeof route.component).toBe('function');
    }
    expect(contributions.nav?.[0]?.requiredPermission).toBe('product_feeds:read');
    expect(contributions.nav?.[0]?.section).toBe('catalog');
  });

  it('rebuilt the sales-channel reach rather than renaming it', () => {
    // The one ledger key this batch pays. `ProductFeedCreatePage.tsx` imported
    // `salesChannelsClient` from `@/modules/sales_channels/api/…`; the shard's
    // own retiring condition says the exit is not a rewritten specifier but the
    // caller building the request from the published `apiClient` and the
    // contract's own types. So the screen must name neither the alias nor a
    // package specifier into `sales_channels` — the second would be the same
    // coupling under a supported name — and the two calls have to exist here.
    const page = sourceOf(
      '../packages/modules/product_feeds/src/admin/pages/ProductFeedCreatePage.tsx',
    );
    expect(page).not.toContain('sales_channels');
    expect(page).toContain('feedSalesChannelReads');
    const client = sourceOf('../packages/modules/product_feeds/src/admin/api.ts');
    expect(client).toContain("'/api/v1/admin/sales-channels'");
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install. The **whole layer** is walked rather than a list of
    // files: this module ships more of them than its three batch-mates put
    // together, and a list here would be a roster somebody has to keep current
    // — the one shape that goes stale silently.
    const layer = resolve(process.cwd(), '../packages/modules/product_feeds/src/admin');
    const files = readdirSync(layer, { recursive: true, encoding: 'utf8' }).filter((entry) =>
      /\.tsx?$/.test(entry),
    );
    // A walk that came back empty would pass every assertion below (issue
    // #113): the floor is that it found the ten pages plus the declaration.
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(resolve(layer, file), 'utf8');
      expect(source, file).not.toMatch(/^import .* from '@\//m);
      expect(source, file).not.toMatch(/^import .* from '@endora-commerce\/mod-/m);
    }
  });
});
