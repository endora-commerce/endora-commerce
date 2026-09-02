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
 * 091 batch 12's three converted modules — `invoices`, `ksef` and
 * `quote_requests`.
 *
 * ## What is different about this batch
 *
 * Eight routes and four registrations, and unlike every batch before it the
 * drain is **not** paid by moving a file. It is one key —
 * `backend/scripts/ledgers/cross-module-imports/invoices.ts`, `invoices`'
 * invoice detail importing `ksef`'s `InvoiceKsefPanel` — and **both endpoints
 * are in this batch**, which is what lets the ledger's own retiring condition
 * be met rather than deferred. That entry says, in the words it was written in
 * before any admin directory moved, that *"moving the file, or rewriting the
 * specifier as the owner's package subpath, retires nothing — it is the same
 * coupling under a supported name"*. So what retires it is a **zone**:
 * `invoices` renders `invoice.detail.after` and `ksef` contributes into it. The
 * enum member, the host render and the contribution are one merge request
 * because `check:admin-zones` refuses a member no host renders, and no
 * intermediate state of the three is green.
 *
 * ## Zone or published component, decided from the signature
 *
 * `admin-component-contribution.md` §10 records that this exact inference has
 * been made from a component's **role** rather than its signature twice, and
 * that both times it was wrong. Read off the file:
 * `InvoiceKsefPanel({ invoiceId, kind, ksefReferenceNumber })` — three values
 * in, nothing out, no `onChange` and no `onSelect` — which is Z1 question 2,
 * an addition the owner makes because the owner is installed. The last case in
 * this file asserts that shape from the artefact, so a signature that grows an
 * `onChange` fails here rather than quietly becoming a zone that cannot carry
 * it.
 *
 * **No `match`, and the reasoning is Z13's**: `match` narrows the *mounts* of
 * one place, and this place has one host and one mount. The alternative — using
 * `match` on `kind` to keep the chunk off a proforma — would write an
 * enumeration of `invoices`' `InvoiceKind` vocabulary into `ksef`'s
 * declaration, `match` having no negation, and that enumeration goes stale
 * fail-closed and silently the day a fourth kind is added.
 *
 * ## All three are switchable, so both axes are real for all three
 *
 * None of the three manifests declares `activation.nonDeactivatable`, which is
 * read off the manifests in a case of its own rather than carried in the table
 * below — so a module locked one day fails here instead of quietly keeping a
 * row that says otherwise.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. All three modules already declared their actions — this batch adds none
 * and deletes `quote_requests`' hand-written `PALETTE_ITEMS` row, which was a
 * second copy of `open-rfq-inbox` — and that half is driven in
 * `backend/test/integration/_admin_surfaces/batch-twelve-palette-off-state.test.ts`.
 * What this file asserts about the palette is the half that is the admin's:
 * that the shell keeps no hand-written copy for the server's answer to disagree
 * with.
 */

interface Subject {
  /** The module id the presence projection is asked about. */
  readonly module: string;
  /** The landing route its nav entry points at. */
  readonly route: string;
  /** The code that opens that landing route. */
  readonly permission: string;
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
  /** Every route the module contributes, in declaration order. */
  readonly routes: readonly string[];
  /** Every nav destination it contributes, in declaration order. */
  readonly navTargets: readonly string[];
  /** The `_i18n` keys the shell must no longer name. */
  readonly retiredSharedKeys: readonly string[];
  /** The zones it contributes to, in declaration order. */
  readonly zones: readonly string[];
  /** Whether the manifest declares `activation.nonDeactivatable`. */
  readonly locked: boolean;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'invoices',
    route: '/invoices',
    permission: 'invoices:read',
    // The module's own write code, and the sharp near miss: issuing, correcting
    // and saving a template all enforce it on the API, and every one of the
    // four screens gates a control on it — so a gate that treated the two as
    // interchangeable would open all four and pass every case below.
    nearMiss: 'invoices:write',
    labelKey: 'nav.invoices.label',
    specifier: '@endora-commerce/mod-invoices/admin',
    section: 'sales',
    routes: ['/invoices', '/invoices/templates', '/invoices/templates/:id', '/invoices/:id'],
    // One row, and the templates screens deliberately have none: they are
    // reached through `InvoiceSectionTabs`, which is this module's own strip.
    navTargets: ['/invoices'],
    retiredSharedKeys: ['appShell.nav.invoices'],
    zones: [],
    locked: false,
  },
  {
    module: 'ksef',
    route: '/ksef',
    permission: 'ksef:read',
    // The module's own write code: `routes.ts` builds one `readGuard` and one
    // `writeGuard`, and the panel and the page both gate their submit controls
    // on the second while opening on the first.
    nearMiss: 'ksef:write',
    labelKey: 'nav.ksef.label',
    specifier: '@endora-commerce/mod-ksef/admin',
    section: 'sales',
    routes: ['/ksef'],
    navTargets: ['/ksef'],
    retiredSharedKeys: ['appShell.nav.ksef'],
    zones: ['invoice.detail.after'],
    locked: false,
  },
  {
    module: 'quote_requests',
    route: '/quote-requests',
    permission: 'rfqs:handle',
    // This module declares exactly one code — `routes.admin.ts` and
    // `routes.sales-reps.ts` each build a single `requireAdmin('rfqs:handle')`
    // and gate reads and writes alike with it — so the near miss has to come
    // from a neighbouring domain. `orders:read` is the sharp choice rather than
    // an arbitrary one: the quote desk converts a quote into an order, an order
    // clerk plausibly holds it, and a gate that compared nothing would let that
    // clerk into the quote desk.
    nearMiss: 'orders:read',
    labelKey: 'nav.quoteRequests.label',
    specifier: '@endora-commerce/mod-quote-requests/admin',
    section: 'sales',
    routes: ['/quote-requests', '/quote-requests/new', '/quote-requests/:id'],
    navTargets: ['/quote-requests'],
    retiredSharedKeys: ['appShell.nav.quoteRequests', 'appShell.palette.sub.customerRfqs'],
    zones: [],
    locked: false,
  },
];

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
 * batch's eight routes are parametric. A pattern rendered verbatim would
 * navigate to a path with a literal `:id` in it, which `react-router` matches
 * just as happily and which therefore proves the gate over a URL no operator
 * can reach.
 */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, 'sample');
}

describe.each(SUBJECTS)('$module owns its admin surface', (subject) => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.permission, subject.nearMiss]);
    renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).toContain(target);
    }
    expect(
      screen.getByRole('link', { name: new RegExp(subject.labelKey.replace(/\./g, '\\.')) }),
    ).toBeTruthy();
  });

  it('renders every one of its screens at its own route while present', async () => {
    // All eight, not the landing one: the batch's value is the whole surface
    // moving, and a registry that dropped a route would leave the landing
    // screen answering and the rest on the admin's not-found page.
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
    expect(sidebarHrefs()).toContain(subject.route);
    back.unmount();

    const screenBack = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
    screenBack.unmount();
  });
});

describe('all three are switchable, so the operator axis is real for each', () => {
  it.each(SUBJECTS)('withdraws every $module surface when the operator switches it off', async (subject) => {
    // The frontend answers both axes from one presence projection, so the
    // assertion has the shape of the platform case above — what differs is that
    // an operator can produce this state at runtime, which is what Constitution
    // XVII item 5 is about. The server half, where a deactivation is a real
    // Setting write, is
    // `backend/test/integration/_admin_surfaces/batch-twelve-palette-off-state.test.ts`.
    //
    // The other two subjects stay present throughout, so what is withdrawn is
    // this module's surface and not the shell's — a control the platform case
    // above cannot have, because there nothing is present at all.
    const others = SUBJECTS.filter((entry) => entry.module !== subject.module);
    presentModules = new Set(SUBJECTS.map((entry) => entry.module));
    permissions = new Set(SUBJECTS.flatMap((entry) => [entry.permission, entry.nearMiss]));
    const on = renderAt('/');
    expect(sidebarHrefs()).toContain(subject.route);
    on.unmount();

    presentModules = new Set(others.map((entry) => entry.module));
    const off = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).not.toContain(target);
    }
    for (const other of others) {
      expect(sidebarHrefs(), other.route).toContain(other.route);
    }
    off.unmount();

    const deepLink = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
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
    // case exists to make loud.
    for (const language of ['en', 'pl']) {
      const own = JSON.parse(
        sourceOf(`../packages/modules/${subject.module}/i18n/${language}.json`),
      ) as Record<string, string>;
      expect(own[subject.labelKey], `${subject.labelKey} (${language})`).toBeTruthy();
    }
  });

  it('leaves no surface directory behind under admin/src/modules', () => {
    // Batch 8's finding, made an assertion. `check:module-boundary` exits 2 on
    // a directory named after a registered module that holds no file, and its
    // message sends the reader looking for a moved module root when the answer
    // is `rmdir`. For `invoices` it is sharper than for the other two: the
    // directory also held the P8 e-mail-outcome shim, whose one remaining
    // reader was `admin/test/kit/admin-kit-identity.test.ts` — a file kept
    // alive for one assertion is the residue this case refuses.
    expect(() => sourceOf(`src/modules/${subject.module}`)).toThrow();
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', async () => {
    const app = codeOf('src/App.tsx');
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-invoices/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(subject.routes);
    for (const path of subject.routes) {
      expect(app, path).not.toContain(`<Route path="${path}"`);
    }
    // The import is the assertion that carries a `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile.
    // Read off the **code** rather than the source, because the comment this
    // batch left in `App.tsx` names all three module directories in prose.
    expect(app).not.toContain(`modules/${subject.module}`);
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
    )) as typeof import('@endora-commerce/mod-invoices/admin');
    for (const route of contributions.routes ?? []) {
      expect(typeof route.component).toBe('function');
      const loaded = await route.component();
      expect(typeof loaded.default).toBe('function');
    }
  });

  it('gates its landing route and its landing nav entry on the same code', async () => {
    // `check:action-route-permissions` holds a module's palette action to the
    // code enforced on its own `targetRoute`; the route and nav declarations
    // are the same statement one layer down, and nothing else compares them.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-invoices/admin');
    const landing = (contributions.routes ?? []).find((route) => route.path === subject.route);
    expect(landing?.requiredPermission).toBe(subject.permission);
    expect(landing?.index).toBe(true);
    const entry = (contributions.nav ?? []).find((nav) => nav.to === subject.route);
    expect(entry?.requiredPermission).toBe(subject.permission);
    expect(entry?.section).toBe(subject.section);
    expect(entry?.labelKey).toBe(subject.labelKey);
    expect((contributions.nav ?? []).map((nav) => nav.to)).toEqual(subject.navTargets);
  });

  it('points every nav entry at a route it also declares', async () => {
    // A sidebar row whose destination no route declares is a link to the
    // admin's not-found page, and nothing else in the estate compares the two
    // arrays: `check:admin-registrations` counts them and
    // `check:action-route-permissions` reads the manifest, not this file.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-invoices/admin');
    const declared = new Set((contributions.routes ?? []).map((route) => route.path));
    for (const entry of contributions.nav ?? []) {
      expect(declared.has(entry.to), entry.to).toBe(true);
    }
  });
});

describe('the axis each module has is read off its manifest, never carried in this table', () => {
  it.each(SUBJECTS)('$module declares the activation shape this file assumes', async (subject) => {
    // `plan.md`'s Ruling 2, asserted rather than restated. What a lock would
    // remove is the **operator's** ability to make `isPresent` answer `false`;
    // all three of this batch's modules are switchable, so both axes above are
    // real for all three. Reading it here is what makes a module locked one day
    // fail this file instead of quietly keeping a table row that says
    // otherwise.
    const { manifest } = (await import(
      /* @vite-ignore */ subject.specifier.replace('/admin', '')
    )) as typeof import('@endora-commerce/mod-invoices');
    const activation = manifest.activation;
    const locked = Boolean(activation && 'nonDeactivatable' in activation);
    expect(locked).toBe(subject.locked);
    expect(activation).toBeDefined();
  });
});

describe('the surfaces each module does not contribute, derived from the contribution set', () => {
  it.each(SUBJECTS)('$module contributes exactly the zones this file drives', async (subject) => {
    // Ruling 1: the off-state test asserts every surface the module
    // contributes, and names the ones it does not **derived from the
    // contribution set** rather than asserted. `invoices` and `quote_requests`
    // declare none — so there is no rendering of theirs to withdraw, and this
    // case fails the day one is added without a proof of its own. `ksef`
    // declares exactly one, which the zone cases below drive.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-invoices/admin');
    expect((contributions.zones ?? []).map((zone) => zone.zone)).toEqual(subject.zones);
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  const MOVED = [
    'invoices/src/admin/components/InvoiceSectionTabs.tsx',
    'invoices/src/admin/pages/InvoiceDetail.tsx',
    'invoices/src/admin/pages/InvoiceTemplateEditor.tsx',
    'invoices/src/admin/pages/InvoiceTemplatesPage.tsx',
    'invoices/src/admin/pages/InvoicesList.tsx',
    'invoices/src/admin/templates/invoice-builder-plugin.tsx',
    'invoices/src/admin/templates/invoice-puck-config.tsx',
    'ksef/src/admin/api/ksef-client.ts',
    'ksef/src/admin/components/CredentialUploadForm.tsx',
    'ksef/src/admin/components/GenerateCertificateWizard.tsx',
    'ksef/src/admin/components/SubmissionsTable.tsx',
    'ksef/src/admin/components/TokenForm.tsx',
    'ksef/src/admin/pages/KsefPage.tsx',
    'ksef/src/admin/submission-error.ts',
    'ksef/src/admin/zones/InvoiceKsefPanel.tsx',
    'quote_requests/src/admin/pages/RfqCreatePage.tsx',
    'quote_requests/src/admin/pages/RfqDetail.tsx',
    'quote_requests/src/admin/pages/RfqList.tsx',
    'quote_requests/src/admin/validity.ts',
  ];

  it('names no `@/` alias and reads no bundler environment', () => {
    // The alias resolves to `admin/src` and to nothing an installed package can
    // reach, so a surviving one would be a screen that compiles here and not in
    // a consumer's install. `import.meta.env` is Vite's, and a package's
    // `tsconfig.ui.json` carries no `vite/client` types — a read of it would
    // not compile, which is a stronger instrument than this line and is why
    // this line is cheap to keep. Three of these files held one and now take
    // the kit's published `apiBaseUrl`.
    for (const file of MOVED) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).not.toMatch(/from '@\//m);
      expect(source, file).not.toContain('import.meta.env');
    }
  });

  it('names one sibling module package and no other: none at all', () => {
    // The batch's drain is one key and it is paid by the zone, not by a
    // specifier. `check:module-boundary` refuses an *unledgered* reach; what it
    // cannot say is that the conversion did not swap the ledgered relative
    // import for a ledgered package one — which is the shape
    // `cross-module-imports/invoices.ts` was written, before any directory
    // moved, to refuse. So: no module package names another anywhere in these
    // nineteen files.
    const reaching = MOVED.filter((file) =>
      codeOf(`../packages/modules/${file}`).includes('@endora-commerce/mod-'),
    );
    expect(reaching).toEqual([]);
  });
});

describe('the zone is the drain: `invoice.detail.after` has a host and a contributor', () => {
  const ZONE = 'invoice.detail.after';

  it('is rendered by the host, with the props the contract declares', () => {
    // `check:admin-zones` refuses a member no host renders, so this case is not
    // the only instrument — what it adds is the **props**, which that check
    // reads as a name and not as a payload. A mount that dropped `kind` would
    // leave the panel rendering on proformas, which is a wrong answer rather
    // than a missing one.
    // `codeOf` and not `sourceOf`: the mount carries a comment recording what
    // it replaced, and that comment names both the component and the module —
    // matching prose is the defect the check estate refuses by reading literal
    // AST nodes, and the two `not.toContain`s below are exactly where it would
    // bite.
    const host = codeOf('../packages/modules/invoices/src/admin/pages/InvoiceDetail.tsx');
    expect(host).toContain(`<AdminZone`);
    expect(host).toContain(`name="${ZONE}"`);
    expect(host).toContain('invoiceId: invoice.id');
    expect(host).toContain('kind: invoice.kind');
    expect(host).toContain('ksefReferenceNumber: invoice.ksefReferenceNumber');
    // And the coupling the zone replaces is gone: the host names neither the
    // component nor a path into the module that owns it, in either spelling —
    // the relative one it used to write and the package one that would be *"the
    // same coupling under a supported name"*, which is what the retired ledger
    // entry says retires nothing.
    //
    // Matched on the specifier and not on the bare word `ksef`: the mount
    // passes `invoice.ksefReferenceNumber`, which is `invoices`' own contract
    // field and carries the other module's name as a substring. A bare-word
    // assertion here would be red on a payload the host is right to send.
    expect(host).not.toContain('InvoiceKsefPanel');
    expect(host).not.toContain('modules/ksef');
    expect(host).not.toContain('@endora-commerce/mod-ksef');
  });

  it('is contributed by ksef, at a code, with no `match`', async () => {
    // Z13: `match` narrows the *mounts* of one place and this place has one
    // host and one mount, so a `match` here would be narrowing nothing — and
    // the one narrowing that looks tempting, hiding the panel on a proforma,
    // has no negation to write it with and would put `invoices`' `InvoiceKind`
    // vocabulary inside this module's declaration. The `kind` guard stays in
    // the component. This case is what makes that a decision rather than an
    // omission.
    const { contributions } = (await import('@endora-commerce/mod-ksef/admin'));
    const zone = (contributions.zones ?? []).find((entry) => entry.zone === ZONE);
    expect(zone, 'ksef must contribute to the zone invoices renders').toBeDefined();
    expect(zone?.requiredPermission).toBe('ksef:read');
    expect(zone?.match).toBeUndefined();
    expect(typeof zone?.component).toBe('function');
    const loaded = await zone?.component();
    expect(typeof loaded?.default).toBe('function');
  });

  it('carries the signature that made it a zone and not a published component', () => {
    // `admin-component-contribution.md` §10 records that this inference has
    // been made from a component's **role** rather than its signature twice,
    // and that both times it was wrong. Z1 question 1 is *"does the consumer
    // pass a value in and receive one back"*, and a zone cannot carry a
    // `value`/`onChange` pair because a zone has zero-or-many contributors and
    // a field has exactly one. So the props are asserted from the file: three
    // values in, nothing out. A signature that grows a callback fails here
    // rather than quietly becoming a zone that cannot honestly carry it.
    const panel = sourceOf('../packages/modules/ksef/src/admin/zones/InvoiceKsefPanel.tsx');
    expect(panel).toContain(`AdminZoneProps<'${ZONE}'>`);
    expect(panel).toMatch(/export default InvoiceKsefPanel;/);
    expect(panel).not.toMatch(/\bonChange\b/);
    expect(panel).not.toMatch(/\bonSelect\b/);
  });

  it('retires the one cross-module key this batch was measured to owe', () => {
    // The ledger shard is deleted, which `check:module-boundary` refuses to let
    // happen while the reach it describes is still in the tree — and refuses
    // the other way too, an entry describing no reach being the stale direction
    // every ledger here fails on. This case is the human-readable half: the
    // shard is gone *and* the reach is gone, in one merge request, which is
    // what the entry's own retiring condition asked for.
    expect(() =>
      sourceOf('../backend/scripts/ledgers/cross-module-imports/invoices.ts'),
    ).toThrow();
  });
});
