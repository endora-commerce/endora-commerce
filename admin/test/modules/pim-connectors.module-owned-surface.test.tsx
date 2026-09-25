import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** One of the repository's source files, read as text, relative to `admin/`. */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * The same file with its comments removed.
 *
 * `pim_unopim`'s reaches below are matched as **text**, and the comments feature
 * 091's batch 13 left in `App.tsx` and `AppShell.tsx` name the routes and the
 * modules they record having moved. `pim_akeneo`'s and `pim_pimcore`'s cases read
 * the raw source, comments included, as they always have: the fold changes no
 * assertion's reading.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line))
    .join('\n');
}

/**
 * The **host's** half of the three PIM connectors' admin surfaces —
 * `pim_akeneo` (feature 094), `pim_pimcore` (feature 092, US7 / T084) and
 * `pim_unopim` (feature 089; feature 091 `contracts/admin-contribution.md`
 * R15) — narrowed by feature 134 **W2.2** (**D-262** clause 3) so that the
 * modules can leave without taking the shell's proof with them, and folded into
 * one file under a **family name** by feature 134 **E3p.4**.
 *
 * ## Why one file, and why this name
 *
 * The remainder that stays here is host hygiene, and a staying file whose path
 * carries a departing id is either withheld from the public tree by 129
 * FR-011(a)'s `admin/test/modules/<id>/` satellite rule — which would silently
 * delete a free test — or refused by FR-011(d). So the three remainders live
 * under a name that is no module's id, on the precedent both earlier waves set:
 * `carrier-settings.module-owned-surface.test.tsx` and
 * `payment-gateway-settings.module-owned-surface.test.tsx`. They were
 * `admin/test/modules/pim-akeneo.module-owned-surface.test.tsx`,
 * `admin/test/modules/pim-pimcore.module-owned-surface.test.tsx` and
 * `admin/test/modules/pim_unopim/pim-unopim-surface.module-owned-surface.test.tsx`;
 * the last was renamed into this path in a commit that did nothing else, so its
 * history follows the file. Every assertion of the three is below; the three
 * byte-identical registry cases are stated once, because none of them named a
 * module.
 *
 * ## The four subjects, and where each of them went
 *
 * An admin test of a departing module is dispositioned by **subject**; it is not
 * carried, not moved wholesale and not deleted wholesale.
 *
 * | subject | where it is now |
 * | --- | --- |
 * | each module's **declaration** — its routes, gates, sidebar row, zones and lazy factories, and for `pim_unopim` its nav label in both bundles and the activation shape those cases are asserted against | inside each package, at its own `src/admin/index.test.ts`, under its own `environment: 'node'` config. The shipped precedent is `packages/modules/invoice_ledger/src/admin/index.test.ts` |
 * | each package's own **source hygiene** — no `@/` reach out of the package, no screen-level presence probe, `pim_akeneo`'s *no mapping editor in this snapshot*, `pim_unopim`'s *no `import.meta.env`, no sibling module package, T080's shared components kept inside it*, and the bundle half of `pim_pimcore`'s run-detail proof, that every contract reason has an operator sentence | the same package, at `src/admin/index.test.ts` (and `pim_pimcore`'s `src/admin/issue-reasons.test.ts`), each `readFileSync` over `admin/`'s working directory becoming a read relative to the package's own sources |
 * | **host hygiene** — `App.tsx`, `AppShell.tsx`, the shared `_i18n` bundle, `admin/src/modules.generated.ts` and `admin-shell/src/modules/` never naming these modules by hand, and no host route adding a mapping screen | **here**, below, and unchanged in substance |
 * | the **rendered** route, sidebar, zone and screen cases | deleted, under W2.3's condition and against the drivers named in the next section |
 *
 * The first two travel because they are answerable with no jsdom, no RTL and no
 * `admin/test/helpers/` — none of which a package may name
 * (`module-test-ownership.md` §3) and none of which is published. The third stays
 * because **an absence assertion about the shell stays true and stays useful after
 * a module goes: what it refuses is a host file *regaining* a paid name**, which is
 * the `carrier-settings.module-owned-surface.test.tsx` precedent.
 *
 * **No path into a departing package is written anywhere in this file**, not even
 * in prose: the extraction gate's admin rung matches a **string literal** of the
 * specifier as well as an import, so an address here would refuse the extraction
 * it is explaining.
 *
 * ## What was deleted, the drivers that survive it, and how to read it back
 *
 * From `pim_akeneo`'s file, four rendered cases, all from `describe('pim_akeneo
 * owns its admin surface')`: *contributes its sidebar entry from the registry,
 * labelled in its own namespace*, *contributes nothing while the module is
 * switched off*, *contributes nothing to an operator without the code its routes
 * enforce*, and *restores the entry when the module comes back, with no rebuild*.
 * They rendered `AppShell` and drove `registryNavFor`'s presence and permission
 * gates. The one rendered case in
 * `admin/test/modules/pim_akeneo/AkeneoRunDetailPage.test.tsx` went with them,
 * and `admin/test/modules/pim_akeneo/no-mapping-editor.test.tsx` was split
 * between this file and the package.
 *
 * From `pim_pimcore`'s file, the same four cases from `describe('pim_pimcore owns
 * its admin surface')`. Three more went with
 * `admin/test/modules/pim_pimcore/PimcoreRunDetailPage.test.tsx`, and two
 * two-contributor zone cases went from
 * `admin/test/modules/pim_ergonode/field-protection-zone.test.tsx`, which is
 * `pim_ergonode`'s file and was narrowed rather than absorbed.
 *
 * From `pim_unopim`'s file, eleven rendered cases. Six drove `App`,
 * `ModuleRoute` and `registryNavFor`: *contributes its sidebar entry from the
 * registry, labelled in its own namespace*, *renders every one of its seven
 * screens at its own route while present*, *contributes no surface while the
 * module is absent from the platform*, *withdraws every surface when the operator
 * switches the module off*, *contributes no surface to an operator without the
 * code its routes enforce*, and *restores both surfaces when the code is granted
 * again, with no rebuild*. Five drove `<AdminZone>` over the real provider:
 * *renders a protection control in each of the three, labelled as UnoPim*,
 * *renders nothing at all without catalog:write, and fetches no chunk*, and
 * *contributes nothing to any of the three while the module is off*, with the two
 * declaration-only cases of that `describe` travelling into the package instead.
 * Two more went with `admin/test/modules/pim_unopim/UnopimRunDetailPage.test.tsx`.
 *
 * W2.3 permits that deletion **only against a module that is staying and still
 * drives the same member of the same mechanism over a real declaration**, named
 * per case:
 *
 *  * the sidebar and route gates, on both axes and in both directions —
 *    `admin/test/modules/batch-sixteen-surfaces.module-owned-surface.test.tsx`
 *    over **`cms`** and **`blog`**, two free modules whose declarations are in
 *    this repository: it renders every one of their screens and sidebar rows while
 *    present, contributes no surface while the module is absent from the platform,
 *    withdraws everything the operator switches off, contributes no surface to an
 *    operator holding only the module's **own write code** — the near-miss shape,
 *    `cms.write` and `blog.write`, which is what the deleted permission cases used
 *    — and restores both surfaces when the code is granted again;
 *  * the `<AdminZone>` presence and permission gates, including *fetches no
 *    chunk* — `admin/test/modules/inventory/channel-warehouses-zone.test.tsx` over
 *    **`inventory`** and
 *    `admin/test/modules/quick_order/quick-order-zones.test.tsx` over
 *    **`quick_order`**, both over the module's own imported `contributions`: each
 *    renders its panel while present, renders nothing while the module is switched
 *    off and fetches no chunk, renders nothing without the declared code and
 *    fetches no chunk, and restores the zone when the module comes back.
 *
 * The deleted bodies are read back from the parent of the commit that removed
 * them, `039e78c67`, which is on `master` and so does not move under a rebase:
 *
 * ```
 * git show 039e78c67^:admin/test/modules/pim-akeneo.module-owned-surface.test.tsx
 * git show 039e78c67^:admin/test/modules/pim-pimcore.module-owned-surface.test.tsx
 * git show 039e78c67^:admin/test/modules/pim_unopim/pim-unopim-surface.module-owned-surface.test.tsx
 * ```
 *
 * and the same expression with `admin/test/modules/pim_akeneo/no-mapping-editor.test.tsx`,
 * `admin/test/modules/pim_akeneo/AkeneoRunDetailPage.test.tsx`,
 * `admin/test/modules/pim_pimcore/PimcoreRunDetailPage.test.tsx`,
 * `admin/test/modules/pim_unopim/UnopimRunDetailPage.test.tsx` or
 * `admin/test/modules/pim_ergonode/field-protection-zone.test.tsx`. The three
 * narrowed remainders this file replaced are read back the same way from the
 * parent of the commit that folded them.
 *
 * **What is genuinely lost is stated rather than smuggled**: the *conjunction* over
 * these modules' **real** declarations, and the rendered run-detail screens. The
 * mechanism keeps real subjects here, and each declaration keeps a test — a
 * stronger one, because it now runs in the module's own suite as well. The paid
 * repository holds no admin off-state proof for any module it receives and will
 * hold none until it has an admin test host; that is D-262 clause 3's accepted
 * reduction in the admin half of Constitution XVII item 6's proof, and when it is
 * repaired is the owner's decision. `check:off-state-coverage`'s counter does not
 * measure any of this — its walk root is `backend/test` alone — so a green
 * `switchable=N proven=N findings=0` after this change is not a claim about the
 * admin half.
 *
 * The **palette** half is the server's and is driven from
 * `backend/test/integration/pim_akeneo/`, `backend/test/integration/pim_pimcore/`
 * and `backend/test/integration/_admin_surfaces/pim-unopim-palette-off-state.test.ts`,
 * which are host files under D-252 and travel to the paid repository's host.
 */

/**
 * The modules, identified by id, route and key names — **string literals, never
 * specifiers**, so that the absences below keep working once the modules are
 * installed from tarballs rather than resolved in this workspace.
 */
const AKENEO_ID = 'pim_akeneo';
const AKENEO_ROUTE = '/pim-akeneo';
const PIMCORE_ID = 'pim_pimcore';
const PIMCORE_ROUTE = '/pim-pimcore';
const UNOPIM_ROUTE = '/pim-unopim';

/** The `_i18n` keys the shell must no longer name for `pim_unopim`. */
const UNOPIM_RETIRED_SHARED_KEYS = [
  'appShell.nav.pimUnopim',
  'appShell.nav.pimUnopimRuns',
  'appShell.nav.pimUnopimAttributeMappings',
  'appShell.nav.pimUnopimChannelLocaleMappings',
  'appShell.nav.pimUnopimCategoryMappings',
  'appShell.nav.pimUnopimAssociationMappings',
  'appShell.nav.pimUnopimRunDetail',
];

/** Every surface directory `pim_unopim`'s conversion emptied under `admin-shell/src/modules`. */
const UNOPIM_SURFACE_DIRECTORIES = ['pim_unopim', 'pim_connector'];

/** Every route `pim_unopim` contributes; asserted here as an absence from the host. */
const UNOPIM_ROUTES = [
  '/pim-unopim',
  '/pim-unopim/channel-locale-mappings',
  '/pim-unopim/attribute-mappings',
  '/pim-unopim/category-mappings',
  '/pim-unopim/association-mappings',
  '/pim-unopim/runs',
  '/pim-unopim/runs/:runId',
];

describe('the shell never named pim_akeneo by hand', () => {
  it('has no route, nav entry or palette row for the module', () => {
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('AkeneoConnectionPage');
    expect(app).not.toContain(`modules/${AKENEO_ID}`);
    // The mapping screen half of `no-mapping-editor.test.tsx`: the host adds no
    // route under this module's prefix, mapping grid or otherwise.
    expect(app).not.toContain(`path="${AKENEO_ROUTE}`);
    expect(app).not.toContain('AkeneoMapping');
    expect(shell).not.toContain(`'${AKENEO_ROUTE}'`);
    expect(shell).not.toContain('appShell.nav.pimAkeneo');
  });
});

describe('the shell never named pim_pimcore by hand', () => {
  it('has no route, nav entry or palette row for the module', () => {
    // `App.tsx` and `AppShell.tsx` are the two registries 11 of the last 12
    // module additions edited. This one edits neither — including `PALETTE_ITEMS`,
    // where a hand-written copy would advertise two of the manifest's own three
    // actions a second time and would go on advertising them after an operator
    // switched the module off, because nothing on the server would have been
    // asked.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('PimcoreConnectionPage');
    expect(app).not.toContain(`modules/${PIMCORE_ID}`);
    expect(app).not.toContain(`path="${PIMCORE_ROUTE}`);
    expect(shell).not.toContain(`'${PIMCORE_ROUTE}'`);
    expect(shell).not.toContain('appShell.nav.pimPimcore');
  });
});

describe('the shell no longer names pim_unopim by hand', () => {
  it('has no host route, nav entry or breadcrumb rule for the module', () => {
    // The evidence that feature 091's conversion converted something. Leaving a
    // `<Route>` standing beside the declaration would declare the screen
    // **twice**, with `react-router` silently taking the first match, which D-23
    // calls the worst available failure.
    const shell = codeOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(shell).not.toContain(`to: '${UNOPIM_ROUTE}'`);
    for (const key of UNOPIM_RETIRED_SHARED_KEYS) {
      expect(shell, key).not.toContain(key);
    }
    // The six hand-written `CRUMB_DICT` trails went with the row: `registryCrumbs`
    // derives them from the sidebar entry the module declares.
    expect(shell).not.toContain('pim-unopim');
  });

  it('drops the retired keys from the shared _i18n bundle, in both languages', () => {
    // A key nothing renders is a key the next module author copies, and `_i18n` is
    // one of the four shared files feature 091 exists to stop a module author
    // having to edit. Both shipped languages, because a key retired in one and
    // left in the other is what `check:bundle-pairing` exists for one layer up.
    for (const language of ['en', 'pl']) {
      const shared = JSON.parse(
        sourceOf(`../packages/modules/_i18n/i18n/${language}.json`),
      ) as Record<string, string>;
      for (const key of UNOPIM_RETIRED_SHARED_KEYS) {
        expect(shared[key], `${key} (${language})`).toBeUndefined();
      }
    }
  });

  it('leaves no surface directory behind under admin-shell/src/modules', () => {
    // Batch 8's finding, made an assertion: `check:module-boundary` exits 2 on a
    // directory named after a registered module that holds no file, and its
    // message sends the reader looking for a moved module root when the answer is
    // `rmdir`. Both directories, `pim_connector` being the one T080 created and
    // the conversion emptied.
    for (const directory of UNOPIM_SURFACE_DIRECTORIES) {
      expect(
        () => sourceOf(`../packages/admin-shell/src/modules/${directory}`),
        directory,
      ).toThrow();
    }
  });

  it('declares none of the module’s routes in App.tsx', () => {
    const app = codeOf('../packages/admin-shell/src/App.tsx');
    for (const path of UNOPIM_ROUTES) {
      expect(app, path).not.toContain(`<Route path="${path}"`);
    }
    // The import is the assertion that carries a `<Route>` with it: a route
    // element naming a component `App.tsx` no longer imports does not compile.
    for (const directory of UNOPIM_SURFACE_DIRECTORIES) {
      expect(app, directory).not.toContain(`modules/${directory}`);
    }
  });
});

describe('the shell resolves every PIM connector screen through its package', () => {
  it('resolves a module screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into a package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which is
    // silent in a frontend.
    //
    // **No per-module positive assertion.** It named each module's specifier until
    // the narrowing; a `toContain` on a specifier that is no longer installed
    // would refuse the extraction rather than report a defect, which is the half
    // `carrier-settings.module-owned-surface.test.tsx` had to drop twice. What is
    // left states the rule over the **whole** generated registry — which is why
    // the three files this one folds carried this case byte for byte, and why it
    // is stated once.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).not.toContain('packages/modules');
    // The registry must not be empty, or the absence above proves nothing: a file
    // that imported nothing at all would pass it.
    expect(registry).toContain("from '@endora-commerce/mod-");
  });
});
