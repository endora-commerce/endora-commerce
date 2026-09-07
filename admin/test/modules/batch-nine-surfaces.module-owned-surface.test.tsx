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
 * does *not* take one of them names the shape it refuses — `AssetDetailDrawer`
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
 * 091 batch 9's two converted modules — `assets_library` and `custom_fields`.
 *
 * ## Why these two, and why the proof is the same shape as batch 8's
 *
 * Both are **drain 0**: no cross-module admin reach in either direction, no
 * `admin-surface.ts` key, no `foreign-module-ids.ts` key. They sat in the
 * plan's *last* batch on figures P4c and P4e had already paid off, and the
 * drain re-derivation of 2026-09-01 is what found that. So each contributes
 * exactly the two surfaces `App.tsx`'s `ModuleRoute` and `composeNav`'s filter
 * gate — one route and one sidebar entry — and the four cases below are one
 * table driven twice.
 *
 * ## Both are locked, and that changes what is asserted rather than whether
 *
 * `assets_library` and `custom_fields` each declare
 * `activation.nonDeactivatable` with a reason, so an operator cannot make
 * `isPresent` answer `false` for either. `plan.md`'s Ruling 2 is what admits
 * them as a batch: a locked module is outside Constitution XVII item 6's
 * population by the owner's own measurement in `specs/deferred-defects.md`,
 * and what it still has is the **permission** axis, which `useSurfaceVisibility`
 * gates identically.
 *
 * The presence cases below are driven all the same, and the axis they drive is
 * the **platform** one — a deployment that never installs the module, which a
 * lock does not remove. What a lock removes is the operator's ability to
 * produce that state at runtime; it removes nothing from the frontend's
 * question, which is answered from a presence projection either way. The
 * missing axis is asserted as a fact **read from the manifest** rather than as
 * a skipped test, so a module unlocked one day fails here instead of quietly
 * keeping a test that says it cannot be switched off.
 *
 * ## What is not asserted here, derived rather than declared
 *
 * The **palette** is the server's: its Actions group is resolved from the
 * manifests against the effective enabled-set, and no admin-side test can see
 * it. `custom_fields` declares `open-custom-fields` and `assets_library`
 * declares nothing at all; both answers are driven in
 * `backend/test/integration/_admin_surfaces/batch-nine-palette-off-state.test.ts`.
 * What this file asserts about the palette is the half that is the admin's:
 * that the shell keeps no hand-written copy for the server's answer to disagree
 * with.
 *
 * **Zones** are asserted absent from the contribution set itself rather than
 * from a rendering, because neither module contributes one — see the last
 * `describe`, which reads `contributions.zones` instead of restating it.
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
  readonly retiredSharedKey: string;
}

const SUBJECTS: readonly Subject[] = [
  {
    module: 'assets_library',
    route: '/assets-library',
    permission: 'assets.read',
    // The module's other code, and the one an operator most plausibly holds
    // instead: it opens no screen on its own, and the codes are opaque strings.
    nearMiss: 'assets.write',
    labelKey: 'nav.assetsLibrary.label',
    specifier: '@endora-commerce/mod-assets-library/admin',
    section: 'catalog',
    routes: ['/assets-library'],
    retiredSharedKey: 'appShell.nav.assetsLibrary',
  },
  {
    module: 'custom_fields',
    route: '/custom-fields',
    permission: 'custom_fields:read',
    nearMiss: 'custom_fields:write',
    labelKey: 'nav.customFields.label',
    specifier: '@endora-commerce/mod-custom-fields/admin',
    section: 'system',
    routes: ['/custom-fields'],
    retiredSharedKey: 'appShell.nav.customFields',
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
 * Both screens fetch on mount. The mock is at the **kit's** barrel, which is
 * the specifier a packaged screen resolves — the admin resolves the same
 * module, so one mock covers both sides of the move.
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
    'appShell.section.catalog',
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
    // Principle XVII item 5, over both surfaces the module contributes, on the
    // **platform** axis — the one a `nonDeactivatable` module still has, and
    // the one a deployment that never installs it reaches. The registry still
    // names it: the registry answers "what could be here", and the render is
    // what withdraws it, so an operator's flip needs no rebuild.
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
    // The axis a locked module actually has (Ruling 2), moved on its own: a
    // test that only switched presence would pass with the permission gate
    // missing entirely. The codes are opaque strings, so a near miss from the
    // same module is not a match.
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
    // The restoration half, driven on the permission axis rather than the
    // presence one, because that is the axis these two modules have: an
    // operator's role changing must take effect without a rebuild exactly as an
    // activation flip must.
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
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    // The import is the assertion that carries the `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile,
    // so this one line refuses both halves. The route paths themselves are
    // asserted per declared path in the case below, which is the finer question
    // — a path can survive under a different component.
    expect(app).not.toContain(`modules/${subject.module}`);
    expect(shell).not.toContain(`to: '${subject.route}'`);
    expect(shell).not.toContain(subject.retiredSharedKey);
  });

  it('leaves no surface directory behind under admin/src/modules', () => {
    // Batch 8's finding, made an assertion. `check:module-boundary` exits 2 on
    // a directory named after a registered module that holds no file, and its
    // message sends the reader looking for a moved module root when the answer
    // is `rmdir`. `custom_fields` had a second reason to be checked: P4e left a
    // re-export shim there for `CustomFieldValuesPanel`, kept *"for the owner's
    // own screens"*, and the owner's screens are in its package now.
    expect(() => sourceOf(`../packages/admin-shell/src/modules/${subject.module}`)).toThrow();
  });

  it('declares every one of its routes exactly once, and nowhere in App.tsx', async () => {
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const { contributions } = (await import(
      /* @vite-ignore */ subject.specifier
    )) as typeof import('@endora-commerce/mod-assets-library/admin');
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
    )) as typeof import('@endora-commerce/mod-assets-library/admin');
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
    )) as typeof import('@endora-commerce/mod-assets-library/admin');
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe(subject.permission);
    }
    expect(contributions.nav?.[0]?.requiredPermission).toBe(subject.permission);
    expect(contributions.nav?.[0]?.section).toBe(subject.section);
    expect(contributions.nav?.[0]?.labelKey).toBe(subject.labelKey);
  });
});

describe('both modules are locked, and the axis they lack is read off the manifest', () => {
  it.each(SUBJECTS)(
    '$module declares nonDeactivatable with a reason, so its operator axis is closed',
    async (subject) => {
      // `plan.md`'s Ruling 2, asserted rather than restated. What a lock removes
      // is the **operator's** ability to make `isPresent` answer `false`; the
      // presence cases above drive the platform axis, which the lock leaves.
      // Reading it here is what makes a module unlocked one day fail this file
      // instead of quietly keeping a test that says it cannot be switched off.
      const { manifest } = (await import(
        /* @vite-ignore */ subject.specifier.replace('/admin', '')
      )) as typeof import('@endora-commerce/mod-assets-library');
      const activation = manifest.activation;
      expect(activation && 'nonDeactivatable' in activation).toBe(true);
      expect(
        activation && 'nonDeactivatable' in activation ? activation.reason : null,
      ).toBeTruthy();
    },
  );
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
    )) as typeof import('@endora-commerce/mod-assets-library/admin');
    expect(contributions.zones ?? []).toEqual([]);
  });

  it('assets_library advertises no palette action, and custom_fields advertises one', async () => {
    // The other half of Ruling 1, read off the **manifests**. It is asserted
    // here as a fact about the declaration and driven for real in
    // `backend/test/integration/_admin_surfaces/batch-nine-palette-off-state.test.ts`,
    // which is where the server's effective enabled-set can be seen at all.
    // `assets_library` declaring none is not an omission this batch repairs:
    // choosing a landing action for a screen is a product decision, not a file
    // move.
    const assets = (await import('@endora-commerce/mod-assets-library')).manifest;
    const customFields = (await import('@endora-commerce/mod-custom-fields')).manifest;
    expect(assets.actions ?? []).toEqual([]);
    expect((customFields.actions ?? []).map((action) => action.id)).toEqual([
      'open-custom-fields',
    ]);
    expect((customFields.actions ?? [])[0]?.targetRoute).toBe('/custom-fields');
  });
});

describe('the moved screens take no reach the package cannot resolve', () => {
  it('names no `@/` alias and no sibling module package', () => {
    // The alias resolves to `admin/src` and to nothing an installed package can
    // reach, so a surviving one would be a screen that compiles here and not in
    // a consumer's install. A `@endora-commerce/mod-…` specifier would be a
    // boundary reach `check:module-boundary` counts.
    const files = [
      'assets_library/src/admin/pages/LibraryPage.tsx',
      'assets_library/src/admin/components/AssetDetailDrawer.tsx',
      'assets_library/src/admin/components/FolderTree.tsx',
      'assets_library/src/admin/api/assets-library-client.ts',
      'custom_fields/src/admin/pages/CustomFieldsPage.tsx',
      'custom_fields/src/admin/api/custom-fields-client.ts',
    ];
    for (const file of files) {
      const source = codeOf(`../packages/modules/${file}`);
      expect(source, file).not.toMatch(/from '@\//m);
      expect(source, file).not.toMatch(/from '@endora-commerce\/mod-/m);
      // `import.meta.env` is Vite's and the package's own `tsconfig.ui.json`
      // carries no `vite/client` types. `AssetDetailDrawer` read
      // `VITE_API_BASE_URL` by hand, under a private re-implementation of
      // `toAbsoluteAssetUrl` that P4c could not see — a copy in the owner's own
      // file is not a cross-module reach — and now takes the kit's.
      expect(source, file).not.toContain('import.meta.env');
    }
  });

  it('takes toAbsoluteAssetUrl from the kit rather than re-implementing it', () => {
    // The repair stated as its own assertion, because the case above would pass
    // just as well if the helper had been rewritten to read a constant. There
    // is one implementation of this two-branch function in the tree and it is
    // `@endora-commerce/admin-kit/lib`'s; a second one that agrees today is a
    // second one that disagrees after the next edit to the API origin.
    const drawer = codeOf(
      '../packages/modules/assets_library/src/admin/components/AssetDetailDrawer.tsx',
    );
    expect(drawer).toContain(
      "import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';",
    );
    expect(drawer).not.toContain('function toAbsoluteAssetUrl');
  });
});
