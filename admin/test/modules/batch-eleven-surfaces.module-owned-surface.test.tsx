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
 * into `App.tsx` and `AppShell.tsx` name the routes and the modules they
 * record having moved. Matching prose is the defect the check estate refuses by
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
 * 091 batch 11's two converted modules — `newsletter` and
 * `transactional_emails`.
 *
 * ## Why these two, and why the batch is the largest one left
 *
 * Seventeen routes and fifteen registrations: eleven routes and nine
 * registrations (six sidebar rows plus three palette rows) for `newsletter`,
 * six and six for `transactional_emails`.
 *
 * **Both are drain 0**, re-derived on this branch before anything moved:
 * neither has a shard in `backend/scripts/ledgers/cross-module-imports/`,
 * neither appears in `admin-surface.ts`, neither in `foreign-module-ids.ts`.
 * The plan recorded their whole remaining debt as six reaches into
 * `admin/src/modules/_shared/email-builder/` — and P5b did not repair those, it
 * made them **stop existing**: the e-mail builder is
 * `@endora-commerce/page-builder-admin` now, so the six are bare specifiers
 * into a published `exports` map. That is what makes the two a batch: they are
 * the two consumers of one package, and the package landed first.
 *
 * ## One is locked and one is not, and that decides what is driven
 *
 * `transactional_emails` declares `activation.nonDeactivatable` with a reason —
 * the platform's only acknowledgement path to a buyer — so an operator cannot
 * make `isPresent` answer `false` for it; `plan.md`'s Ruling 2 is what admits
 * it, and the axis it still has is the **permission** one. `newsletter` is
 * switchable (`newsletter.enabled`, default on) and has both.
 *
 * The presence cases below are driven for both all the same, and the axis they
 * drive is the **platform** one — a deployment that never installs the module,
 * which a lock does not remove. The lock is read off the manifest rather than
 * carried in the table, so a module locked or unlocked one day fails here
 * instead of quietly keeping a row that says otherwise.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. Both modules declare actions and both gain new ones in this batch, and
 * all of that is driven in
 * `backend/test/integration/_admin_surfaces/batch-eleven-palette-off-state.test.ts`.
 * What this file asserts about the palette is the half that is the admin's:
 * that the shell keeps no hand-written copy for the server's answer to disagree
 * with.
 *
 * **Zones** are asserted absent from the contribution set itself rather than
 * from a rendering, because neither module contributes one — see the
 * penultimate `describe`, which reads `contributions.zones` instead of
 * restating it.
 */

interface Subject {
  /** The module id the presence projection is asked about. */
  readonly module: string;
  /** The landing route its first nav entry points at. */
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
  /** Whether the manifest declares `activation.nonDeactivatable`. */
  readonly locked: boolean;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'newsletter',
    route: '/newsletter/subscribers',
    permission: 'newsletter:read',
    // The module's own write code, and the sharp near miss: three of its eleven
    // routes declare it (`/campaigns/new`, `/automations/new`, `/provider`), so
    // a gate that treated the two as interchangeable would open the other eight
    // and pass every case below.
    nearMiss: 'newsletter:write',
    labelKey: 'nav.subscribers.label',
    specifier: '@endora-commerce/mod-newsletter/admin',
    section: 'newsletter',
    routes: [
      '/newsletter/subscribers',
      '/newsletter/campaigns',
      '/newsletter/campaigns/new',
      '/newsletter/campaigns/:id',
      '/newsletter/campaigns/:id/stats',
      '/newsletter/automations',
      '/newsletter/automations/new',
      '/newsletter/automations/:id',
      '/newsletter/tags',
      '/newsletter/blocks',
      '/newsletter/provider',
    ],
    navTargets: [
      '/newsletter/subscribers',
      '/newsletter/campaigns',
      '/newsletter/automations',
      '/newsletter/tags',
      '/newsletter/blocks',
      '/newsletter/provider',
    ],
    retiredSharedKeys: [
      'appShell.nav.newsletterSubscribers',
      'appShell.nav.newsletterCampaigns',
      'appShell.nav.newsletterAutomations',
      'appShell.nav.newsletterTags',
      'appShell.nav.newsletterBlocks',
      'appShell.nav.newsletterProvider',
    ],
    locked: false,
  },
  {
    module: 'transactional_emails',
    route: '/transactional-emails',
    permission: 'transactional_emails:read',
    // The module's write code. Every one of its six screens opens on the read
    // code and gates its own saves on this one, so holding it alone opens
    // nothing — the codes are opaque strings.
    nearMiss: 'transactional_emails:write',
    labelKey: 'nav.transactionalEmails.label',
    specifier: '@endora-commerce/mod-transactional-emails/admin',
    section: 'messaging',
    routes: [
      '/transactional-emails',
      '/transactional-emails/blocks',
      '/transactional-emails/blocks/:id',
      '/transactional-emails/templates',
      '/transactional-emails/templates/:id',
      '/transactional-emails/:code',
    ],
    navTargets: [
      '/transactional-emails',
      '/transactional-emails/blocks',
      '/transactional-emails/templates',
    ],
    retiredSharedKeys: [
      'appShell.nav.transactionalEmails',
      'appShell.nav.emailBlocks',
      'appShell.nav.emailTemplates',
    ],
    locked: true,
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
    'appShell.section.messaging',
    'appShell.section.newsletter',
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
 * The deep-link cases below have to navigate somewhere real, and eight of this
 * batch's seventeen routes are parametric — the two campaign editors, the stats
 * screen, the automation builder and the two e-mail fragment editors among
 * them. A pattern rendered verbatim would navigate to a path with a literal
 * `:id` in it, which `react-router` matches just as happily and which therefore
 * proves the gate over a URL no operator can reach.
 */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, 'sample');
}

describe.each(SUBJECTS)('$module owns its admin surface', (subject) => {
  it('contributes its sidebar entries from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen. Every nav target, not only the landing
    // one — this batch contributes nine of them and a shell that dropped eight
    // would pass a single-entry check.
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
    // All seventeen, not the landing one: the batch's value is the whole
    // surface moving, and a registry that dropped a route would leave the
    // landing screen answering and the rest on the admin's not-found page.
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
    // **platform** axis — the one a `nonDeactivatable` module still has, and
    // the one a deployment that never installs it reaches. The registry still
    // names it: the registry answers "what could be here", and the render is
    // what withdraws it, so an operator's flip needs no rebuild.
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
    // The axis a locked module actually has (Ruling 2), moved on its own: a
    // test that only switched presence would pass with the permission gate
    // missing entirely. The near miss is this module's *other* real code, so
    // the case fails if the gate compares nothing — and for `newsletter` it is
    // sharper still, because three of its eleven routes declare exactly that
    // code and must stay open.
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

describe('newsletter is switchable, so the operator axis is real for it', () => {
  it('withdraws every one of its surfaces when the operator switches it off', async () => {
    // The axis `transactional_emails` does not have and this module does. The
    // frontend answers both from one presence projection, so the assertion is
    // the same shape — what differs is that an operator can produce this state
    // at runtime, which is what Constitution XVII item 5 is about. The server
    // half, where a deactivation is a real Setting write, is
    // `backend/test/integration/_admin_surfaces/batch-eleven-palette-off-state.test.ts`.
    const subject = SUBJECTS.find((entry) => entry.module === 'newsletter');
    expect(subject, 'newsletter must be a subject of this file').toBeDefined();
    if (subject === undefined) return;

    presentModules = new Set([subject.module, 'transactional_emails']);
    // Both modules' read codes, because the control below is the *other*
    // module's sidebar row staying put: an operator who could not open it
    // either way would make the control prove nothing.
    permissions = new Set([
      subject.permission,
      subject.nearMiss,
      'transactional_emails:read',
    ]);
    const on = renderAt('/');
    expect(sidebarHrefs()).toContain(subject.route);
    on.unmount();

    // The other module stays present throughout, so what is withdrawn is this
    // module's surface and not the shell's.
    presentModules = new Set(['transactional_emails']);
    const off = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs(), target).not.toContain(target);
    }
    expect(sidebarHrefs()).toContain('/transactional-emails');
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
        sourceOf(
          `../packages/modules/${subject.module}/i18n/${language}.json`,
        ),
      ) as Record<string, string>;
      expect(own[subject.labelKey], `${subject.labelKey} (${language})`).toBeTruthy();
    }
  });

  it('leaves no surface directory behind under admin/src/modules', () => {
    // Batch 8's finding, made an assertion. `check:module-boundary` exits 2 on
    // a directory named after a registered module that holds no file, and its
    // message sends the reader looking for a moved module root when the answer
    // is `rmdir`.
    expect(() => sourceOf(`src/modules/${subject.module}`)).toThrow();
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', async () => {
    const app = codeOf('src/App.tsx');
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-newsletter/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(subject.routes);
    for (const path of subject.routes) {
      expect(app, path).not.toContain(`<Route path="${path}"`);
    }
    // The import is the assertion that carries a `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile.
    // Read off the **code** rather than the source, because the comment this
    // batch left in `App.tsx` names both module directories in prose.
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
    )) as typeof import('@endora-commerce/mod-newsletter/admin');
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
    // The **landing** pair, because `newsletter` deliberately splits codes
    // across its own screens: `/newsletter/campaigns/new` and
    // `/newsletter/provider` are `newsletter:write` while the list is
    // `newsletter:read`.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-newsletter/admin');
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
    )) as typeof import('@endora-commerce/mod-newsletter/admin');
    const declared = new Set((contributions.routes ?? []).map((route) => route.path));
    for (const entry of contributions.nav ?? []) {
      expect(declared.has(entry.to), entry.to).toBe(true);
    }
  });
});

describe('the axis each module has is read off its manifest, never carried in this table', () => {
  it.each(SUBJECTS)('$module declares the activation shape this file assumes', async (subject) => {
    // `plan.md`'s Ruling 2, asserted rather than restated. What a lock removes
    // is the **operator's** ability to make `isPresent` answer `false`; the
    // presence cases above drive the platform axis, which the lock leaves.
    // Reading it here is what makes a module unlocked — or locked — one day
    // fail this file instead of quietly keeping a table row that says otherwise.
    const { manifest } = (await import(
      /* @vite-ignore */ subject.specifier.replace('/admin', '')
    )) as typeof import('@endora-commerce/mod-newsletter');
    const activation = manifest.activation;
    const locked = Boolean(activation && 'nonDeactivatable' in activation);
    expect(locked).toBe(subject.locked);
    if (locked && activation && 'nonDeactivatable' in activation) {
      expect(activation.reason).toBeTruthy();
    }
  });
});

describe('the surfaces neither module contributes, derived from the contribution set', () => {
  it.each(SUBJECTS)('$module contributes no zone', async (subject) => {
    // Ruling 1: the off-state test asserts every surface the module
    // contributes, and names the ones it does not **derived from the
    // contribution set** rather than asserted. Neither of these two declares a
    // zone contribution, so there is no rendering to withdraw — and this case
    // fails the day one is added without a proof of its own, which is what
    // makes the derivation worth writing down.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-newsletter/admin');
    expect(contributions.zones ?? []).toEqual([]);
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  const MOVED = [
    'newsletter/src/admin/api/newsletter-client.ts',
    'newsletter/src/admin/email-variables.ts',
    'newsletter/src/admin/pages/AutomationBuilder.tsx',
    'newsletter/src/admin/pages/AutomationsPage.tsx',
    'newsletter/src/admin/pages/BlocksPage.tsx',
    'newsletter/src/admin/pages/CampaignEditor.tsx',
    'newsletter/src/admin/pages/CampaignStats.tsx',
    'newsletter/src/admin/pages/CampaignsPage.tsx',
    'newsletter/src/admin/pages/ProviderSettingsPage.tsx',
    'newsletter/src/admin/pages/SubscribersPage.tsx',
    'newsletter/src/admin/pages/TagsPage.tsx',
    'transactional_emails/src/admin/api/transactional-emails-client.ts',
    'transactional_emails/src/admin/components/BrandingPanel.tsx',
    'transactional_emails/src/admin/components/EmailEditorPane.tsx',
    'transactional_emails/src/admin/pages/EmailBlockEditorPage.tsx',
    'transactional_emails/src/admin/pages/EmailBlocksPage.tsx',
    'transactional_emails/src/admin/pages/EmailEditor.tsx',
    'transactional_emails/src/admin/pages/EmailFragmentEditor.tsx',
    'transactional_emails/src/admin/pages/EmailTemplateEditorPage.tsx',
    'transactional_emails/src/admin/pages/EmailTemplatesPage.tsx',
    'transactional_emails/src/admin/pages/EmailsList.tsx',
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

  it('names no sibling module package at all', () => {
    // This batch's drain is zero and this is the assertion that it stayed zero.
    // `check:module-boundary` refuses an *unledgered* reach; what it cannot say
    // is that neither module grew a ledgered one either, which is the shape a
    // conversion most easily introduces — a screen reaching for a neighbour's
    // client because the neighbour's directory used to be two levels up.
    const reaching = MOVED.filter((file) =>
      codeOf(`../packages/modules/${file}`).includes('@endora-commerce/mod-'),
    );
    expect(reaching).toEqual([]);
  });
});

describe('both modules reach the e-mail builder as a package, which is why they are a batch', () => {
  const EMAIL_SPECIFIER = "from '@endora-commerce/page-builder-admin/email'";

  it('names the published subpath and no `_shared` path anywhere', () => {
    // The plan predicted this batch's drain as zero *because* P5b turned the
    // six `_shared/email-builder` reaches into bare specifiers. That is the
    // claim, and this is where it is measured rather than believed: the
    // directory those reaches named no longer exists, so a survivor would be an
    // unresolvable specifier — but only at build time, and only for whoever
    // built next.
    const consumers = [
      'newsletter/src/admin/email-variables.ts',
      'newsletter/src/admin/pages/AutomationBuilder.tsx',
      'newsletter/src/admin/pages/BlocksPage.tsx',
      'newsletter/src/admin/pages/CampaignEditor.tsx',
      'transactional_emails/src/admin/components/EmailEditorPane.tsx',
      'transactional_emails/src/admin/pages/EmailEditor.tsx',
      'transactional_emails/src/admin/pages/EmailFragmentEditor.tsx',
    ];
    for (const file of consumers) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).toContain(EMAIL_SPECIFIER);
      expect(source, file).not.toContain('_shared');
    }
  });

  it('declares the builder as a real npm peer of each consuming package', () => {
    // The reach survives into the emitted JavaScript by construction — the
    // builder is a component — so every consumer that bundles either admin
    // layer must resolve it. `manifests:generate` derives the peer from the
    // specifiers the sources actually import; the assertion is here because the
    // failure it prevents is a bundle that cannot resolve a specifier nothing
    // declared, which appears only on the first install from a registry.
    for (const module of ['newsletter', 'transactional_emails']) {
      const manifest = JSON.parse(
        sourceOf(`../packages/modules/${module}/package.json`),
      ) as { peerDependencies?: Record<string, string> };
      expect(
        manifest.peerDependencies?.['@endora-commerce/page-builder-admin'],
        module,
      ).toBeTruthy();
      expect(manifest.peerDependencies?.['@endora-commerce/admin-kit'], module).toBeTruthy();
    }
  });

  it('keeps the newsletter variable vocabulary in newsletter and not in the package', () => {
    // P5b's Z1.2 split, which this batch carries rather than re-decides: a
    // subscriber's address and an unsubscribe URL are one module's domain
    // vocabulary and all three consumers are that module's own screens, while
    // the branding pair and `mergeEmailVariables` are what any e-mail builder
    // needs. A merge that put them back together would fail here.
    const own = codeOf('../packages/modules/newsletter/src/admin/email-variables.ts');
    expect(own).toContain('NEWSLETTER_BASE_VARIABLES');
    expect(own).toContain(EMAIL_SPECIFIER);
    const shared = codeOf('../packages/page-builder-admin/src/email/variables.ts');
    expect(shared).not.toContain('NEWSLETTER_BASE_VARIABLES');
  });

  it('splits the fragment editor into two route components, one per kind', () => {
    // `App.tsx` wrote `element={<EmailFragmentEditor kind="block" />}` and its
    // template twin. A contribution declaration has nowhere to put a prop, so
    // the two lines the host held are two files now — and a batch that
    // collapsed them back into one would silently give both routes the same
    // `kind`, which is a screen editing the wrong thing rather than a screen
    // that fails.
    const block = codeOf(
      '../packages/modules/transactional_emails/src/admin/pages/EmailBlockEditorPage.tsx',
    );
    const template = codeOf(
      '../packages/modules/transactional_emails/src/admin/pages/EmailTemplateEditorPage.tsx',
    );
    expect(block).toContain('kind="block"');
    expect(template).toContain('kind="template"');
  });
});
