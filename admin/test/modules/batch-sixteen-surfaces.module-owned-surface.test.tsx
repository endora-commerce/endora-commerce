import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { existsSync, readFileSync } from 'node:fs';
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
 * 091 batch 16's two converted modules — `cms` and `blog`.
 *
 * ## What is different about this batch
 *
 * Eighteen routes and seven registrations, and they are the **last** ones
 * `admin/src/App.tsx` and `admin/src/components/AppShell.tsx` hold on behalf of
 * a module. What remains in those two files after this is the admin
 * application's own: **three** routes (the dashboard, `/platform/modules` and
 * `/profile`) and three nav entries (the dashboard's sidebar row and palette
 * row, and `/platform/modules`). It was **four** when this batch landed — a
 * `/settings/dhl-parcel` redirect counted as the host's own because a redirect's
 * element comes from `react-router-dom` — and feature 134's wave 1 deleted it,
 * that reasoning being about the *element* while the *destination* was declared
 * only by `dhl_parcel`: a host route whose destination no host file declares is
 * the application's own by element and the module's by reach. That is
 * SC-007, and what says so is `host-admin-registrations.test.tsx` — a file
 * named after the claim rather than after this batch, because the assertion
 * outlives every batch (`contracts/admin-registry.md` R13a). It is the
 * successor to `backend/scripts/check-admin-registrations.ts`, the instrument
 * that counted the drain batch by batch and that Phase 5's T5 deletes for
 * having nothing left to ratchet.
 *
 * ## The batch's one judgement: `PageBuilderEditor`
 *
 * `blog`'s post and category editors render `cms`' Puck canvas — the two keys
 * `backend/scripts/ledgers/cross-module-imports/blog.ts` has carried since
 * feature 091's Phase 0, and the **only** cross-module admin debt either module
 * has. This is the first batch in which both endpoints of a reach move at once,
 * so the seam was decided here rather than inherited.
 * `admin-component-contribution.md` Z1 decides it from the signature: `data` in
 * and `onChange` back is Z1 question 1, so the **consumer** decides that the
 * canvas appears — a published component, not a zone contribution. The exit is
 * D-191's `./admin-ui` subpath on `cms`' own package, which is `credentials`'
 * exit from batch 10 arriving a second time, and Z11 keeps the reach counted:
 * `check:module-boundary` reads
 * `cross-module reaches=7 (imports=3 sql=4) ledger-size=7 shards=4` on both
 * sides, with the two keys re-keyed rather than retired. The last `describe`
 * below is that seam's own subject.
 *
 * ## Neither module is a zone host and neither contributes to a zone
 *
 * Which is asserted rather than assumed, derived from the contribution set —
 * `check:admin-zones` reads `renders=25 contributions=24` on both sides of the
 * move, and a screen that had silently grown or lost an `<AdminZone>` would
 * change one of those numbers.
 *
 * ## One tightening, in five routes, and it is forced rather than chosen
 *
 * `/cms/pages/new`, `/cms/blocks/new`, `/cms/templates/new`,
 * `/blog/posts/new` and `/blog/categories/new` take the **write** code. Each
 * module's own palette action already advertises one of them under that code,
 * and `App.tsx` gates none of these routes at all — so declaring them on the
 * read code would have made the palette advertise a screen the advertised code
 * cannot open (Principle XVI item 2) and would have *withdrawn* a screen a
 * write-holding operator reaches today. The five create buttons are gated on the
 * same code in this merge request, so the link is not a dead end either. That is
 * batch 14's `/sales-channels/new` shape, arriving five times; neither module
 * gated anything client-side before it.
 *
 * ## Both modules are switchable, and that is read off their manifests
 *
 * `cms` declares `activation: { settingCode: 'cms.enabled', default: true }`
 * and `blog` declares `blog.activation`; neither is `nonDeactivatable`. So both
 * drive the operator-axis `describe` below, which batch 14's three could not all
 * do. The value is read from the manifest rather than carried in the table, so a
 * module locked one day fails here instead of quietly keeping a row that says
 * otherwise.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. `backend/test/integration/_admin_surfaces/batch-sixteen-palette-off-state.test.ts`
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
   * A pair rather than a path, because this batch splits: the five `/new`
   * screens take the **write** code and the thirteen others the read one. A
   * list of paths could not say that, and the split is the batch's one
   * operator-visible tightening.
   */
  readonly routes: readonly (readonly [path: string, permission: string])[];
  /** Every nav destination it contributes, in declaration order. */
  readonly navTargets: readonly string[];
  /** The `_i18n` keys the shell must no longer name. */
  readonly retiredSharedKeys: readonly string[];
  /** The zones it contributes **to**, in declaration order. */
  readonly zones: readonly string[];
  /** Every surface directory it leaves behind under `admin/src/modules`. */
  readonly surfaceDirectories: readonly string[];
  /** Whether the manifest declares `activation.nonDeactivatable`. */
  readonly locked: boolean;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'cms',
    route: '/cms/pages',
    permission: 'cms.read',
    // The module's own write code: every mutation on the CMS API enforces it,
    // so a gate that treated the two as interchangeable would open all eleven
    // screens and pass every case below.
    nearMiss: 'cms.write',
    labelKey: 'nav.cmsPages.label',
    specifier: '@endora-commerce/mod-cms/admin',
    section: 'content',
    routes: [
      // The bare alias first, exactly as `App.tsx` declared it. It is a second
      // declaration of the page list rather than a redirect, because a redirect's
      // element comes from `react-router-dom` and would therefore be the admin
      // application's own route — which is the attribution `/settings/dhl-parcel`
      // used to have, and feature 134's wave 1 deleted it for taking that
      // reasoning too far: the element was the host's, the **destination** was a
      // departing module's. Keeping `/cms` as a declaration is the right call for
      // the same reason it was always the right call — it keeps both ends with
      // `cms`.
      ['/cms', 'cms.read'],
      ['/cms/pages', 'cms.read'],
      ['/cms/pages/new', 'cms.write'],
      ['/cms/pages/:id', 'cms.read'],
      ['/cms/blocks', 'cms.read'],
      ['/cms/blocks/new', 'cms.write'],
      ['/cms/blocks/:id', 'cms.read'],
      ['/cms/templates', 'cms.read'],
      ['/cms/templates/new', 'cms.write'],
      ['/cms/templates/:id', 'cms.read'],
      ['/cms/hooks', 'cms.read'],
    ],
    navTargets: ['/cms/pages', '/cms/blocks', '/cms/templates', '/cms/hooks'],
    retiredSharedKeys: [
      'appShell.nav.cmsPages',
      'appShell.nav.cmsBlocks',
      'appShell.nav.cmsTemplates',
      'appShell.nav.cmsHooks',
    ],
    zones: [],
    surfaceDirectories: ['cms'],
    locked: false,
  },
  {
    module: 'blog',
    route: '/blog/posts',
    permission: 'blog.read',
    nearMiss: 'blog.write',
    labelKey: 'nav.blogPosts.label',
    specifier: '@endora-commerce/mod-blog/admin',
    section: 'content',
    routes: [
      ['/blog/posts', 'blog.read'],
      ['/blog/posts/new', 'blog.write'],
      ['/blog/posts/:id', 'blog.read'],
      ['/blog/categories', 'blog.read'],
      ['/blog/categories/new', 'blog.write'],
      ['/blog/categories/:id', 'blog.read'],
      ['/blog/tags', 'blog.read'],
    ],
    navTargets: ['/blog/posts', '/blog/categories', '/blog/tags'],
    retiredSharedKeys: [
      'appShell.nav.blogPosts',
      'appShell.nav.blogCategories',
      'appShell.nav.blogTags',
    ],
    zones: [],
    surfaceDirectories: ['blog'],
    locked: false,
  },
];

/** The modules an operator can genuinely switch off — both of them, here. */
const SWITCHABLE = SUBJECTS.filter((subject) => !subject.locked);

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
 * `cms`' Puck canvas reaches `@dnd-kit/dom`, which constructs a
 * `ResizeObserver` at module scope, and jsdom has none. `App.tsx` used to
 * import that editor statically, so every file rendering `<App/>` needed this
 * stub; this batch is what removes the static import, and the stub stays
 * because the route factories below still load the module — lazily, which is the
 * property the last-but-one case asserts. Nothing this file asserts touches it.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../packages/admin-shell/src/App');

/** The module's `./admin` contribution set, off the bare specifier. */
async function contributionsOf(
  subject: Subject,
): Promise<typeof import('@endora-commerce/mod-cms/admin')['contributions']> {
  const loaded = (await import(/* @vite-ignore */ subject.specifier)) as typeof import(
    '@endora-commerce/mod-cms/admin'
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

/**
 * The passthrough bundle, with each module's nav label keys taken **from its own
 * contribution set** rather than from a list here. A second copy of the seven
 * keys would be a second author of the same fact, and the case that asserts each
 * key resolves in both shipped languages reads the contribution set too — so a
 * key renamed in the declaration and not in the bundle fails there instead of
 * both sides quietly agreeing on a stale spelling.
 */
const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.content',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...Object.fromEntries(
    SUBJECTS.flatMap((subject) =>
      Object.entries(
        passthroughBundle(
          subject.module,
          (CONTRIBUTIONS.get(subject.module)?.nav ?? []).map((entry) => entry.labelKey),
        ),
      ),
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
 * The deep-link cases below have to navigate somewhere real, and five of this
 * batch's eighteen routes are parametric. A pattern rendered verbatim would
 * navigate to a path with a literal `:id` in it, which `react-router` matches
 * just as happily and which therefore proves the gate over a URL no operator
 * can reach.
 */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, 'sample');
}

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
    expect(
      screen.getByRole('link', { name: new RegExp(subject.labelKey.replace(/\./g, '\\.')) }),
    ).toBeTruthy();
  });

  it('renders every one of its screens at its own route while present', async () => {
    // All eighteen across the batch, not the landing ones: the batch's value is
    // the whole surface moving, and a registry that dropped a route would leave
    // the landing screen answering and the rest on the admin's not-found page.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.permission, subject.nearMiss]);
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
    presentModules = new Set();
    permissions = new Set([subject.permission, subject.nearMiss]);
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
    // would pass with the permission gate missing entirely. The near miss is
    // this module's own write code, so the case fails if the gate compares
    // nothing — and it is the sharp one, because every screen in the batch is
    // an editor whose saves enforce exactly that code.
    presentModules = new Set([subject.module]);
    permissions = new Set([subject.nearMiss]);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain(subject.route);
    shell.unmount();

    const deepLink = renderAt(subject.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('opens each create form on the write code, and each editor on the read one', async () => {
    // **The batch's one operator-visible tightening**, and the reason the
    // `routes` table carries a code per path rather than one per module.
    //
    // The five `/new` screens exist to create, and each module's own palette
    // action already advertises one of them under the write code. Declaring
    // them on the read code would have made the palette advertise a screen the
    // advertised code cannot open — Principle XVI item 2 — and it would have
    // been a *regression*, because `App.tsx` gates none of these routes today,
    // so a write-holding operator reaches them now. The five create buttons are
    // gated on the same code in this merge request, so the link is not a dead
    // end either.
    //
    // Driven rather than read off the declaration, which the equality case
    // already does: what an equality cannot say is that the two codes really
    // separate two sets of screens at the gate.
    presentModules = new Set([subject.module]);
    const creates = subject.routes.filter(([, code]) => code.endsWith('.write'));
    const reads = subject.routes.filter(([, code]) => code.endsWith('.read'));
    expect(creates.length > 0 && reads.length > 0).toBe(true);

    permissions = new Set([subject.permission]);
    for (const [pattern] of creates) {
      const refused = renderAt(concreteUrl(pattern));
      await waitFor(() => expect(notFoundIsRendered(), `${pattern} on read`).toBe(true));
      refused.unmount();
    }

    permissions = new Set([subject.nearMiss]);
    for (const [pattern] of creates) {
      const allowed = renderAt(concreteUrl(pattern));
      await waitFor(() => expect(notFoundIsRendered(), `${pattern} on write`).toBe(false));
      allowed.unmount();
    }
    for (const [pattern] of reads) {
      const refused = renderAt(concreteUrl(pattern));
      await waitFor(() => expect(notFoundIsRendered(), `${pattern} on write`).toBe(true));
      refused.unmount();
    }
  });

  it('restores both surfaces when the code is granted again', async () => {
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

describe('each module withdraws everything the operator switches off', () => {
  it.each(SWITCHABLE)('withdraws every $module surface when the operator switches it off', async (subject) => {
    // The frontend answers both axes from one presence projection, so the
    // assertion has the shape of the platform case above — what differs is that
    // an operator can produce this state at runtime, which is what Constitution
    // XVII item 5 is about. The server half, where a deactivation is a real
    // Setting write, is
    // `backend/test/integration/_admin_surfaces/batch-sixteen-palette-off-state.test.ts`.
    //
    // The other subject stays present throughout, so what is withdrawn is this
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

    for (const [pattern] of subject.routes) {
      const deepLink = renderAt(concreteUrl(pattern));
      await waitFor(() => expect(notFoundIsRendered(), pattern).toBe(true));
      deepLink.unmount();
    }
  });
});

describe.each(SUBJECTS)('the shell no longer names $module by hand', (subject) => {
  it('has no host route, nav entry or palette row for the module', () => {
    // The evidence that the conversion converted something. Leaving a `<Route>`
    // standing beside the declaration would declare the screen **twice**, with
    // `react-router` silently taking the first match, which D-23 calls the worst
    // available failure.
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
    // case exists to make loud. Every entry, not only the landing one: `cms`
    // contributes four and a bundle short of one of them renders a dotted key in
    // the operator's sidebar.
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
    // is `rmdir`.
    for (const directory of subject.surfaceDirectories) {
      expect(existsSync(resolve(process.cwd(), `src/modules/${directory}`)), directory).toBe(false);
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
    // else in the estate compares a nav entry to the route beneath it, and `cms`
    // is the case that needs it: four rows, four routes, and a mismatch on any
    // of them would advertise a screen the gate then refuses.
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
    // arrays.
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
    // both of this batch's two are switchable, so reading it here is what makes
    // a module locked one day fail this file instead of quietly keeping a table
    // row that says otherwise — and `SWITCHABLE` above, which decides who the
    // operator-axis describe drives, is derived from the same field.
    const { manifest } = (await import(
      /* @vite-ignore */ subject.specifier.replace('/admin', '')
    )) as typeof import('@endora-commerce/mod-cms');
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
    // contribution set** rather than asserted. Both of this batch's two
    // contribute to no zone and host none — `cms` publishes a component
    // instead, which is the other exit Z1 offers and the subject of the last
    // `describe` below. Asserted as an equality, so a zone silently added or
    // dropped in the move fails here.
    const contributions = CONTRIBUTIONS.get(subject.module);
    expect((contributions?.zones ?? []).map((zone) => zone.zone)).toEqual(subject.zones);
  });

  it.each(SUBJECTS)('$module mounts no zone in any screen it moved', (subject) => {
    // The host half of the same negative, and it is worth asserting rather than
    // leaving to `check:admin-zones`: neither module renders an `<AdminZone>`,
    // so `renders=25` is unchanged by this batch, and a mount that appeared in
    // the move would be a place contributors could reach that nothing in this
    // feature's design put there.
    const files = MOVED.filter((file) => file.startsWith(`${subject.module}/`));
    expect(files.length > 0).toBe(true);
    for (const file of files) {
      expect(sourceOf(`../packages/modules/${file}`), file).not.toContain('<AdminZone');
    }
  });

  it.each(SUBJECTS)('$module contributes a sidebar row for every section it names', (subject) => {
    // The derived negative, written as a derivation rather than a table row:
    // both modules declare exactly one section and more than one row in it, so a
    // module that grew a second section or lost its last row fails here instead
    // of the table silently disagreeing with the declaration.
    const entries = CONTRIBUTIONS.get(subject.module)?.nav ?? [];
    expect(entries.length > 0).toBe(true);
    expect([...new Set(entries.map((entry) => entry.section))]).toEqual([subject.section]);
  });
});

/**
 * The screens and their collaborators, as the packages hold them.
 *
 * `cms`' `admin-ui/index.ts` is in this list deliberately: it is the barrel the
 * published subpath names, so it is a file the reach cases below have to judge
 * like any other.
 */
const MOVED = [
  'cms/src/admin/index.ts',
  'cms/src/admin-ui/index.ts',
  'cms/src/admin/api/cms-client.ts',
  'cms/src/admin/components/AdminCatalogPreviewProvider.tsx',
  'cms/src/admin/components/AdminCmsAssetProvider.tsx',
  'cms/src/admin/components/BackgroundFields.tsx',
  'cms/src/admin/components/ButtonLinkFields.tsx',
  'cms/src/admin/components/CarouselPreviewNav.tsx',
  'cms/src/admin/components/CmsContentEditorLayout.tsx',
  'cms/src/admin/components/ComponentDragHandle.tsx',
  'cms/src/admin/components/ContentSliderActionBarExtras.tsx',
  'cms/src/admin/components/HookBlockAttachmentsPanel.tsx',
  'cms/src/admin/components/PageBuilderActionBar.tsx',
  'cms/src/admin/components/PageBuilderDrawer.tsx',
  'cms/src/admin/components/PageBuilderEditor.tsx',
  'cms/src/admin/components/PuckActionGuard.tsx',
  'cms/src/admin/components/RowLayoutPicker.tsx',
  'cms/src/admin/components/SliderPreviewActionBarExtras.tsx',
  'cms/src/admin/components/admin-catalog-preview-map.ts',
  'cms/src/admin/components/build-viewports.ts',
  'cms/src/admin/components/cms-template-layout.ts',
  'cms/src/admin/components/page-builder-i18n.ts',
  'cms/src/admin/components/puck-safe.ts',
  'cms/src/admin/components/scope-utils.ts',
  'cms/src/admin/editors/BlockEditor.tsx',
  'cms/src/admin/editors/PageEditor.tsx',
  'cms/src/admin/editors/TemplateEditor.tsx',
  'cms/src/admin/pages/BlocksListPage.tsx',
  'cms/src/admin/pages/HooksPage.tsx',
  'cms/src/admin/pages/PagesListPage.tsx',
  'cms/src/admin/pages/TemplatesListPage.tsx',
  'blog/src/admin/index.ts',
  'blog/src/admin/api/blog-client.ts',
  'blog/src/admin/components/CategoryTreeNode.tsx',
  'blog/src/admin/components/PostStatusBadge.tsx',
  'blog/src/admin/components/RelatedPostsPicker.tsx',
  'blog/src/admin/components/RelatedProductsPicker.tsx',
  'blog/src/admin/components/TagPicker.tsx',
  'blog/src/admin/pages/BlogCategoryEditor.tsx',
  'blog/src/admin/pages/BlogCategoryTreePage.tsx',
  'blog/src/admin/pages/BlogPostEditor.tsx',
  'blog/src/admin/pages/BlogPostListPage.tsx',
  'blog/src/admin/pages/BlogTagListPage.tsx',
];

describe('the moved screens take no reach the package cannot resolve', () => {
  it('names no `@/` alias and reads no bundler environment', () => {
    // The alias resolves to `admin/src` and to nothing an installed package can
    // reach, so a surviving one would be a screen that compiles here and not in
    // a consumer's install. `import.meta.env` is Vite's, and a package's
    // `tsconfig.ui.json` carries no `vite/client` types — a read of it would not
    // compile, which is the stronger instrument and which is exactly what caught
    // `AdminCmsAssetProvider`'s private `VITE_API_BASE_URL` read in this batch.
    // The kit publishes `apiBaseUrl` for that reason and that file names it now.
    for (const file of MOVED) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).not.toMatch(/from '@\//m);
      expect(source, file).not.toContain('import.meta.env');
    }
  });

  it('names no shim P5b or P8 left behind under admin/src', () => {
    // Eleven files went with `admin/src/modules/cms/`: nine forwarding into
    // `@endora-commerce/page-builder-admin` and two into
    // `@endora-commerce/admin-kit/components`. A shim exists so files still
    // under `admin/src` reach a moved binding by the specifier they always
    // used; with the last of those files in a package they have no reader, and a
    // surviving reference to one would be an unresolvable specifier rather than
    // a compile error only in a consumer's install.
    for (const shim of RETIRED_SHIMS) {
      expect(existsSync(resolve(process.cwd(), `src/modules/cms/components/${shim}`)), shim).toBe(
        false,
      );
    }
    for (const file of MOVED) {
      const source = codeOf(`../packages/modules/${file}`);
      for (const shim of RETIRED_SHIMS) {
        const base = shim.replace(/\.tsx?$/, '');
        expect(source, `${file} -> ${base}`).not.toContain(`/${base}'`);
      }
    }
  });
});

/** The eleven forwarders that went with `admin/src/modules/cms/components/`. */
const RETIRED_SHIMS = [
  'AssetPickers.tsx',
  'CatalogPickers.tsx',
  'ColorPaletteModal.tsx',
  'ColorPaletteProvider.tsx',
  'PageBuilderHeaderActions.tsx',
  'PageBuilderOverlayBridge.tsx',
  'QuickTooltip.tsx',
  'action-bar-target.ts',
  'page-builder-data.ts',
  'ContentLanguageTabs.tsx',
  'ScopePicker.tsx',
];

describe('the one published component, and the reach it keeps', () => {
  it('publishes `PageBuilderEditor` on `cms`’ own `./admin-ui` subpath', async () => {
    // D-191's exit, taken a second time. The subpath has to resolve as a bare
    // specifier, because that is what a consumer writes and what a bundler
    // reads; asserting the source file would prove nothing about the `exports`
    // map, which is the thing that can be wrong.
    const published = await import('@endora-commerce/mod-cms/admin-ui');
    expect(typeof published.PageBuilderEditor).toBe('function');
  });

  it('is what `blog`’s two editors import, by that specifier and no other', () => {
    // The consumer's half. A relative reach into `packages/modules/cms/src`
    // would evaluate the source beside the `dist` the registry loads — two
    // copies of every module-scope value in that file's graph, which is silent
    // in a frontend (D-149, and `check:singleton-identity`'s subject one layer
    // over).
    for (const file of [
      'blog/src/admin/pages/BlogPostEditor.tsx',
      'blog/src/admin/pages/BlogCategoryEditor.tsx',
    ]) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).toContain(
        "import { PageBuilderEditor } from '@endora-commerce/mod-cms/admin-ui';",
      );
      expect(source, file).not.toContain('packages/modules/cms');
    }
  });

  it('declares the edge in `blog`’s own manifest, as a peer and not a dependency', () => {
    // R4 narrowed by D-191: a published component survives into the emitted
    // JavaScript by construction, so every consumer that bundles this admin
    // layer must resolve the owner — which a `devDependency` alone would not say
    // to anyone installing from a registry. It stays out of `dependencies`,
    // which is R4's own word and the field the generator preserves for an
    // author. This is `manifests:generate`'s derivation, asserted here because
    // nothing else in the admin suite reads it.
    const manifest = JSON.parse(sourceOf('../packages/modules/blog/package.json')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.peerDependencies?.['@endora-commerce/mod-cms']).toBe('workspace:*');
    expect(manifest.devDependencies?.['@endora-commerce/mod-cms']).toBe('workspace:*');
    expect(manifest.dependencies?.['@endora-commerce/mod-cms']).toBeUndefined();
  });

  it('keeps the reach counted, in `blog`’s shard, under the new spelling', () => {
    // Z11: a subpath is contract surface **iff** its emitted module exports no
    // runtime binding, and this one exports a React component — so publication
    // gave the coupling a supported name and retired nothing.
    // `check:module-boundary` reads the same seven reaches on both sides of this
    // move, and the two keys are re-keyed rather than removed. Asserting the
    // keys here is what stops a later merge request reading the unchanged count
    // as "there was never a reach".
    const shard = sourceOf('../backend/scripts/ledgers/cross-module-imports/blog.ts');
    for (const file of ['BlogPostEditor', 'BlogCategoryEditor']) {
      expect(shard, file).toContain(
        `'packages/modules/blog/src/admin/pages/${file}.tsx:cms/admin-ui':`,
      );
    }
    expect(shard).not.toContain('admin/src/modules/blog');
  });

  it('needs no presence gate in the consumer, and the manifests are why', () => {
    // Z12 asks what the consumer does while the owner is off, and
    // `credentials`' answer was a `useSurfaceVisibility()` around the control
    // that opens its modal. This one's answer is derived instead: `blog`
    // declares `cms` in its manifest `dependencies`, and `ModuleGatingGraph`
    // reads `dependencies` when activating and
    // `dependencies` ∪ `acknowledgedDependencies` when deactivating — so "`cms`
    // off while `blog` is on" is a state the platform refuses at the flip, in
    // both directions. A gate in the screen would be a second answer to a
    // question the lifecycle has already answered, and a `module-namespace` key
    // in `check:admin-zones`' foreign-id ledger for a branch no operator can
    // reach.
    //
    // Asserted rather than written in a comment, because the whole claim rests
    // on one array: drop `cms` from it and this seam owes itself a gate.
    const manifest = sourceOf('../packages/modules/blog/src/manifest.ts');
    const dependencies = /dependencies:\s*\[([\s\S]*?)\n  \]/.exec(manifest)?.[1] ?? '';
    expect(dependencies).toContain("'cms',");
  });
});
