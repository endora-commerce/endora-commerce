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
 * 091 batch 14's three converted modules — `customers`, `organizations` and
 * `sales_channels`.
 *
 * ## What is different about this batch
 *
 * Eight routes and six registrations, and all three modules are zone **hosts**:
 * `CustomerDetail.tsx` renders `customer.detail.after`,
 * `OrganizationDetail.tsx` renders `organization.detail.after` and
 * `SalesChannelEditPage.tsx` renders `sales_channel.editor.after` — the three
 * members P7b and P7c published — with six contributions between them from four
 * modules this batch does not move.
 *
 * That is batch 13's property read from the other end.
 * `check:admin-registrations` counts routes and nav entries and a zone is
 * neither, so a **host** is schedulable independently of its contributors
 * exactly as a contributor is of its host. Which makes the mounts this file's
 * own subject: a screen that moved into a package and stopped rendering its
 * `<AdminZone>` would leave four modules' panels contributing to a place
 * nothing mounts, and `check:admin-zones` would report it as
 * `unrendered-zone` — so the mount is asserted here as **text in the moved
 * file** and driven, over the real provider, in each contributor's own zone
 * file.
 *
 * ## The drain is zero, and it is zero because the publications paid it
 *
 * Re-derived on this branch before anything moved: none of the three owns a
 * `cross-module-imports` shard, none is named as a target by one — P7a, P7b and
 * P7c retired `customers.ts` and `organizations.ts` outright, and the four
 * shards that stand are `blog`'s, `catalog`'s, `inventory`'s and `settings`' —
 * `backend/scripts/ledgers/admin-surface.ts` is empty and
 * `foreign-module-ids.ts` names none of them. `check:module-boundary` reads
 * `cross-module reaches=7 (imports=3 sql=4) ledger-size=7 shards=4` on both
 * sides of the move, and that agreement is the measurement rather than a
 * silence.
 *
 * ## Two of the three are locked, and the third is not
 *
 * `organizations` declares `activation.nonDeactivatable` (*"the single unit of
 * tenancy"*) and so does `sales_channels` (*"channel scoping is structural"*),
 * so an operator cannot produce their off state and the operator-axis describe
 * below excludes both — **derived from the manifest**, never from the table, so
 * a module locked or unlocked one day fails here rather than quietly keeping a
 * row that says otherwise. The platform axis is still asserted for them: that
 * state is not one an operator can create, but it is what the declarations
 * *mean* and what the platform would do the day a lock is lifted (batch four's
 * reasoning, arriving again).
 *
 * ## One permission requirement is an any-of pair, and that is not an accident
 *
 * `/organizations` is gated by
 * `requireAdminAny(['customers:read', 'customers:manage'])`, so its route and
 * nav declarations carry the pair rather than the read code alone — naming only
 * the read code hid the screen from a role holding just `customers:manage`
 * until 2026-08-29. `AdminNavDeclaration.requiredPermission` takes the whole
 * `PermissionRequirement` for exactly this. The manifest **action** cannot:
 * `ModuleActionSchema.requiredPermission` is a single string, so
 * `open-organizations` names `customers:read` and the narrowing is recorded
 * where the palette row used to stand.
 *
 * ## One route tightens, and it is recorded rather than glossed
 *
 * `/sales-channels/new` lands straight on a create form and now takes
 * `sales_channels:write` — `credentials`' shape from batch 10, and the code
 * this module's own `new-sales-channel` action already declared. It was
 * `App.tsx`'s and therefore **ungated**, so a read-only operator could open a
 * form whose save would refuse; the roster's *+ New channel* button was ungated
 * for the same reason and is gated on the same code in this merge request, so
 * the dead end is closed at both ends. The pair is asserted per route below,
 * which is why `routes` carries a requirement rather than a path.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. `backend/test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`
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
  /** The nav section its entries declare. */
  readonly section: string;
  /**
   * Every route the module contributes, in declaration order, with the
   * requirement each one enforces.
   *
   * A pair rather than a path, because `sales_channels` is the batch's split
   * case: `/sales-channels/new` lands straight on a create form and takes the
   * **write** code, which is `credentials`' shape from batch 10 and which a
   * list of paths alone could not say.
   */
  readonly routes: readonly (readonly [path: string, permission: string | readonly string[]])[];
  /** Every nav destination it contributes, in declaration order. */
  readonly navTargets: readonly string[];
  /** The `_i18n` keys the shell must no longer name. */
  readonly retiredSharedKeys: readonly string[];
  /** The zones it contributes **to**, in declaration order. */
  readonly zones: readonly string[];
  /**
   * The zone members it **renders**, and the moved file each mount is in.
   *
   * This is the field batch 13's table did not need: these three are hosts, so
   * what the move can break is a mount rather than a contribution.
   */
  readonly mounts: readonly (readonly [file: string, member: string])[];
  /** Every surface directory it leaves behind under `admin/src/modules`. */
  readonly surfaceDirectories: readonly string[];
  /** Whether the manifest declares `activation.nonDeactivatable`. */
  readonly locked: boolean;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'customers',
    route: '/customers',
    permission: 'customers:read',
    // The module's own write code, and the sharp near miss: every moderation
    // control on the detail screen enforces it, so a gate that treated the two
    // as interchangeable would open all three screens and pass every case
    // below.
    nearMiss: 'customers:manage',
    labelKey: 'nav.customers.label',
    specifier: '@endora-commerce/mod-customers/admin',
    section: 'customers',
    routes: [
      ['/customers', 'customers:read'],
      ['/customers/online', 'customers:read'],
      ['/customers/:id', 'customers:read'],
    ],
    navTargets: ['/customers', '/customers/online'],
    retiredSharedKeys: ['appShell.nav.customers', 'appShell.nav.customersOnline'],
    // A host and nothing else: this module contributes to no zone.
    zones: [],
    mounts: [['customers/src/admin/pages/CustomerDetail.tsx', 'customer.detail.after']],
    surfaceDirectories: ['customers'],
    locked: false,
  },
  {
    module: 'organizations',
    route: '/organizations',
    // Any-of, because the route is any-of — see the header.
    permission: ['customers:read', 'customers:manage'],
    // This module's own dedicated code (D-166), which gates the three
    // `/organizations/:id/sales-reps` endpoints and opens no screen on its own.
    // A real code an operator can hold, so the case fails if the gate compares
    // nothing.
    nearMiss: 'organizations:assign-sales-rep',
    labelKey: 'nav.organizations.label',
    specifier: '@endora-commerce/mod-organizations/admin',
    section: 'customers',
    routes: [
      ['/organizations', ['customers:read', 'customers:manage']],
      ['/organizations/:id', ['customers:read', 'customers:manage']],
    ],
    navTargets: ['/organizations'],
    retiredSharedKeys: [
      'appShell.nav.organizations',
      'appShell.palette.sub.customerAccounts',
    ],
    zones: [],
    mounts: [
      ['organizations/src/admin/pages/OrganizationDetail.tsx', 'organization.detail.after'],
    ],
    surfaceDirectories: ['organizations'],
    locked: true,
  },
  {
    module: 'sales_channels',
    route: '/sales-channels',
    permission: 'sales_channels:read',
    // The module's own write code: every mutation on the channel API enforces
    // it and each screen gates its save controls on it, so a gate that treated
    // the two as interchangeable would open all three screens.
    nearMiss: 'sales_channels:write',
    labelKey: 'nav.salesChannels.label',
    specifier: '@endora-commerce/mod-sales-channels/admin',
    section: 'channels',
    routes: [
      ['/sales-channels', 'sales_channels:read'],
      // The create form, opened by the code the create demands — the
      // tightening this batch records, and the reason `routes` is a pair.
      ['/sales-channels/new', 'sales_channels:write'],
      ['/sales-channels/:code', 'sales_channels:read'],
    ],
    navTargets: ['/sales-channels'],
    retiredSharedKeys: [
      'appShell.nav.salesChannels',
      'appShell.palette.sub.storefrontChannels',
    ],
    // The one module in this batch that is a contributor as well as a host —
    // P7a and P7b gave it these two while its screens were still `App.tsx`'s.
    zones: ['product.editor.channels', 'organization.detail.after'],
    mounts: [
      ['sales_channels/src/admin/pages/SalesChannelEditPage.tsx', 'sales_channel.editor.after'],
    ],
    surfaceDirectories: ['sales_channels'],
    locked: true,
  },
];

/** The one module an operator can genuinely switch off. */
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
    'appShell.section.customers',
    'appShell.section.channels',
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
 * The deep-link cases below have to navigate somewhere real, and two of this
 * batch's eight routes are parametric. A pattern rendered verbatim would
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
): Promise<typeof import('@endora-commerce/mod-customers/admin')['contributions']> {
  const loaded = (await import(/* @vite-ignore */ subject.specifier)) as typeof import(
    '@endora-commerce/mod-customers/admin'
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
    // All eight across the batch, not the landing ones: the batch's value is
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
    // `organizations` and `sales_channels` are locked, so this is not a state
    // an operator can create — it is asserted because it is what the
    // declarations *mean* and what the platform would do the day a lock is
    // lifted (batch four's reasoning).
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
    // real code, so the case fails if the gate compares nothing — and for
    // `organizations` it is the sharpest available, because the gate is an
    // any-of pair and a straw code would not tell an any-of gate from an
    // ungated one.
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
    // Any one, not the first: `/organizations` is an any-of pair, so the claim
    // the declaration makes is that **either** code opens it. Asserting only
    // `customers:read` would pass with the array silently collapsed to its
    // first member — which is the defect the pair exists to prevent, one layer
    // down.
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

describe('the switchable module withdraws everything the operator switches off', () => {
  it.each(SWITCHABLE)('withdraws every $module surface when the operator switches it off', async (subject) => {
    // The frontend answers both axes from one presence projection, so the
    // assertion has the shape of the platform case above — what differs is that
    // an operator can produce this state at runtime, which is what Constitution
    // XVII item 5 is about. The server half, where a deactivation is a real
    // Setting write, is
    // `backend/test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`.
    //
    // The other subjects stay present throughout, so what is withdrawn is this
    // module's surface and not the shell's — a control the platform case above
    // cannot have, because there nothing is present at all.
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
    for (const other of others) {
      for (const target of other.navTargets) {
        expect(sidebarHrefs(), target).toContain(target);
      }
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
    // `customers` contributes two and a bundle short of one of them renders a
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
    // is `rmdir`. For `sales_channels` the directory also carried four `index.ts`
    // barrels exporting `export {}` and the `admin/src` copy of
    // `DefaultChannelBadge`, whose retiring condition
    // `organization-channels-zone.test.tsx` named as this batch — all six files
    // go with it.
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
    // batch left in `App.tsx` name all three module directories in prose.
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
    expect(entry?.section).toBe(subject.section);
    expect(entry?.labelKey).toBe(subject.labelKey);
    // Every entry sits in the one section this module declares — a module
    // scattering rows across sections is a sidebar an operator cannot predict.
    for (const nav of contributions?.nav ?? []) {
      expect(nav.section, nav.to).toBe(subject.section);
    }
  });

  it('gates every nav entry on the code its own route enforces', () => {
    // Issue #232's rule one layer down, per row rather than per module. Nothing
    // else in the estate compares a nav entry to the route beneath it, and
    // `customers` is the case that needs it: two rows, two routes, and a
    // mismatch on the second would advertise a screen the gate then refuses.
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

describe('the axis each module has is read off its manifest, never carried in this table', () => {
  it.each(SUBJECTS)('$module declares the activation shape this file assumes', async (subject) => {
    // `plan.md`'s Ruling 2, asserted rather than restated. What a lock would
    // remove is the **operator's** ability to make `isPresent` answer `false`;
    // one of this batch's three is switchable and two are not, so reading it
    // here is what makes a module locked or unlocked one day fail this file
    // instead of quietly keeping a table row that says otherwise — and
    // `SWITCHABLE` above, which decides who the operator-axis describe drives,
    // is derived from the same field.
    const { manifest } = (await import(
      /* @vite-ignore */ subject.specifier.replace('/admin', '')
    )) as typeof import('@endora-commerce/mod-customers');
    const activation = manifest.activation;
    const locked = Boolean(activation && 'nonDeactivatable' in activation);
    expect(locked).toBe(subject.locked);
    expect(activation).toBeDefined();
  });
});

describe('the surfaces each module does not contribute, derived from the contribution set', () => {
  it.each(SUBJECTS)('$module contributes exactly the zones its declaration names', (subject) => {
    // Ruling 1: the off-state test asserts every surface the module
    // contributes, and names the ones it does not **derived from the
    // contribution set** rather than asserted. Two of this batch contribute to
    // no zone at all — they are hosts and nothing else — and the third
    // contributes two, which P7a and P7b declared while its screens were still
    // `App.tsx`'s. Asserted as an equality, so a zone silently dropped in the
    // move fails here; `product-channels-zone.test.tsx` and
    // `organization-channels-zone.test.tsx` drive both over the real provider.
    const contributions = CONTRIBUTIONS.get(subject.module);
    expect((contributions?.zones ?? []).map((zone) => zone.zone)).toEqual(subject.zones);
  });

  it.each(SUBJECTS)('$module contributes a sidebar row for every section it names', (subject) => {
    // The derived negative, written as a derivation rather than a table row:
    // every module in this batch declares exactly one section and at least one
    // row in it, so a module that grew a second section or lost its last row
    // fails here instead of the table silently disagreeing with the
    // declaration.
    const entries = CONTRIBUTIONS.get(subject.module)?.nav ?? [];
    expect(entries.length > 0).toBe(true);
    expect([...new Set(entries.map((entry) => entry.section))]).toEqual([subject.section]);
  });
});

describe('the three hosts still mount their zones from inside their packages', () => {
  it.each(SUBJECTS)('$module renders every zone member it hosts', (subject) => {
    // **The assertion this batch exists for.** These three are the hosts P7b
    // and P7c published mounts for, and six contributions from four modules
    // land in them. A screen that moved into a package and lost its
    // `<AdminZone>` on the way would leave those contributions rendering
    // nowhere — `check:admin-zones` would call the member `unrendered-zone` and
    // every contribution to it `contribution-to-unrendered-zone`, which is a
    // build failure rather than a silence, but only once somebody runs it.
    // Here it is a test, in the file whose subject is the move.
    for (const [file, member] of subject.mounts) {
      const source = sourceOf(`../packages/modules/${file}`);
      expect(source, member).toContain(`name="${member}"`);
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
});

describe('the one route that tightens says so in its own declaration', () => {
  it('opens the sales-channel create form on the code the create demands', () => {
    // Asserted on its own rather than folded into the equality above, because
    // an equality passes whichever way the split falls and this is the batch's
    // one operator-visible tightening. `/sales-channels/new` is a screen whose
    // only purpose is a write; the editor beside it opens on the read code, and
    // asserting both is what makes the split a decision rather than a typo.
    const routes = CONTRIBUTIONS.get('sales_channels')?.routes ?? [];
    const byPath = new Map(routes.map((route) => [route.path, route.requiredPermission]));
    expect(byPath.get('/sales-channels/new')).toBe('sales_channels:write');
    expect(byPath.get('/sales-channels/:code')).toBe('sales_channels:read');
    expect(byPath.get('/sales-channels')).toBe('sales_channels:read');
  });

  it('gates the roster’s create button on the same code, so the link is no dead end', () => {
    // The other end of the tightening. A button that navigates to a route the
    // operator's codes cannot open is worse than the ungated form it replaces:
    // the refusal arrives as the admin's not-found page, which says nothing
    // about permissions at all.
    const roster = codeOf(
      '../packages/modules/sales_channels/src/admin/pages/SalesChannelsListPage.tsx',
    );
    expect(roster).toContain("hasPermission('sales_channels:write')");
    expect(roster).toMatch(/canWrite \? \(\s*<Button asChild>/);
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  const MOVED = [
    'customers/src/admin/pages/CustomerDetail.tsx',
    'customers/src/admin/pages/CustomersList.tsx',
    'customers/src/admin/pages/OnlineCustomers.tsx',
    'customers/src/admin/panels/HistoryPanels.tsx',
    'customers/src/admin/panels/ManagementPanels.tsx',
    'organizations/src/admin/components/OrganizationSalesRepsTab.tsx',
    'organizations/src/admin/pages/OrganizationDetail.tsx',
    'organizations/src/admin/pages/OrganizationsList.tsx',
    'organizations/src/admin/panels/ApplicablePriceListsPanel.tsx',
    'organizations/src/admin/panels/FulfilmentStrategyPanel.tsx',
    'organizations/src/admin/panels/HierarchyPanel.tsx',
    'organizations/src/admin/panels/ModerationActionsPanel.tsx',
    'organizations/src/admin/panels/RestrictionsPanel.tsx',
    'organizations/src/admin/panels/VatValidationPanel.tsx',
    'sales_channels/src/admin/api/sales-channels-client.ts',
    'sales_channels/src/admin/components/ChannelIdentityForm.tsx',
    'sales_channels/src/admin/pages/SalesChannelEditPage.tsx',
    'sales_channels/src/admin/pages/SalesChannelsListPage.tsx',
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
    // The row's claim, asserted rather than restated. All three of these are
    // zone hosts, and every reach they carried was **outgoing** into a
    // contributor's panel — each repaired by the publication that rendered the
    // host mount, in P7a, P7b and P7c. `check:module-boundary` refuses an
    // *unledgered* reach; what it cannot say is that the conversion did not
    // swap a relative import for a package one, which is the shape
    // `module-package-layout.md` §0 measured as looking like progress. So: no
    // module package names another anywhere in these files.
    const reaching = MOVED.filter((file) =>
      codeOf(`../packages/modules/${file}`).includes('@endora-commerce/mod-'),
    );
    expect(reaching).toEqual([]);
  });

  it('keeps `DefaultChannelBadge` one copy, the package’s own', () => {
    // P7a copied the component into the package and left the `admin/src`
    // original alive because these two screens still imported it. They are the
    // package's now, so the copy is deleted and both name the sibling —
    // `organization-channels-zone.test.tsx` holds the other half of the claim,
    // that no file remains at the old path.
    for (const file of [
      'sales_channels/src/admin/pages/SalesChannelEditPage.tsx',
      'sales_channels/src/admin/pages/SalesChannelsListPage.tsx',
    ]) {
      expect(codeOf(`../packages/modules/${file}`), file).toContain(
        "from '../components/DefaultChannelBadge.js'",
      );
    }
  });
});
