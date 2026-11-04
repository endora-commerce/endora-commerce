/**
 * CI check — a manifest action's `requiredPermission` is the code enforced on
 * its own `targetRoute` (issue #232, Principle XVI item 2). **Repository-scope
 * host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/action-route-permissions.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its three findings, its three-level route reconstruction, its
 * sufficiency predicate and its population walk. This file resolves this
 * repository's module walk roots, its overlay root, its emitted-artefact
 * freshness and its floors, and it holds `ACTION_PERMISSION_DISAGREEMENTS`
 * below: a ledger is a statement about *this* tree's owner decisions and does
 * not travel. The forwarding specifier is **bare**, never a path into `dist`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { activeOverlayModulesRoot } from '../src/overlay/overlay-roots.js';
import {
  analyse,
  collectRouteSources as walk,
  keyOf,
  renderClauses,
  resolveTarget,
  type ActionRecord,
} from '@endora-commerce/cli/rules/action-route-permissions.js';
import { UI_LAYER_DIRECTORIES } from '@endora-commerce/cli/lib/ui-layer.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';
import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';

export * from '@endora-commerce/cli/rules/action-route-permissions.js';

/**
 * The manifest half of the comparison, and **where each manifest came from**.
 *
 * The locations are returned alongside the actions because they are the answer
 * to a question this check could not previously ask: a packaged module's
 * manifest is imported by bare specifier and therefore read out of the
 * package's build output, so an action edited in `src/manifest.ts` and not
 * rebuilt is invisible here. See `scripts/lib/emitted-freshness.ts`.
 */
async function loadActions(): Promise<{
  readonly actions: readonly ActionRecord[];
  /** One per registered module: the location its manifest was imported from. */
  readonly manifestLocations: readonly string[];
}> {
  const { resolvedManifestEntries } = await import('../src/lifecycle/registered-manifests.js');
  const entries = await resolvedManifestEntries();
  const actions: ActionRecord[] = [];
  for (const entry of entries) {
    for (const action of entry.manifest.actions ?? []) {
      actions.push({
        moduleId: entry.manifest.id,
        actionId: action.id,
        targetRoute: action.targetRoute,
        ...(action.requiredPermission === undefined
          ? {}
          : { requiredPermission: action.requiredPermission }),
      });
    }
  }
  return { actions, manifestLocations: entries.map((entry) => entry.filePath) };
}

/**
 * Actions whose declared code disagrees with their target's gate and may stay
 * that way, with the reason and the question that would retire the entry.
 *
 * Keyed `<moduleId>:<actionId>`, so moving an action inside a manifest does not
 * invalidate an entry and re-opening the hole does not silently inherit one.
 * **Two-way**, in the idiom of `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered
 * disagreement fails the build, and an entry that no longer describes one fails
 * it too.
 *
 * The population that lands here is mostly one shape: an action whose **intent
 * is a write** on a screen whose landing GET is read-gated — "Edit the megamenu",
 * "Import products". Declaring the write code hides the action from an operator
 * who could open the screen; declaring the read code advertises an action the
 * operator cannot complete. `requiredPermission` is a single code and the screen
 * needs two, so neither answer is right and the choice is the owner's, not this
 * check's. An entry says which two codes are defensible.
 *
 * **One entry is the other shape, an `unresolvable` the walk cannot read past**:
 * an action whose target's API is registered under a path the walk cannot
 * evaluate. The entry says what the gate is, read by hand, and what would
 * retire it.
 */
export const ACTION_PERMISSION_DISAGREEMENTS: Readonly<Record<string, string>> = {
  'import_export:open-import-export-center':
    '"Import / export" declares `catalog:write`; the screen lands on GET ' +
    '/api/v1/admin/import-export/entities, gated by the any-of of every entity code, and feature 172 ' +
    'added GET /api/v1/admin/import-export/profiles beside it at the same depth, gated by that any-of ' +
    'and `catalog:write` (`specs/172-product-editor-scope-switcher/contracts/import-profiles-and-csv.md` ' +
    '§1). The two shallowest candidates differ, so the walk cannot pick. The landing route is ' +
    '`entities`; the profiles section loads only for `catalog:write`. Retire this entry when the ' +
    'action declares the landing code or the profiles route moves below the landing depth.',
  'import_export:import-products':
    '"Import products" declares `catalog:write`; ambiguous for the same reason as ' +
    '`import_export:open-import-export-center` (the `entities` landing route and the feature 172 ' +
    '`profiles` route at one depth). The products import itself is `catalog:write`. Retire on the ' +
    'same terms.',
  'megamenu:edit-megamenu':
    '"Edit megamenu" declares `megamenu.write`; the screen it opens is gated by ' +
    '`megamenu.read` (GET /api/v1/admin/megamenu/menus). Retire this entry by ' +
    'answering one question: is the row a way *in* to the menu editor — then it is ' +
    '`megamenu.read` and an operator who cannot save still sees the tree — or is it ' +
    'the edit itself, in which case it stays as it is and hides from a read-only ' +
    'operator by design. Issue #232 left the verb-labelled actions undecided.',
  'product_feeds:import-feed-template':
    '"Import a feed template" declares `product_feeds:write`; the import screen it ' +
    'opens is behind read-gated landing routes, and the POST that performs the import ' +
    'is the write one. Retire this entry with the same answer as the one above: a ' +
    'palette row is a navigation, and the field is a single code, so the label and the ' +
    'gate cannot both be honoured.',
  'projects:open-project-templates':
    '"Project templates" declares `projects:configure`, the code the Templates screen and every ' +
    'write on it are gated on; the list it loads (GET /api/v1/admin/projects/templates) is ' +
    '`projects:read`, because the create form offers Templates to everybody who may create a ' +
    'Project (`specs/163-projects-and-tasks/contracts/admin-surfaces.md` §4). Declaring the read ' +
    'code would advertise a screen a reader is refused. Retire this entry if the create form ' +
    'stops reading the list, or the list moves under a lookup route of its own.',
  'tasks:open-task-workflow':
    '"Task statuses and workflow" declares `tasks:configure`, the code the workflow screen and every ' +
    'write on it are gated on; the workflow it loads (GET /api/v1/admin/tasks/workflow) is `tasks:read`, ' +
    'because the status picker, the list filter and the board need the statuses ' +
    '(`specs/165-task-management/contracts/admin-surfaces.md` §4). Declaring the read code would ' +
    'advertise a screen a reader is refused. Retire this entry if those screens stop reading the ' +
    'workflow route, or the configuration screen reads one of its own.',
  'tasks:open-task-priorities':
    '"Task priorities" declares `tasks:configure`, the code the priorities screen and every write on ' +
    'it are gated on; the list it loads (GET /api/v1/admin/tasks/priorities) is `tasks:read`, because ' +
    'the priority picker, the list filter and the board card read it (`specs/165-task-management/' +
    'contracts/admin-surfaces.md` §4). Retire this entry on the same terms as `open-task-workflow`.',
  'tasks:open-task-tags':
    '"Task tags" declares `tasks:configure`, the code the tags screen and every write on it are gated ' +
    'on; the list it loads (GET /api/v1/admin/tasks/tags) is `tasks:read`, because whoever edits a Task ' +
    'picks among the existing tags (US9 scenario 4, `specs/165-task-management/contracts/' +
    'admin-surfaces.md` §4). Retire this entry on the same terms as `open-task-workflow`.',
  'tasks:open-task-general-settings':
    '"Task general settings" declares `tasks:configure`, the code the general settings screen and the ' +
    'write on it are gated on; the time zone it loads (GET /api/v1/admin/tasks/settings/time-zone) is ' +
    '`tasks:read`, because the Task screens count date-only due dates and reminders in it ' +
    '(`specs/165-task-management/contracts/admin-api.md` §4). Retire this entry on the same terms as ' +
    '`open-task-workflow`.',
  // Issue #516 — sidebar screens that open on a configuration or write code
  // while the walk compares them against a read-gated GET: either the list they
  // load is read-gated because other screens read it too, or the walk cannot
  // find the screen's own endpoints and falls back to the module landing. Each
  // action declares the code of the screen's own route, which is what the admin
  // router refuses on; declaring the read code would advertise a screen a
  // reader is refused, the 403 this check exists to prevent.
  'crm:open-crm-tags':
    '"CRM tags" (issue #516) declares `crm:configure`, the code the /crm/tags screen and every ' +
    'write on it (POST, PATCH, DELETE /api/v1/admin/crm/tags) are gated on; the list it loads, ' +
    'GET /api/v1/admin/crm/tags, is `crm:read` because tagging an opportunity is daily work and ' +
    'the opportunity screens read it. Retire this entry if the tag picker reads the list from a ' +
    'lookup route of its own.',
  'crm:open-crm-workflow':
    '"Opportunity workflow" (issue #516) declares `crm:configure`, the code the /crm/workflow ' +
    'screen and every write on it are gated on; GET /api/v1/admin/crm/workflow is `crm:read` ' +
    'because the list, the board and the detail screen all need the statuses to render ' +
    '(`routes.workflow.ts`). Retire this entry if those screens read the statuses elsewhere.',
  'projects:open-project-roles':
    '"Project roles" (issue #516) declares `projects:configure`, the code the /projects/roles ' +
    'screen is gated on; GET /api/v1/admin/projects/roles is `projects:read` because the project ' +
    'screens read the dictionary to offer its active entries. Same shape as ' +
    '`projects:open-project-templates`; retire it on the same answer.',
  'projects:open-project-loss-reasons':
    '"Project loss reasons" (issue #516) declares `projects:configure`, the code the ' +
    '/projects/loss-reasons screen is gated on; GET /api/v1/admin/projects/loss-reasons is ' +
    '`projects:read` because the project screens read the dictionary to offer its active ' +
    'entries. Same shape as `projects:open-project-templates`; retire it on the same answer.',
  'newsletter:open-newsletter-provider':
    '"Newsletter sending provider" (issue #516) declares `newsletter:write`, the code the ' +
    '/newsletter/provider screen, its save (PUT) and its test send (POST …/provider/test) are ' +
    'gated on; GET /api/v1/admin/newsletter/provider is `newsletter:read`. Retire this entry if ' +
    'the screen opens to readers as a read-only view, which is a change to its route.',
  'inventory:import-stock':
    '"Import stock" (issue #516) declares `inventory:write`, the code the /inventory/import ' +
    'wizard route and its one write, POST /api/v1/admin/inventory/import, are gated on. The walk ' +
    'finds no GET under the screen path and falls back to the module landing, GET ' +
    '/api/v1/admin/inventory (`inventory:read`). A wizard whose only purpose is a write opens on ' +
    'the write code, like `orders:new-order`; retire this entry if the walk learns to compare a ' +
    'write-only screen against its POST.',
  'settings:clear-cache':
    '"Clear cache" (issue #516) declares `settings:write`, the code the /settings/cache screen ' +
    'and both of its endpoints, GET /api/v1/admin/cache/namespaces and POST ' +
    '/api/v1/admin/cache/clear (`routes.cache.ts`), are gated on. The walk cannot connect ' +
    '/settings/cache to /api/v1/admin/cache and falls back to the module landing, GET ' +
    '/api/v1/admin/settings (`settings:read`). Retire this entry when those routes move under ' +
    '/api/v1/admin/settings/cache or the walk resolves them.',
  'mfa:open-security':
    '"Account security" (issue #510) declares no code, and that is the right answer: `/security` ' +
    "is the signed-in admin's own two-factor screen, and its six endpoints are registered by " +
    "`registerMfaSelfServiceRoutes` under `pathPrefix: '/api/v1/admin/account/mfa'` " +
    '(`packages/modules/mfa/src/backend/plugin.ts`), each gated by the bare admin guard and no ' +
    '`requireAdmin(...)`. The walk counts `${pathPrefix}/status` as an unreadable path, so it ' +
    'finds no registration to compare against. Retire this entry when the route walk resolves a ' +
    'parameterised path prefix, or when those routes are registered under a literal path.',
};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');

  // The deployment's overlay modules are part of this build's surface (feature
  // 057), and `src/apps` is otherwise skipped: another deployment's routes are
  // not registered here and its actions are not shipped here.
  // Both roots, derived (feature 080, T040a). The overlay tree stays excluded
  // from the core list and is added back below for the active deployment only.
  const layout = await requireModuleLayout('[action-route-permissions]');
  const overlayRoot = activeOverlayModulesRoot(process.env);
  // A module package's admin layer is **browser** code and is skipped (feature
  // 091, Phase 4). This walk's subject is Fastify registrations, and the two
  // idioms are indistinguishable at the syntax this check reads: a screen's
  // `api/*-client.ts` writes `apiClient.post(`${BASE}/custom-events`, body)`,
  // which has a method, a path and no `preHandler` — so the first module to
  // move its admin directory into its package produced a second, ungated
  // candidate for a route it also registers for real, and the check reported
  // the disagreement as `unresolvable`. It is right about the disagreement and
  // wrong about the population; the layer is excluded rather than the shape
  // guessed at, because a heuristic over the call would eventually exclude a
  // real registration.
  // Both UI layers, from the one declaration: `./admin` is the contribution
  // layer and `./admin-ui` is the published-component one, and the reason to
  // skip is the same for each — it is browser code, not a Fastify registration.
  const uiLayers = layout.moduleRoots
    .filter((root) => root.origin === 'workspace-package')
    .flatMap((root) =>
      UI_LAYER_DIRECTORIES.map((layer) => `${join(root.directory, 'src', layer)}/`),
    );
  const coreFiles = layout.sourceRoots
    .flatMap((root) => walk(root))
    .filter((file) => !file.startsWith(`${layout.overlayRoot}/`))
    .filter((file) => !uiLayers.some((layer) => file.startsWith(layer)));

  // Before anything is imported out of the tree, and before a finding count can
  // be printed: over a moved module tree the walk comes back with `src/kernel`
  // and `src/db`, neither of which registers an admin route, so every other
  // guard here would read as a clean run (issue #215).
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[action-route-permissions]',
    manifestIndexPath: layout.manifestIndexPath,
    files: coreFiles,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const files = overlayRoot === null ? coreFiles : [...coreFiles, ...walk(overlayRoot)];
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  // Imported here rather than at the top: both live in the module tree, so a
  // static import would die at module resolution over the residue above and
  // turn an exit 2 into an unhandled rejection.
  const { ConstantResolver } = await import('@endora-commerce/mod-admin-roles/backend');
  const resolver = new ConstantResolver();
  const { actions, manifestLocations } = await loadActions();

  // The third floor, and the one the other two cannot see: the manifests above
  // were **imported**, and a module that has become a workspace package
  // resolves through its own `exports` map at its build output. So an author
  // who edits `packages/modules/<id>/src/manifest.ts` and runs this check is
  // answered about the previous build — measured three consecutive times on
  // `specs/091-module-owned-admin-surfaces/`'s admin drain, and green every
  // time. Exit 2 rather than 1: the tree is not in violation, this run could
  // not see it (issue #113).
  const freshness = checkEmittedFreshness({
    read: manifestLocations,
    packages: emittingPackages(layout.repoRoot),
  });
  refuseStaleEmittedArtefacts('[action-route-permissions]', freshness, layout.displayOf);

  const result = analyse(
    {
      sources,
      actions,
      hostResidentModules: layout.hostResidentModules,
      absolutePathOf: layout.absolutePathOf,
      lookupConstant: (file, name, property) => resolver.lookup(file, name, property),
    },
    ACTION_PERMISSION_DISAGREEMENTS,
  );

  // The second floor, one per half of the comparison: a run that read routes
  // but no action, or actions but no route, cannot answer the question and must
  // not answer it green (issue #113).
  if (result.scan.routes.length === 0 || actions.length === 0) {
    console.error(
      `[action-route-permissions] nothing to check: admin-routes=${result.scan.routes.length} ` +
        `actions=${actions.length}. Both halves of the comparison have to have been read; ` +
        'refusing to report a vacuous pass.',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const action of actions) {
      const resolved = resolveTarget(action, result.scan.routes);
      const first = resolved?.routes[0];
      const enforced =
        first === undefined
          ? '(unresolved)'
          : first.clauses === null
            ? '(unreadable)'
            : renderClauses(first.clauses);
      console.log(
        `${keyOf({ moduleId: action.moduleId, actionId: action.actionId }).padEnd(48)} ` +
          `${action.targetRoute.padEnd(36)} declared=${(action.requiredPermission ?? '-').padEnd(24)} ` +
          `enforced=${enforced.padEnd(28)} [${resolved?.level ?? 'none'}] ` +
          `${first === undefined ? '' : `${first.method.toUpperCase()} ${first.path}`}`,
      );
    }
    console.log('');
  }

  // What was read, in the shared grammar (issue #244). The manifest actions are
  // the unit judged — one action, one declared permission, one target route —
  // so they are the `sites` number; the route index they are compared against
  // stays on the line below.
  // Which artefact the manifest half came from is a fact this line owes its
  // reader (issue #244): `files` counts the source text the route walk opened,
  // and says nothing about the 60-odd manifests that were imported rather than
  // walked. The token is omitted — not printed as `0/0`, which `read-size.ts`
  // refuses as `no-expectation` — on a tree where every manifest was read from
  // source, because then there is no emitted artefact to disclose.
  const emittedManifests: readonly ReadCoverage[] =
    freshness.emitted.length === 0
      ? []
      : [
          {
            source: 'emitted-manifests',
            expected: freshness.emitted.length,
            covered: freshness.compared.length,
          },
        ];
  reportReadSize({
    prefix: '[action-route-permissions]',
    files: sources.size,
    sites: actions.length,
    coverage: [coverage, ...emittedManifests],
  });
  console.log(
    `[action-route-permissions] actions=${actions.length} admin-routes=${result.scan.routes.length} ` +
      `unreadable-paths=${result.scan.unreadablePaths} findings=${result.findings.length} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(ACTION_PERMISSION_DISAGREEMENTS).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      "\nA command-palette action advertises a permission that is not the one its\n" +
        'target route enforces (Principle XVI item 2 — "so the palette never\n' +
        'advertises a 403"). Take the code from the route unless the surface is\n' +
        'genuinely the other one, in which case the route is what changes.\n',
    );
    for (const finding of result.violations) {
      console.error(
        `  - [${finding.kind}] ${keyOf(finding)} → ${finding.targetRoute}\n` +
          `      declared: ${finding.declared ?? '(none)'}\n` +
          `      enforced: ${finding.enforced}\n` +
          `      where:    ${finding.where}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe a disagreement — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
