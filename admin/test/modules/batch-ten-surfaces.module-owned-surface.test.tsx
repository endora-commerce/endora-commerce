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
 * The reaches below are matched as **text**, and a comment saying why a file
 * does *not* take one of them names the shape it refuses — `ImageSettingInput`
 * carried a private `import.meta.env` read until this batch and the entry that
 * replaced it says so. Matching prose is the defect the check estate refuses by
 * reading literal AST nodes; this is the cheap version of the same rule, and it
 * is deliberately conservative: block comments go, and so do whole lines that
 * *begin* a line comment, but a `//` in mid-line is left alone so a URL inside a
 * string cannot truncate the code after it.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/**
 * The off-state proof `contracts/admin-contribution.md` R15 asks of feature
 * 091 batch 10's three converted modules — `dictionaries`, `settings` and
 * `credentials` — plus the fourth registration the batch moved, which is
 * `pwa`'s.
 *
 * ## Why these three, and what makes the batch a batch
 *
 * Re-derived on this branch before anything moved: the only debt among the
 * three is one file — `settings`' `ConfigurationReferenceInput.tsx` reaching
 * `credentials`' `ConfigurationPreviewModal`, plus the
 * `module-namespace:credentials` key that same file carried in
 * `foreign-module-ids.ts`. **Both endpoints of that repair are inside the
 * batch**, which is what makes it one: the old sequence split the two across
 * separate rows, so whichever ran first would have had to pay a reach whose
 * other end it was not moving. `dictionaries` joins because its own drain fell
 * from eleven to zero (batch 5 paid the five gateways' client reaches, batch 8
 * published both pickers into the kit) and it is coupled to nobody.
 *
 * ## Two of the three are locked, and that changes what is asserted rather than
 * whether
 *
 * `settings` and `dictionaries` each declare `activation.nonDeactivatable` with
 * a reason, so an operator cannot make `isPresent` answer `false` for either;
 * `credentials` is switchable and its operator axis is real. `plan.md`'s Ruling
 * 2 is what admits a locked module as a batch member: what a lock removes is
 * the operator's ability to produce the absent state at runtime, and it removes
 * nothing from the frontend's question, which is answered from a presence
 * projection either way. The presence cases below therefore drive the
 * **platform** axis — a deployment that never installs the module — for all
 * four subjects, and the lock is read off each manifest in its own case rather
 * than skipped, so a module unlocked one day fails here.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. Three of the four declare actions — `dictionaries` two for the first
 * time, replacing the hand-written `PALETTE_ITEMS` rows this batch deletes —
 * and `pwa` declares none, which is asserted rather than skipped. All four are
 * driven in
 * `backend/test/integration/_admin_surfaces/batch-ten-palette-off-state.test.ts`.
 * What this file asserts about the palette is the half that is the admin's:
 * that the shell keeps no hand-written copy for the server's answer to disagree
 * with.
 *
 * **Zones** are asserted absent from the contribution set itself rather than
 * from a rendering, because none of the four contributes one — see the
 * `describe` that reads `contributions.zones` instead of restating it.
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
    module: 'dictionaries',
    route: '/dictionary',
    // The module's only code. Every one of its 23 admin registrations enforces
    // it, reads included: the registry screen is an editing surface and this
    // module never split read from write.
    permission: 'dictionary.write',
    // A neighbouring module's read code, and the one an operator editing sales
    // channels most plausibly holds instead. There is no second `dictionary.*`
    // code to miss with, so the near miss has to come from outside.
    nearMiss: 'sales_channels:read',
    labelKey: 'nav.dictionary.label',
    specifier: '@endora-commerce/mod-dictionaries/admin',
    section: 'channels',
    routes: ['/dictionary', '/dictionaries/audit', '/admin/dictionaries/audit'],
    navTargets: ['/dictionary', '/admin/dictionaries/audit'],
    retiredSharedKeys: ['appShell.nav.dictionary', 'appShell.nav.dictionaryAudit'],
    locked: true,
  },
  {
    module: 'settings',
    route: '/settings',
    permission: 'settings:read',
    // The module's other code, and the sharp one: `/settings/cache` declares it
    // while `/settings` and `/settings/groups` declare the read code, so a gate
    // that treated the two as interchangeable would pass every case below.
    nearMiss: 'settings:write',
    labelKey: 'nav.settings.label',
    specifier: '@endora-commerce/mod-settings/admin',
    section: 'system',
    routes: ['/settings', '/settings/groups', '/settings/cache'],
    navTargets: ['/settings', '/settings/groups', '/settings/cache'],
    retiredSharedKeys: [
      'appShell.nav.settings',
      'appShell.nav.settingGroups',
      'appShell.nav.cache',
    ],
    locked: true,
  },
  {
    module: 'credentials',
    route: '/credentials',
    permission: 'credentials:read',
    // The module's write code, which gates `/credentials/new` and not the list:
    // the codes are opaque strings, so holding it opens neither the list nor
    // the sidebar row.
    nearMiss: 'credentials:write',
    labelKey: 'nav.credentials.label',
    specifier: '@endora-commerce/mod-credentials/admin',
    section: 'system',
    routes: ['/credentials', '/credentials/new'],
    navTargets: ['/credentials'],
    retiredSharedKeys: ['appShell.nav.credentials'],
    locked: false,
  },
  {
    // **The fourth registration the batch moved, and it is `pwa`'s.** Batch six
    // converted this module's sidebar entry alone and left `/settings/pwa` in
    // `App.tsx`, because `PwaPage` lived under `admin/src/modules/settings/`.
    // It recorded what that cost: a host `<Route>` is ungated, so an operator
    // who switched `pwa` off still reached the screen and met the module's own
    // 503 field by field — *"unchanged by this batch and closes when `settings`
    // moves"*. This is that batch, and the presence case below is the assertion
    // that it closed.
    module: 'pwa',
    route: '/settings/pwa',
    permission: 'pwa:read',
    // One of the module's two write codes. Neither opens the screen, and the
    // send-push one is what an operator sending campaigns would hold.
    nearMiss: 'pwa:send_push',
    labelKey: 'nav.pwa.label',
    specifier: '@endora-commerce/mod-pwa/admin',
    section: 'system',
    routes: ['/settings/pwa'],
    navTargets: ['/settings/pwa'],
    retiredSharedKeys: ['appShell.nav.pwa'],
    locked: false,
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
    'appShell.section.channels',
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
    // Principle XVII item 5, over every surface the module contributes, on the
    // **platform** axis — the one a `nonDeactivatable` module still has, and
    // the one a deployment that never installs it reaches. The registry still
    // names it: the registry answers "what could be here", and the render is
    // what withdraws it, so an operator's flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set([subject.permission]);
    const shell = renderAt('/');
    for (const target of subject.navTargets) {
      expect(sidebarHrefs()).not.toContain(target);
    }
    shell.unmount();

    for (const path of subject.routes) {
      const deepLink = renderAt(path);
      await waitFor(() => expect(notFoundIsRendered()).toBe(true));
      deepLink.unmount();
    }
  });

  it('contributes no surface to an operator without the code its route enforces', async () => {
    // The axis a locked module actually has (Ruling 2), moved on its own: a
    // test that only switched presence would pass with the permission gate
    // missing entirely. The codes are opaque strings, so a near miss — for two
    // of the four, this module's *other* real code — is not a match.
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

describe.each(SUBJECTS)('the shell no longer names $module by hand', (subject) => {
  it('has no host route, nav entry or palette row for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited. Leaving a `<Route>` standing beside the declaration would declare
    // the screen **twice**, with `react-router` silently taking the first
    // match, which D-23 calls the worst available failure.
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    for (const target of subject.navTargets) {
      expect(shell).not.toContain(`to: '${target}'`);
    }
    for (const key of subject.retiredSharedKeys) {
      expect(shell).not.toContain(key);
    }
  });

  it('leaves no surface directory behind under admin/src/modules', () => {
    // Batch 8's finding, made an assertion. `check:module-boundary` exits 2 on
    // a directory named after a registered module that holds no file, and its
    // message sends the reader looking for a moved module root when the answer
    // is `rmdir`. `pwa` never had one — its screen lived in `settings`' — so
    // the case is vacuous for that subject and true for the other three.
    expect(() => sourceOf(`../packages/admin-shell/src/modules/${subject.module}`)).toThrow();
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', async () => {
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-credentials/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(subject.routes);
    for (const path of subject.routes) {
      expect(app).not.toContain(`<Route path="${path}"`);
    }
    // The import is the assertion that carries a `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile.
    // Read off the **code** rather than the source: the comment that records
    // where `/settings/pwa` went names `modules/settings/pages/` in prose, and
    // matching prose is the defect the check estate refuses by reading literal
    // AST nodes. `pwa` is excluded because its screen came out of `settings`'
    // directory, which the previous assertion covers.
    if (subject.module !== 'pwa') {
      expect(codeOf('../packages/admin-shell/src/App.tsx')).not.toContain(`modules/${subject.module}`);
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
    )) as typeof import('@endora-commerce/mod-credentials/admin');
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
    // The **landing** pair, because two of the four deliberately split codes
    // across their own screens: `/settings/cache` is `settings:write` while
    // `/settings` is `settings:read`, and `/credentials/new` is
    // `credentials:write` while `/credentials` is `credentials:read`.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-credentials/admin');
    const landing = (contributions.routes ?? []).find((route) => route.path === subject.route);
    expect(landing?.requiredPermission).toBe(subject.permission);
    const entry = (contributions.nav ?? []).find((nav) => nav.to === subject.route);
    expect(entry?.requiredPermission).toBe(subject.permission);
    expect(entry?.section).toBe(subject.section);
    expect(entry?.labelKey).toBe(subject.labelKey);
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
    )) as typeof import('@endora-commerce/mod-credentials');
    const activation = manifest.activation;
    const locked = Boolean(activation && 'nonDeactivatable' in activation);
    expect(locked).toBe(subject.locked);
    if (locked && activation && 'nonDeactivatable' in activation) {
      expect(activation.reason).toBeTruthy();
    }
  });
});

describe('the surfaces none of the four contributes, derived from the contribution set', () => {
  it.each(SUBJECTS)('$module contributes no zone', async (subject) => {
    // Ruling 1: the off-state test asserts every surface the module
    // contributes, and names the ones it does not **derived from the
    // contribution set** rather than asserted. None of these four declares a
    // zone contribution, so there is no rendering to withdraw — and this case
    // fails the day one is added without a proof of its own, which is what
    // makes the derivation worth writing down.
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-credentials/admin');
    expect(contributions.zones ?? []).toEqual([]);
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  const MOVED = [
    'dictionaries/src/admin/api/client.ts',
    'dictionaries/src/admin/components/EntryStatusBadges.tsx',
    'dictionaries/src/admin/components/LanguagePicker.tsx',
    'dictionaries/src/admin/components/TranslationsDrawer.tsx',
    'dictionaries/src/admin/pages/AuditPage.tsx',
    'dictionaries/src/admin/pages/DictionaryPage.tsx',
    'dictionaries/src/admin/tabs/CountriesTab.tsx',
    'dictionaries/src/admin/tabs/CurrenciesTab.tsx',
    'dictionaries/src/admin/tabs/LanguagesTab.tsx',
    'settings/src/admin/api/settings-client.ts',
    'settings/src/admin/components/ActivationPointerRow.tsx',
    'settings/src/admin/components/AssetIdSettingInput.tsx',
    'settings/src/admin/components/ConfigurationReferenceInput.tsx',
    'settings/src/admin/components/ConflictBanner.tsx',
    'settings/src/admin/components/ImageSettingInput.tsx',
    'settings/src/admin/components/QuoteRequestsSettingsTab.tsx',
    'settings/src/admin/components/SellerCompanyDataInput.tsx',
    'settings/src/admin/components/SettingRowEditor.tsx',
    'settings/src/admin/pages/CachePage.tsx',
    'settings/src/admin/pages/GroupsPage.tsx',
    'settings/src/admin/pages/SettingsPage.tsx',
    'credentials/src/admin/api/credentials-client.ts',
    'credentials/src/admin/components/ConfigurationForm.tsx',
    'credentials/src/admin/pages/CredentialsNewPage.tsx',
    'credentials/src/admin/pages/CredentialsPage.tsx',
    'credentials/src/admin-ui/ConfigurationPreviewModal.tsx',
    'pwa/src/admin/api/pwa-client.ts',
    'pwa/src/admin/components/PushAudienceRuleBuilder.tsx',
    'pwa/src/admin/pages/PwaPage.tsx',
  ];

  it('names no `@/` alias and reads no bundler environment', () => {
    // The alias resolves to `admin/src` and to nothing an installed package can
    // reach, so a surviving one would be a screen that compiles here and not in
    // a consumer's install. `import.meta.env` is Vite's, and a package's
    // `tsconfig.ui.json` carries no `vite/client` types — this batch removed
    // two reads of it, `ImageSettingInput`'s and `pwa-client`'s.
    for (const file of MOVED) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).not.toMatch(/from '@\//m);
      expect(source, file).not.toContain('import.meta.env');
    }
  });

  it('names one module package, at one supported subpath, in one file', () => {
    // The batch's only cross-package reach, and the assertion that it is the
    // only one. `check:module-boundary` refuses an unledgered reach and this
    // says something it cannot: that no *other* moved file grew one.
    const reaching = MOVED.filter((file) =>
      codeOf(`../packages/modules/${file}`).includes('@endora-commerce/mod-'),
    );
    expect(reaching).toEqual([
      'settings/src/admin/components/ConfigurationReferenceInput.tsx',
    ]);
  });

  it('takes toAbsoluteAssetUrl from the kit rather than re-implementing it', () => {
    // Batch 9's repair, met a second time in a file that batch could not see:
    // `ImageSettingInput` carried its own copy over a private
    // `import.meta.env.VITE_API_BASE_URL` read, invisible to P4c because a copy
    // in a module's own file is not a *cross-module* reach. There is one
    // implementation of this two-branch function in the tree and it is
    // `@endora-commerce/admin-kit/lib`'s.
    const input = codeOf(
      '../packages/modules/settings/src/admin/components/ImageSettingInput.tsx',
    );
    expect(input).toContain(
      "import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';",
    );
    expect(input).not.toContain('function toAbsoluteAssetUrl');
  });
});

describe('the settings → credentials seam, which is the batch’s one repair', () => {
  it('reaches the owner at its published `./admin-ui` subpath and nowhere else', () => {
    // D-191's exit, taken here for the first time in the repository. A relative
    // reach into the owner's `src/` would evaluate a second copy of the module
    // beside the one the platform composed; a reach at `./admin` would be into
    // a contribution *descriptor* the owner publishes for the registry alone.
    const source = codeOf(
      '../packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx',
    );
    expect(source).toContain(
      "import { ConfigurationPreviewModal } from '@endora-commerce/mod-credentials/admin-ui';",
    );
  });

  it('is a real npm peer of the consuming package, not a devDependency alone', () => {
    // The reach survives into the emitted JavaScript by construction — that is
    // what a component is — so every consumer that bundles this package's admin
    // layer must resolve the owner. `manifests:generate` derives this; the
    // assertion is here because the failure it prevents is a bundle that cannot
    // resolve a specifier nothing declared, which appears only on the first
    // install from a registry.
    const manifest = JSON.parse(
      sourceOf('../packages/modules/settings/package.json'),
    ) as { peerDependencies?: Record<string, string> };
    expect(manifest.peerDependencies?.['@endora-commerce/mod-credentials']).toBe('workspace:*');
  });

  it('gates the owner’s component on the owner’s presence, in the consumer', () => {
    // Z12. A statically imported component is filtered by nothing, and
    // `credentials` is switchable — so with it off the modal would render over
    // an API that answers 503. The gate is the consumer's because only the
    // consumer knows what the absence should collapse: the preview button, and
    // not the field or its stored value.
    const source = codeOf(
      '../packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx',
    );
    expect(source).toContain("useSurfaceVisibility");
    expect(source).toContain("{ module: 'credentials' }");
  });

  it('renders the button’s label out of the settings bundle, in both languages', () => {
    // The `foreign-module-ids` half of the repair, and the reason it is an
    // assertion rather than a ledger deletion. That check's population is
    // `admin/src/modules/**`, so this file leaving it would have made the entry
    // read stale whether or not anybody repaired anything — *"the file left the
    // walk"* and *"the coupling went"* produce the identical diff. This is the
    // difference, stated where it can fail.
    const source = codeOf(
      '../packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx',
    );
    expect(source).toContain("useTranslation('settings')");
    expect(source).not.toContain("useTranslation('credentials')");
    for (const language of ['en', 'pl']) {
      const bundleText = JSON.parse(
        sourceOf(`../packages/modules/settings/i18n/${language}.json`),
      ) as Record<string, string>;
      expect(bundleText['editor.credentialRef.preview']).toBeTruthy();
    }
  });
});
