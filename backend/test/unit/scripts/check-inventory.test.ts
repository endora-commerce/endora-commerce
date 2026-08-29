import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ModuleManifestSchema,
  defineModuleManifest,
  type ModuleManifest,
} from '@endora-commerce/contracts';

import {
  analyzeSource as channelAnalyze,
  type Violation as ChannelViolation,
} from '../../../scripts/check-channel-resolution.js';
import {
  analyzeSource as commandCoverageAnalyze,
  collectScannedFiles,
  isMigratedModulePath,
} from '../../../scripts/check-command-coverage.js';
import {
  analyse as actionRouteAnalyse,
  type ActionRecord,
} from '../../../scripts/check-action-route-permissions.js';
import { analyzeSource as containerAnalyze } from '../../../scripts/check-container-imports.js';
import {
  checkDocument,
  discoverCitingDocuments,
  markdownDocuments,
  vacuousDocumentPopulation,
} from '../../../scripts/check-doc-snippets.js';
import {
  analyzeSource as classificationAnalyze,
  ENTITY_DECORATOR_HINT,
  packageEntityFindings,
} from '../../../scripts/check-entity-tenant-classification.js';
import {
  NO_PACKAGE_DECLARATIONS,
  unreadablePackageReason,
  type PackageTable,
} from '../../../scripts/lib/package-declarations.js';
import {
  declaredProgramEntryPoints,
  findEntrySites,
  NO_SCOPE_NEEDED,
  staleAllowances,
  violationsOf,
  type EntryKind,
} from '../../../scripts/check-entry-scope.js';
import {
  findUnreachableSentences,
  findUntranslatedErrorCodes,
  unroutedModules,
  type TranslationInput,
} from '../../../scripts/check-error-translations.js';
import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';
import { checkFixtureSubstitution } from '../../../scripts/check-fixture-substitution.js';
import {
  checkSharedTableWipes,
  findUnscopedWipes,
  type WipeKind,
} from '../../../scripts/check-shared-table-wipes.js';
import { checkHarnessTeardown } from '../../../scripts/check-harness-teardown.js';
import {
  analyzeClosure,
  analyzePlatformImports,
  analyzeSource as boundaryAnalyze,
  isImportViolation,
  isViolation,
  RELATION_DECORATOR_HINT,
} from '../../../scripts/check-kernel-boundary.js';
import { inTreeRelationTarget } from '../../helpers/in-tree-relation-target.js';
import {
  checkAdminRegistrations,
  vacuousReason as adminRegistrationsVacuousReason,
  type AdminRegistrationFinding,
} from '../../../scripts/check-admin-registrations.js';
import type {
  AdminNavDeclaration,
  AdminRouteDeclaration,
  AdminSurfaceLayout,
} from '../../../scripts/lib/admin-surfaces.js';
import type { AdminRegistrationCounts } from '../../../scripts/ledgers/admin-registrations.js';
import {
  adminPopulationLost,
  analyzeSource as moduleBoundaryAnalyze,
  checkModuleBoundary,
  findCrossModuleSql,
  type AdminBoundarySurfaces,
  type CrossModuleImport,
  type CrossModuleImportKind,
} from '../../../scripts/check-module-boundary.js';
import {
  modulePackageSurfaces,
  UnreadableSubpathError,
} from '../../../scripts/lib/module-package-subpaths.js';
import {
  compareArtifact,
  containmentSites,
  examineArtifact,
  permittedRoots,
  vacuousContainmentPopulation,
} from '../../../scripts/check-overlay-determinism.js';
import { coreSources, renderEntitiesRegistry } from '../../../scripts/generate-composer.js';
import { checkPortCatches } from '../../../scripts/check-port-catches.js';
import {
  findNonBindingIssues,
  findRootIssues,
  findViolations,
  importedContributionSeams,
  ledgerReads,
  providedPortNames,
  registeredNames,
  resolvedNames,
  rootRegisteredNames,
  type NonBindingIssue,
  type PortResolution,
  type PortViolation,
  type RootRegistrationIssue,
} from '../../../scripts/check-port-dependencies.js';
import { buildDeactivationLedger } from '../../../src/lifecycle/services/deactivation-ledger.js';
import { nonBindingPortEdgesFrom } from '../../../src/lifecycle/services/gating-graph.js';
import {
  checkPlatformSurface,
  platformSurfaceRefusal,
  type PlatformSurfaceFindingKind,
  type PlatformSurfaceInput,
} from '../../../scripts/check-platform-surface.js';
import { publishedSurface } from '../../../scripts/lib/platform-surface.js';
import { checkPortShape } from '../../../scripts/check-port-shape.js';
import { checkSubscribeSeam, checkWorkerSeam } from '../../../scripts/check-subscribe-seam.js';
import { checkTransactionContext } from '../../../scripts/check-transaction-context.js';
import {
  checkSingletonIdentity,
  transitiveParents,
  type SingletonIdentityFindingKind,
} from '../../../scripts/check-singleton-identity.js';
import {
  checkNulBytes,
  findNulBytes,
  GIT_BINARY_WINDOW,
  type ScannedFile,
} from '../../../scripts/check-nul-bytes.js';
import {
  analyzeSource as diacriticAnalyze,
  checkDiacriticFolds,
  findDiacriticFolds,
  helperIsStillTheOwner,
  SHARED_FOLD_HELPER,
  type ScannedFile as FoldSource,
} from '../../../scripts/check-diacritic-folds.js';
import {
  checkEntryPresence,
  keyOf as entryPresenceKeyOf,
  type EntryConstruct,
  type EntryFinding,
} from '../../../scripts/check-entry-presence.js';
import { checkLockClaims } from '../../../scripts/check-lock-claims.js';
import type { ManifestActivationInput } from '../../../scripts/lib/switchable-modules.js';
import { analyzeSource as hardcodedAnalyze } from '../../../scripts/i18n-hardcoded-strings.js';
import {
  lowEntryDrift,
  type ProofEntry,
  type ProvenCheck,
} from '../../helpers/check-proof-entry.js';
import { reportsClaimInAPublishedContract } from '../../helpers/lock-claims-check-fixture.js';
import { reportsOnlyTheSourceFile } from '../../helpers/nul-bytes-check-fixture.js';
import { createShellCheckFixture } from '../../helpers/shell-check-fixture.js';
import { RECORDED_READ_SIZES } from '../../helpers/check-read-sizes.js';
import {
  checkPublishedSurfaceIntent,
  checkReleaseIntent,
  type BranchDiff,
  type ReleaseIntentFindingKind,
} from '../../../scripts/check-release-intent.js';
import {
  checkout as releaseIntentCheckout,
  configuredAs as releaseIntentConfiguredAs,
  FIXTURE_ROOT as RELEASE_INTENT_ROOT,
  HOST_SOURCED_PACKAGE,
  type FileMap as ReleaseIntentFiles,
} from '../../helpers/release-intent-check-fixture.js';

/**
 * The inventory of static checks, and the two properties none of them had
 * (issues #113 and #130).
 *
 * Six checks were found weaker than their own description in a single week, and
 * the common cause was not carelessness: **a green result cannot be told apart
 * from a check that looked at nothing**, and nothing in the repository forced
 * the distinction. Each of the six was green while blind — one matched 4 of 492
 * enforcement sites, one had no ratchet at all, one scanned a file suffix rather
 * than a rule.
 *
 * So this file is the enforcement point for the convention, and it does four
 * things a "does a test file exist?" assertion cannot:
 *
 *   1. **It enumerates.** Every `backend/scripts/check-*.ts` and every
 *      `scripts/check-*.sh` must appear below, and every entry must name a file
 *      that exists — a two-way ratchet, so a new check cannot arrive unlisted
 *      and a deleted one cannot linger.
 *   2. **It drives every check red, here, on synthetic input.** A proof is not a
 *      description of a fixture: it runs the check's own analysis over an input
 *      the tree does not contain and asserts a finding comes back. A check that
 *      stops seeing its own violation shape fails this file even if its
 *      companion test was deleted in the same commit.
 *   3. **Each proof says where it enters, and the top is the only place that
 *      counts.** This is issue #130, and it was found in this file. The entry
 *      for `check-entry-scope` handed `violationsOf` a **pre-classified record**
 *      — so it proved the last function in the chain while the classifier, which
 *      was the broken part, was never run: it grepped for `setInterval(` and
 *      could not see a self-rescheduling `setTimeout`, with a live FR-020 gap
 *      behind it (issue #128). A fixture that enters below the defect cannot
 *      catch it, so `enters` is declared per proof and `PROOFS_ENTERING_BELOW`
 *      is the two-way ledger for anything that is not `top`.
 *   4. **It pins where each check runs and how it refuses a vacuous pass**, and
 *      compares that against `.gitlab-ci.yml` — a check that quietly leaves the
 *      job, or joins it, has to say so here.
 *   5. **It requires each check to say what it read**, not only what it found
 *      (issue #244). Everything above proves a check can still go red on a
 *      violation; none of it can tell "found nothing" from "read nothing", and
 *      that is what the last seven defects were — a walk that came back short,
 *      a population definition that excluded a live entry point, a file that
 *      hid a site, a spread that bypassed a type check, a transform that ate
 *      41% of the file, a population defined by the presence of the thing being
 *      checked. So every check prints its input size in one grammar and
 *      `test/helpers/check-read-sizes.ts` records it; `readSize` is the field,
 *      and the band lives with the records.
 *
 * **One proof per shape the check claims to refuse**, not one per check. A
 * single count would let a check go blind on four of its five signals behind the
 * fifth's red — which is the same failure as (3), one level up. The shapes are
 * named after the check's own header, so a header that grows a signal grows a
 * proof here; the companion test named by each entry stays the place where the
 * shape's *detail* is asserted.
 *
 * Scope: the `check-*` **scripts**. The tests that act as gates —
 * `harness-parity`, `permission-inventory`, `registered-bundles-shape`,
 * `migrations-registry`, `fk-dependency-drift` — are not enumerated here,
 * because a test is already something the suite runs and reports; what they need
 * is the same red-first fixture, which each keeps next to itself (the permission
 * scanner's lives in `test/unit/admin_roles/permission-inventory-scanner.test.ts`,
 * written after its regex matched 4 sites out of 492).
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');
const read = (repoRelative: string): string => readFileSync(join(REPO_ROOT, repoRelative), 'utf8');

/** How a check refuses to report a pass over an input it never read. */
type VacuousGuard =
  /** Exits 2 — distinct from both "clean" (0) and "violations found" (1). */
  | 'exit-2'
  /** Returns a verdict its caller turns into a failure; it never exits itself. */
  | 'verdict';

/** One shape a check claims to refuse, and the proof it still sees it. */
interface RedProof {
  /** Where the fixture enters — see `test/helpers/check-proof-entry.ts`. */
  readonly enters: ProofEntry;
  /** Runs the check's analysis over synthetic input; must find something. */
  readonly prove: () => number;
}

/**
 * Whether the check's population is the module tree, and how it proves it read
 * that tree rather than the residue left when the tree moves (issue #215).
 *
 * `derived-population` means it compares its walk against the module ids the
 * generated manifest index registers, and refuses when a registered module
 * contributed no source. Those checks are the ones
 * `test/unit/scripts/moved-module-tree.test.ts` spawns over a moved tree, and
 * the link below is two-way: a check marked here and missing from that file
 * fails, and so does one proven there and unmarked.
 */
type ResidueGuard = 'derived-population' | 'not-a-module-walk';

/**
 * Whether the check prints the size of what it read (issue #244).
 *
 * `reported` means its output carries a line in the shared grammar —
 * `[prefix] read: files=… sites=… sources=…` — from
 * `backend/scripts/lib/read-size.ts` or its shell twin, and that
 * `test/helpers/check-read-sizes.ts` records what that line says on the current
 * tree. `deferred` is the honest word for a check that does not, and it needs
 * an entry in `READ_SIZE_DEFERRED` below naming what it would take: a partial
 * rollout that reads as complete is the defect family this whole mechanism is
 * about, one level up.
 */
type ReadSizeDisclosure = 'reported' | 'deferred';

interface CheckEntry extends ProvenCheck {
  /** Path relative to the repository root. */
  readonly script: string;
  /** The package script that runs it, or `null` when it is only invoked directly. */
  readonly npmScript: string | null;
  /** Which CI job runs it. `none` is a statement, not an oversight — say why. */
  readonly job: 'quality' | 'quality:static' | 'none';
  /** Where the shapes it refuses are enumerated in detail. */
  readonly companionTest: string;
  readonly vacuousGuard: VacuousGuard;
  readonly residueGuard: ResidueGuard;
  readonly readSize: ReadSizeDisclosure;
  /** Shape name → its proof. Every one must come back non-zero. */
  readonly red: Readonly<Record<string, RedProof>>;
}

/**
 * Red proofs that still enter below the top of their check's analysis, with
 * what it would take to raise them.
 *
 * **Two-way**, in the idiom of `PORT_CATCHES_TO_DRAIN`: a proof entering low
 * without an entry fails, and an entry that no longer describes one fails too.
 * It is empty, and it is meant to stay empty — an entry here is a stage of a
 * check that nothing proves can still see its own input, which is the shape of
 * both defects this file exists for.
 */
const PROOFS_ENTERING_BELOW: Readonly<Record<string, string>> = {};

/**
 * `check-platform-surface` over module source text, barrel source text and a
 * file list — every input a real run has, and none of its answers (feature 080,
 * T042d).
 *
 * The barrel is written out rather than imported so the proof also drives the
 * derivation the check's verdict rests on: `HttpError` is published *of*
 * `http/error-envelope.ts`, and the same name taken from anywhere else is a
 * finding.
 */
function platformSurfaceInput(sources: Record<string, string>): PlatformSurfaceInput {
  return {
    sources: new Map(Object.entries(sources)),
    files: new Set([
      ...Object.keys(sources),
      'backend/src/kernel/index.ts',
      'backend/src/kernel/settings/settings-cache.ts',
      'backend/src/http/index.ts',
      'backend/src/http/error-envelope.ts',
      'backend/src/db/index.ts',
    ]),
    surface: publishedSurface(
      new Map([['backend/src/http/index.ts', "export { HttpError } from './error-envelope.js';"]]),
    ),
    // The host as a packaged module names it (feature 080, T060). The name and
    // the subpath map are the manifest's in a real run; here they enter as the
    // fixture's, above the resolution the proof is about.
    host: {
      name: '@endora-commerce/platform',
      subpathTargets: new Map([['http', 'backend/src/http/index.ts']]),
    },
  };
}

/** Findings of exactly one kind, so no signal goes blind behind another's red. */
function platformSurfaceFindings(
  sources: Record<string, string>,
  kind: PlatformSurfaceFindingKind,
): number {
  return checkPlatformSurface(platformSurfaceInput(sources), {}).violations.filter(
    (finding) => finding.kind === kind,
  ).length;
}

/** The fixture enters the check where a real run does: source text in, findings out. */
const top = (prove: () => number): RedProof => ({ enters: 'top', prove });

// --- fixtures the red proofs run on ----------------------------------------

/**
 * A whole tree for `check:error-translations`, keyed `<directory>.<language>`.
 *
 * The routing table is fixed and deliberately points `BLOG_POST_NOT_FOUND` at a
 * module that is **not** the one the proofs write it in — that gap is the
 * finding. Both members are built from one map, so the proof cannot describe a
 * tree where P1's reader and P2's walk disagree.
 */
function errorSentenceTree(bundles: Record<string, Record<string, string>>): TranslationInput {
  return {
    keys: { BLOG_POST_NOT_FOUND: { moduleId: 'cms', key: 'errors.BLOG_POST_NOT_FOUND' } },
    readBundle: (moduleId, language) => bundles[`${moduleId}.${language}`] ?? {},
    listBundleKeys: () =>
      Object.entries(bundles).flatMap(([slot, bundle]) => {
        const cut = slot.lastIndexOf('.');
        return Object.keys(bundle).map((key) => ({
          moduleId: slot.slice(0, cut),
          language: slot.slice(cut + 1),
          key,
        }));
      }),
  };
}

/**
 * `check-error-translations`' population floor, entered where a real run enters
 * it (feature 080, T010).
 *
 * The registered ids, the routing table and the walk's own file list go in; the
 * refusal comes out. Nothing is pre-computed: the exclusion — every registered
 * module the table does not route a code to — is derived here by the same
 * function the CLI calls, because that derivation *is* the floor. A proof handed
 * a ready-made `excluded` list would leave it unproven, and an exclusion that
 * silently covered everything would switch the floor off while looking like a
 * normal run.
 */
/**
 * `check-release-intent` over a whole synthetic checkout, counting findings of
 * one kind (feature 080, T043).
 *
 * The fixture is the file map, because every one of this check's eight findings
 * is a disagreement *between* files — `pnpm-workspace.yaml` against the
 * manifests, `.changeset/config.json` against both. A proof handed a
 * pre-classified "these are the versionable packages" list would leave the
 * derivation unproven, and that derivation is the part that has to survive 66
 * module packages arriving under a second scope (D-160.2).
 *
 * Counting **by kind** rather than in total is the other half: eight signals
 * over one configuration is exactly the shape where seven go blind behind the
 * eighth's red.
 */
function releaseIntentFindings(
  overrides: ReleaseIntentFiles,
  kind: ReleaseIntentFindingKind,
): number {
  const tree = releaseIntentCheckout(overrides);
  const result = checkReleaseIntent(RELEASE_INTENT_ROOT, tree.fs, tree.listChangesets);
  if ('reason' in result) return 0;
  return result.findings.filter((finding) => finding.kind === kind).length;
}

/** The same check, over an input it must refuse rather than report a verdict on. */
function releaseIntentRefusal(overrides: ReleaseIntentFiles, expected: string): number {
  const tree = releaseIntentCheckout(overrides);
  const result = checkReleaseIntent(RELEASE_INTENT_ROOT, tree.fs, tree.listChangesets);
  return 'reason' in result && result.reason.includes(expected) ? 1 : 0;
}

/**
 * The `--since` half, over the same synthetic checkout plus a branch diff.
 *
 * The fixture is the pair of tsconfigs, not a list of "these files are
 * published": the whole defect is that a package's sources are decided by its
 * compilation and the gate decides them by a directory name, so a proof handed
 * the resolved source set would leave that derivation unproven.
 */
function publishedSurfaceFindings(
  overrides: ReleaseIntentFiles,
  diff: BranchDiff,
  kind: ReleaseIntentFindingKind,
): number {
  const tree = releaseIntentCheckout(overrides);
  const result = checkPublishedSurfaceIntent(
    RELEASE_INTENT_ROOT,
    tree.fs,
    tree.listChangesets,
    diff,
  );
  if ('contained' in result || 'reason' in result) return 0;
  return result.findings.filter((finding) => finding.kind === kind).length;
}

function bundleResidueRefusal(bundleFiles: readonly string[]): number {
  const keys = {
    BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' },
  } as const;
  const registered = ['blog', 'catalog', 'orders'];
  const reason = vacuousModulePopulation({
    registered,
    files: bundleFiles,
    excluded: unroutedModules(keys, registered),
  });
  // Named, not counted: a refusal that listed `catalog` and `orders` would mean
  // the exclusion derived nothing, and would be just as non-zero.
  return reason !== null && reason.includes('blog') && !reason.includes('catalog') ? 1 : 0;
}

/**
 * `check-doc-snippets`' root floor, over a document tree on disk.
 *
 * The fixture is a tree because the shortfall this check can suffer is a *root*
 * that stopped contributing, and only the walk can say which root a file came
 * from. `specs` is populated and `docs/docs` is not — the measured shape: 92 of
 * 943 markdown files, one of seven citing documents, and a survivor count well
 * inside the read-size band.
 */
function emptyDocumentRoot(): number {
  const root = mkdtempSync(join(tmpdir(), 'endora-doc-roots-'));
  try {
    mkdirSync(join(root, 'specs/080-f4-real-scope'), { recursive: true });
    writeFileSync(join(root, 'specs/080-f4-real-scope/tasks.md'), '# Tasks\n', 'utf8');
    const walked = markdownDocuments(root);
    const reason = vacuousDocumentPopulation(walked);
    // Non-empty walk *and* a refusal: the old guard, `documents.length === 0`,
    // is green on exactly this tree.
    return walked.length > 0 && reason !== null && reason.includes('docs/docs') ? 1 : 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Issue #216 — the manifests a lock claim is judged against.
 *
 * The fixture is the *manifest list*, not the locked set: `checkLockClaims`
 * derives the lock from `activation.nonDeactivatable` inside the analysis, so a
 * proof handing it a pre-computed set would leave the one derivation the whole
 * check rests on unproven.
 */
const CLAIM_MANIFESTS: readonly ManifestActivationInput[] = [
  { id: 'fixture_locked', activation: { nonDeactivatable: true, reason: 'core' } },
  {
    id: 'fixture_switchable',
    activation: { settingCode: 'fixture_switchable.enabled', default: true },
  },
];

function staleClaims(source: string, kind: 'stale-lock-claim' | 'stale-switchable-claim'): number {
  return checkLockClaims({
    sources: new Map([['scripts/ledgers/cross-module-imports/fixture.ts', source]]),
    manifests: CLAIM_MANIFESTS,
  }).findings.filter((finding) => finding.kind === kind).length;
}

const MODULE_FILE = join(BACKEND_ROOT, 'src/modules/blog/backend.ts');
/**
 * The platform's own source root, and a synthetic file inside it. Rule B is
 * scoped by the root it is given since the relocation — a `/src/kernel/`
 * substring test now matches the re-export shims too — so a proof entering at
 * the top of the analysis has to name the root a real run names.
 */
const PLATFORM_ROOT = join(BACKEND_ROOT, '..', 'packages', 'platform', 'src');
const KERNEL_FILE = join(PLATFORM_ROOT, 'kernel/thing.ts');
/**
 * Rule A resolves its target as a **file on disk**, so this proof needs an entity
 * the application tree really holds — derived rather than named, and shared with
 * `test/unit/kernel/boundary-check.test.ts`, whose four fixtures rest on the same
 * fact. It spelled `catalog/entities/category.entity.js` until feature 080's T040b
 * made `catalog` a package and this proof went green (issue #113's shape: a check's
 * own evidence of redness quietly stops being evidence). See
 * `test/helpers/in-tree-relation-target.ts`.
 */
const RELATION_TARGET = inTreeRelationTarget();
const CROSS_MODULE_RELATION = [
  `import { ${RELATION_TARGET.name} } from '${RELATION_TARGET.specifier}';`,
  '@Entity()',
  'export class SearchPhraseRecord {',
  `  @ManyToOne(() => ${RELATION_TARGET.name}, { fieldName: "target_id" })`,
  `  target!: ${RELATION_TARGET.name};`,
  '}',
].join('\n');

/**
 * The importing file for the proof below — inside the **fixture** tree, because
 * the specifier above is relative and rule A resolves it against this path.
 *
 * It replaces a `SEARCH_ENTITY` constant that spelled
 * `backend/src/modules/search/entities/…`, a path the application tree stopped
 * holding when batch two packaged `search`. Nothing noticed, because rule A only
 * ever resolves the *target*; the importing path is read for its owner and never
 * opened.
 */
const RELATION_TARGET_SOURCE = RELATION_TARGET.sourceFile(
  'search/entities/search-phrase-record.entity.ts',
);

/**
 * A published port introduced the way every port in the tree is, naming
 * `container`. Source text, so `check-port-shape`'s own doc-block sweep has to
 * find it — a fixture that handed over a parsed `{ portName, container }` would
 * prove the comparison and skip the parse the comparison rests on.
 */
const PORT_DOC = (container: string): string =>
  [
    '/**',
    ` * Container name: \`${container}\`. Owner: \`admin_roles\`.`,
    ' */',
    'export interface PublishedPort {',
    '  list(): Promise<Record[]>;',
    '}',
  ].join('\n');

/** One gated admin route, as a module writes it — the route half of issue #232. */
const ACTION_ROUTE_FILE = 'modules/inventory/routes.admin.ts';
const GATED_ADMIN_ROUTE =
  "app.get('/api/v1/admin/inventory', { preHandler: requireAdmin('orders:read') }, h);";

/** The manifest half: `settings`' shape, the one action of 53 that declared none. */
const ACTION_WITHOUT_CODE: ActionRecord = {
  moduleId: 'inventory',
  actionId: 'open-inventory',
  targetRoute: '/inventory',
};

const UNAUDITED_WRITE = `
  export class ThingService {
    constructor(private em: () => any) {}
    async rename(id: string) {
      const em = this.em();
      await em.persistAndFlush({ id });
    }
  }`;

const DOUBLE_AUDITED_WRITE = `
  export class ThingService {
    async rename(id: string) {
      await this.commandBus.run(renameThing(id));
      await this.auditLog.record({ action: 'thing.renamed' });
    }
  }`;

const STALE_IGNORE = `
  export class ThingService {
    // command-coverage-ignore: bookkeeping counter, no domain write.
    async count(id: string) {
      return this.repository.count({ id });
    }
  }`;

/**
 * `em.create` alone — a write with nothing else in the unit (D-89).
 *
 * The entity is managed from that call, so the next `flush` inserts it whoever
 * calls it. The unit names no `persist` and no `flush`, which is exactly why the
 * check could not see it, and why a CSV import rewrote catalogue and stock
 * unaudited for a year. It doubles as the **control** for the three
 * discriminations below: each of those adds a second unit that must *not* be
 * flagged, so the proof reads 1 while the narrowing holds and 0 the moment a
 * second finding appears beside it.
 */
const EM_CREATE_WRITE = `
  export class ThingService {
    constructor(private em: () => any) {}
    async rename(id: string) {
      const em = this.em();
      em.create(Thing, { id });
    }
  }`;

/** `deps.orderService.create(…)` — a call into an audited service, not the ORM. */
const SERVICE_CREATE_CALL = `
  export class OtherService {
    async place(id: string) {
      await this.deps.orderService.create({ id });
    }
  }`;

/** The same `em.create`, inside a unit that runs a Command. */
const EM_CREATE_UNDER_COMMAND = `
  export class CoveredService {
    async place(id: string) {
      await this.commandBus.run(placeThing(id));
      this.em().create(Thing, { id });
    }
  }`;

/**
 * A field assignment on a managed entity, and nothing else.
 *
 * The header states in writing that a call-shaped check cannot see this. The
 * proof is here so the limit is asserted rather than discovered: if somebody
 * teaches the check to read assignments, this goes to 0 and the header sentence
 * has to be rewritten in the same merge request.
 */
const FIELD_ASSIGNMENT_ONLY = `
  export class AssigningService {
    async mark(order: any) {
      order.status = 'paid';
    }
  }`;

/**
 * D-89(c) — two units, the callee marked and writing, the caller marked and not.
 *
 * The shape `payments/services/payment-reference-port.ts` carried: an exemption
 * on two public callers while the private body did the `flush`, and the private
 * body's own marker added later. The transitive rule counted the callee's write
 * and kept the caller's marker alive, so nothing could see the redundancy.
 */
const MARKED_CALLER_OF_MARKED_UNIT = `
  export class ThingService {
    // command-coverage-ignore: bookkeeping, and the write is in stamp().
    async publish(id: string) {
      return this.stamp(id);
    }
    // command-coverage-ignore: bookkeeping — the entry point both callers use.
    private async stamp(id: string) {
      const em = this.em();
      await em.flush();
    }
  }`;

/**
 * A module composing a port, and three modules reading it the three ways that
 * matter. The proofs run the **scanners** (`providedPortNames`, `resolvedNames`)
 * over this source and hand their output to the rules, because that is where the
 * check has gone blind before: a `port(ctx, name)` helper once hid fourteen
 * resolutions, several registered by nobody, while the rule read clean.
 */
const PAYMENTS_BACKEND = [
  'export function registerModule(ctx: ModuleContext): void {',
  "  ctx.di.providePort('paymentAdapterRegistry', ctx.asFunction(() => registry).singleton());",
  '}',
].join('\n');
const PAYMENTS_FILE = '/repo/backend/src/modules/payment_methods/backend.ts';
const ORDERS_FILE = '/repo/backend/src/modules/orders/backend.ts';

const ORDERS_RESOLVES_AT_CALL = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    orderService: ctx.asFunction(() => ({',
  '      pay: () => ctx.cradle<Deps>().paymentAdapterRegistry.charge(),',
  '    })).singleton(),',
  '  });',
  '}',
].join('\n');

const ORDERS_RESOLVES_UNOWNED = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    orderService: ctx.asFunction(() => ({',
  '      pay: () => ctx.cradle<Deps>().nobodyRegistersThis.charge(),',
  '    })).singleton(),',
  '  });',
  '}',
].join('\n');

const ORDERS_CAPTURES = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    orderService: ctx.asFunction(({ paymentAdapterRegistry }: Deps) =>',
  '      new OrderService(paymentAdapterRegistry),',
  '    ).singleton(),',
  '  });',
  '}',
].join('\n');

const ORDERS_RESOLVES_AT_BOOT = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.onBoot(() => {',
  '    ctx.cradle<Deps>().paymentAdapterRegistry.warm();',
  '  });',
  '}',
].join('\n');

/** Name → owner, as the scanner reads them off the owning module's `backend.ts`. */
const PAYMENT_PORTS = new Map(
  providedPortNames(PAYMENTS_BACKEND, PAYMENTS_FILE).map((name) => [name, 'payment_methods']),
);

/** The resolutions a consumer's source yields — the scanner's own answer. */
function ordersResolutions(source: string): PortResolution[] {
  return resolvedNames(source, ORDERS_FILE);
}

function portViolations(
  source: string,
  owners: ReadonlyMap<string, string>,
  kind: PortViolation['kind'],
): number {
  return findViolations({
    resolutions: ordersResolutions(source),
    owners,
    dependencies: new Map([['orders', []]]),
    providedPorts: PAYMENT_PORTS,
  }).filter((v) => v.kind === kind).length;
}

/**
 * The two composition roots, as source text — the top of `findRootIssues`.
 *
 * Its seven shapes are all *differences between what registers a name and what
 * reads it*, so the proofs feed it what a real run does: each root's file read
 * through `rootRegisteredNames`, the kernel's file read the same way, the
 * module's own ports through `providedPortNames`, its own registrations
 * through `registeredNames`, and the names something resolves through
 * `resolvedNames`. Handing it ready-made sets would prove the comparison and
 * leave every scanner under it unproven, which is the shape of issue #130 — and
 * for the four `PLATFORM_OWNED_NAMES` shapes it is not a hypothetical: the
 * classification turns entirely on which of those five scanners saw the name.
 */
const PRODUCTION_ROOT_FILE = '/repo/backend/src/composition.ts';
const HARNESS_ROOT_FILE = '/repo/backend/test/helpers/test-server.ts';
const KERNEL_CONTAINER_FILE = '/repo/backend/src/kernel/container.ts';

function rootIssues(input: {
  readonly roots: Readonly<Record<string, string>>;
  readonly moduleSource: string;
  readonly hostRegistered: Readonly<Record<string, string>>;
  readonly consumerSource: string;
  /** The hand-written platform list under test. Empty means "do not sweep it". */
  readonly platformNames?: readonly string[];
  /** A file under `src/kernel/**`, as source text — the third supply source (D-73). */
  readonly kernelSource?: string;
  /** A module's `backend.ts`, for the names it registers or provides as its own. */
  readonly ownerSource?: string;
}): RootRegistrationIssue[] {
  const rootNames = new Map<string, ReadonlySet<string>>(
    Object.entries(input.roots).map(([label, source]) => [
      label,
      new Set(
        rootRegisteredNames(
          source,
          label === 'production' ? PRODUCTION_ROOT_FILE : HARNESS_ROOT_FILE,
        ),
      ),
    ]),
  );
  const kernelSource = input.kernelSource ?? '';
  return findRootIssues({
    moduleRegistered: new Map(
      providedPortNames(input.moduleSource, PAYMENTS_FILE).map((name) => [
        name,
        'payment_methods',
      ]),
    ),
    rootNames,
    hostRegistered: input.hostRegistered,
    resolvedNames: new Set(ordersResolutions(input.consumerSource).map((r) => r.name)),
    platformNames: new Set(input.platformNames ?? []),
    kernelNames: new Set([
      ...rootRegisteredNames(kernelSource, KERNEL_CONTAINER_FILE),
      ...registeredNames(kernelSource, KERNEL_CONTAINER_FILE),
    ]),
    moduleOwnedNames: new Map(
      registeredNames(input.ownerSource ?? '', PAYMENTS_FILE).map((name) => [
        name,
        'payment_methods',
      ]),
    ),
  });
}

/** A root registering nothing the fixtures care about, so a divergence has a silent half. */
const ROOT_REGISTERS_NOTHING = 'registerValues(container, { orm, em });';
// Written in the contribution-window spelling (issue #52), which is where a
// root writes nearly every name today — so the three fixtures below cover all
// three shapes `rootRegisteredNames` has to read: the window method here,
// `registerValues` above, and a direct `container.register` below.
const ROOT_SHADOWS_THE_PORT =
  'composedModules.contribute({ paymentAdapterRegistry: builtHere });';
const ROOT_SUPPLIES_THE_BRIDGE = 'container.register({ ordersAdminScopeResolver: fromRequest });';
const ORDERS_RESOLVES_THE_BRIDGE = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    orderService: ctx.asFunction(() => ({',
  '      scope: () => ctx.cradle<Deps>().ordersAdminScopeResolver(),',
  '    })).singleton(),',
  '  });',
  '}',
].join('\n');

/* -------------------------------------------------------------------------- *
 * `PLATFORM_OWNED_NAMES`, as the four things being on it can be wrong about
 * (issue #49, D-73).
 *
 * Each fixture below is source text, and the name under test appears in exactly
 * one of the five scanners the classification reads — which is what makes the
 * four proofs independent rather than four spellings of one. A fixture handing
 * `findRootIssues` a finished name set would classify whatever the fixture
 * author believed, not whatever the walk can see.
 * -------------------------------------------------------------------------- */

/** The name the production defect (#49, F45) was about, used by all four. */
const PLATFORM_NAME = 'salesChannelResolutionPort';

/** A module resolving the platform name at call time — the "somebody reads it" half. */
const ORDERS_RESOLVES_THE_PLATFORM_NAME = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    orderService: ctx.asFunction(() => ({',
  '      channel: () => ctx.cradle<Deps>().salesChannelResolutionPort.resolve(),',
  '    })).singleton(),',
  '  });',
  '}',
].join('\n');

/** One root registering it and the other not — the divergence half. */
const ROOT_SUPPLIES_THE_PLATFORM_NAME =
  'composedModules.contribute({ salesChannelResolutionPort: resolverForThisDeployment });';

/**
 * A module's own `backend.ts` claiming the name as a contribution-point default
 * — the shape `priceListsPricingCacheTtlMs` was in, and the reason the
 * ownership scan reads `registeredNames` rather than `providedPortNames`: a
 * `ctx.di.register` default is module-owned just as firmly as a port is.
 */
const MODULE_OWNS_THE_PLATFORM_NAME = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    salesChannelResolutionPort: ctx.asFunction(() => defaultResolver).singleton(),',
  '  });',
  '}',
].join('\n');

/**
 * The kernel supplying it, in the `container.register({ … })` spelling
 * `registerOrm` uses — the third supply source (F47).
 *
 * Not a red proof of its own: what it proves is a finding *not* raised, so it
 * belongs beside the assertions in `test/unit/kernel/port-dependency-check.ts`.
 * It is here because the four fixtures above have to say "and the kernel does
 * not register it either", and the honest way to say that is to hand the same
 * scanner a kernel file that registers something else.
 */
const KERNEL_REGISTERS_SOMETHING_ELSE = 'container.register({ orm: asValue(orm) });';

/**
 * A contribution host and the module that pushes into it, as source text — the
 * top of `findNonBindingIssues`.
 *
 * Its eight shapes are all statements about the tree that a `nonBindingDependencies`
 * entry makes and the check refuses to take on the author's word, so the fixture
 * is a real manifest (through `defineModuleManifest`, so the contract's own
 * rules apply) plus the two module sources. `nonBindingPortEdgesFrom` flattens
 * the declaration, `registeredNames` and `providedPortNames` decide who owns the
 * name, and `resolvedNames` decides where it is read — every stage on the way.
 *
 * **One shape cannot go through `defineModuleManifest`, and that is the point
 * of it.** `refusal-over-a-bound-owner` is a manifest that names its owner in
 * both `dependencies` and `nonBindingDependencies`, which the helper's rule 2
 * refuses outright — so the fixture builds that one through
 * `ModuleManifestSchema.parse` instead, which is precisely the route a manifest
 * object written without the helper takes into a real composition. Its
 * `boundOwners` map is then derived **from that manifest**, exactly as `main`
 * derives it, rather than handed in beside it: a fixture that supplied the map
 * directly would prove the branch and not the derivation.
 */
const PROMPT_ACTIONS_FILE = '/repo/backend/src/modules/prompt_actions/backend.ts';
const CATALOG_FILE = '/repo/backend/src/modules/catalog/backend.ts';

const PROMPT_ACTIONS_REGISTERS = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    promptActionToolRegistry: ctx.asFunction(() => new Registry()).singleton(),',
  '  });',
  '}',
].join('\n');

const PROMPT_ACTIONS_PROVIDES_A_PORT = [
  'export function registerModule(ctx: ModuleContext): void {',
  "  ctx.di.providePort('promptActionToolRegistry', ctx.asFunction(() => new Registry()).singleton());",
  '}',
].join('\n');

const CATALOG_PUSHES_AT_BOOT = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.onBoot(() => {',
  '    ctx.cradle<Deps>().promptActionToolRegistry.register(catalogTool);',
  '  });',
  '}',
].join('\n');

const CATALOG_READS_AT_CALL = [
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.di.register({',
  '    toolLister: ctx.asFunction(() => ({',
  '      list: () => ctx.cradle<Deps>().promptActionToolRegistry.visibleFor(),',
  '    })).singleton(),',
  '  });',
  '}',
].join('\n');

type NonBindingEdge = NonNullable<ModuleManifest['nonBindingDependencies']>[number];

function nonBindingIssues(input: {
  readonly edge: NonBindingEdge;
  readonly ownerSource: string;
  readonly consumerSource: string;
  readonly policies: Readonly<Record<string, 'skip' | 'honour'>>;
  readonly dependencies?: readonly string[];
  /**
   * Build the manifest through `ModuleManifestSchema.parse` rather than
   * `defineModuleManifest` — see the note above the fixtures. Never a
   * convenience: the two `refuses-without` shapes the helper refuses outright
   * have no other way into a composition, and this is the way they take.
   */
  readonly unhelped?: boolean;
}): NonBindingIssue[] {
  const draft = {
    id: 'catalog',
    name: 'Catalog',
    version: '1.0.0',
    dependencies: [...(input.dependencies ?? [])],
    nonBindingDependencies: [input.edge],
  };
  const manifest =
    input.unhelped === true ? ModuleManifestSchema.parse(draft) : defineModuleManifest(draft);
  return findNonBindingIssues({
    edges: nonBindingPortEdgesFrom([manifest]),
    owners: new Map(
      registeredNames(input.ownerSource, PROMPT_ACTIONS_FILE).map((name) => [
        name,
        'prompt_actions',
      ]),
    ),
    providedPorts: new Map(
      providedPortNames(input.ownerSource, PROMPT_ACTIONS_FILE).map((name) => [
        name,
        'prompt_actions',
      ]),
    ),
    resolutions: resolvedNames(input.consumerSource, CATALOG_FILE),
    contributionPolicies: input.policies,
    boundOwners: new Map([
      [
        manifest.id,
        new Set<string>([
          ...manifest.dependencies,
          ...(manifest.acknowledgedDependencies ?? []).map((edge) => edge.moduleId),
        ]),
      ],
    ]),
  });
}

/**
 * The other wiring: a module that **imports** another module's singleton and
 * pushes into it, which no container scan sees. The fixture is the importing
 * file's source, and the proof runs the seam through the ledger, because the
 * seam on its own refuses nothing — what makes `gatewayRefundRegistry`'s policy
 * requirement bite is the unassigned edge at the far end.
 */
const STRIPE_FILE = '/repo/backend/src/modules/stripe/backend.ts';

const STRIPE_PUSHES = [
  "import { gatewayRefundRegistry } from '../payments/services/gateway-refund-registry.js';",
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.onBoot(() => {',
  "    gatewayRefundRegistry.register('stripe', handler);",
  '  });',
  '}',
].join('\n');

const STRIPE_WITHDRAWS = [
  "import { paymentAdapterRegistry } from '../payment_methods/services/payment-adapter-registry.js';",
  'export function registerModule(ctx: ModuleContext): void {',
  '  ctx.onBoot(() => {',
  "    paymentAdapterRegistry.unregister('stripe');",
  '  });',
  '}',
].join('\n');

/** Seams found in one file, classified by the ledger with no policy stated for them. */
function importedSeamShapes(source: string): number {
  return buildDeactivationLedger({
    reads: ledgerReads({
      resolutions: [],
      seams: importedContributionSeams(source, STRIPE_FILE),
      owners: new Map(),
      providedPorts: new Map(),
    }),
    declaredDependencies: new Map(),
    nonBinding: [],
    neverAbsentOwners: new Set(),
    acknowledged: [],
    contributionPolicies: {},
    excludedNames: new Set(),
  }).unassigned.filter((edge) => edge.shape === 'registry-without-policy').length;
}

const PORT_CATCH_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/services/cart-admin-service.ts',
    'try { await this.deps.promotionService.applyToCart({}); } catch { return 0; }',
  ],
]);

/**
 * The identical edge with the **owner packaged** (feature 080, T040b).
 *
 * The only difference from {@link PORT_CATCH_TREE} is where the owner's
 * `registerModule` lives: a module package publishes it on its `./backend`
 * subpath, which in this repository is `src/backend/index.ts`. This check found
 * a module's provided ports by `file.endsWith('backend.ts')`, so a packaged
 * owner registered nothing as far as the analysis was concerned and every
 * `catch` around one of its gates read clean — fail-open, and the same defect
 * !920 found in `check-port-dependencies` under the same filename assumption.
 * `webhooks` is where it surfaced: its `LEDGER-PERMANENT` self-edge went
 * *stale* the moment the module became a package, which is the loud half; the
 * silent half is every unledgered site behind a packaged gate.
 *
 * The marker is `declaresRegisterModule`, the composer's own, so the two cannot
 * disagree about which file composes a module.
 */
const PORT_CATCH_PACKAGED_OWNER_TREE = new Map([
  [
    'packages/modules/promotions/src/backend/index.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/services/cart-admin-service.ts',
    'try { await this.deps.promotionService.applyToCart({}); } catch { return 0; }',
  ],
]);

/**
 * `promotions` with and without the lock, for D-63's derived `OWNER LOCKED`.
 *
 * The pair is the proof: locked, the site over `PORT_CATCH_TREE` retires; with
 * the lock withdrawn — the only edit — the same site is a violation again, and
 * a ledger entry written while it was locked reads stale.
 */
const PORT_CATCH_OWNER_LOCKED = {
  id: 'promotions',
  activation: { nonDeactivatable: true, reason: 'Nothing prices without it.' },
};
const PORT_CATCH_OWNER_UNLOCKED = {
  id: 'promotions',
  activation: { settingCode: 'promotions.enabled', default: true },
};

/** The same port reached through a module-local `lazyPort` alias (shape 2). */
const PORT_CATCH_ALIAS_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    // One file, deliberately: a `const` alias is file-scoped, because a name a
    // module uses for a port in one file may name something else entirely in
    // another (`catalog` spells its bulk-operation service `queue` in one place
    // and a BullMQ queue the same way in another). Splitting this fixture across
    // two files would assert the pre-widening behaviour and pass for the wrong
    // reason.
    'modules/carts/services/cart-pricing-service.ts',
    "const priceEngine = lazyPort<Promotions>(ctx, 'promotionService');\n" +
      'try { await priceEngine.applyToCart({}); } catch { return 0; }',
  ],
]);

/** The same port reached through a deps-object key (shape 3, the dominant one). */
const PORT_CATCH_DEPS_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/backend.ts',
    "const deps = { promotion: lazyPort<Promotions>(ctx, 'promotionService') };",
  ],
  [
    'modules/carts/services/cart-total-service.ts',
    'try { await this.deps.promotion.applyToCart({}); } catch { return 0; }',
  ],
]);

/**
 * D-88 — the gate reached one hop backwards, through `this` and nothing else.
 *
 * The dominant integration skeleton in this tree: a public `handle(payload)`, a
 * `try` around the domain application, and a private method underneath that
 * reaches the port. The `try` body names no port at all, which is why the check
 * could not see eight sites of this shape — seven correct by hand and one a live
 * fail-open.
 */
const PORT_CATCH_METHOD_HOP_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/services/cart-gateway-service.ts',
    'export class CartGatewayService {\n' +
      '  async handle(payload) {\n' +
      '    try { await this.settlePaid(payload); } catch (err) { this.deps.onError?.(err); }\n' +
      '  }\n' +
      '  private async settlePaid(payload) {\n' +
      '    await this.deps.promotionService.applyToCart(payload);\n' +
      '  }\n' +
      '}',
  ],
]);

/** The same hop, one level deeper: a private method calling a private method. */
const PORT_CATCH_TRANSITIVE_HOP_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/services/cart-gateway-service.ts',
    'export class CartGatewayService {\n' +
      '  async handle(payload) {\n' +
      '    try { await this.settlePaid(payload); } catch (err) { this.deps.onError?.(err); }\n' +
      '  }\n' +
      '  private async settlePaid(payload) { await this.reprice(payload); }\n' +
      '  private async reprice(payload) {\n' +
      '    await this.deps.promotionService.applyToCart(payload);\n' +
      '  }\n' +
      '}',
  ],
]);

/**
 * A free function in **another file** that reaches the gate, plus a control.
 *
 * The limit is `this`, and only `this`: following an imported helper would need
 * whole-program call-graph resolution, and "port-carrying" stops being decidable
 * from names at that point. The control is the same class's own hop, so the
 * proof reads 1 when the limit holds and 2 the moment it stops holding.
 */
const PORT_CATCH_FREE_FUNCTION_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/services/cart-helpers.ts',
    'export async function repriceCart(deps, payload) {\n' +
      '  await deps.promotionService.applyToCart(payload);\n' +
      '}',
  ],
  [
    'modules/carts/services/cart-gateway-service.ts',
    "import { repriceCart } from './cart-helpers.js';\n" +
      'export class CartGatewayService {\n' +
      '  async viaHelper(payload) {\n' +
      '    try { await repriceCart(this.deps, payload); } catch { return 0; }\n' +
      '  }\n' +
      '  async viaOwnMethod(payload) {\n' +
      '    try { await this.settlePaid(payload); } catch { return 0; }\n' +
      '  }\n' +
      '  private async settlePaid(payload) {\n' +
      '    await this.deps.promotionService.applyToCart(payload);\n' +
      '  }\n' +
      '}',
  ],
]);

/**
 * A class method that **shadows** a module-scoped alias of the same spelling.
 *
 * `product_feeds` holds both: a plugin closure registered as `close`, and a
 * `TaxonomyRefreshService#close` that writes a check row. Reading the second as
 * the first put twenty gates on a method that reaches none, and a `try` two hops
 * above it went red for a reason nobody could act on. The control is the same
 * class's real hop.
 */
const PORT_CATCH_PROVIDER_ONLY: readonly [string, string] = [
  'modules/promotions/backend.ts',
  "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
];

/**
 * A constructor parameter aliased **module-wide** from the call site, and an
 * unrelated local of the same spelling one file away (issue #278).
 *
 * Measured on the tree: building `orderTransitionPort`, an author named a
 * constructor parameter `transitionService`, and a pre-existing `catch` in
 * `orders/prompt-tools.ts` became a violation with no code change of its own.
 * The author cleared it by renaming the parameter — and the rename hid a
 * `catch` that is a genuine fail-open. The control is the parameter read where
 * it really is in scope, so the proof reads 1 when the scoping holds and 2 the
 * moment the alias escapes its declaring file again.
 */
const PORT_CATCH_PARAMETER_SCOPE_TREE = new Map([
  PORT_CATCH_PROVIDER_ONLY,
  [
    'modules/carts/backend.ts',
    "import { lazyPort } from '../../kernel/index.js';\n" +
      "const pricing = new CartPricing(lazyPort(ctx, 'promotionService'));",
  ],
  [
    'modules/carts/services/cart-pricing.ts',
    'export class CartPricing {\n' +
      '  constructor(private readonly transitionService) {}\n' +
      '  async price() {\n' +
      '    try { return await this.transitionService.applyToCart({}); } catch { return 0; }\n' +
      '  }\n}',
  ],
  [
    'modules/carts/prompt-tools.ts',
    'export function bulk(make) {\n' +
      '  const transitionService = make();\n' +
      '  try { transitionService.apply(); } catch { return 0; }\n' +
      '  return 1;\n}',
  ],
]);

/**
 * A module-scoped deps key claimed by an unrelated local — the general form of
 * the same rule, and the collision `catalog` really holds: a bulk-operation
 * service renamed to `queue` in one file, a BullMQ queue under that spelling in
 * another. The control is the deps key read as `this.deps.queue`, which no
 * lexical binding can shadow.
 */
const PORT_CATCH_LOCAL_SHADOW_TREE = new Map([
  PORT_CATCH_PROVIDER_ONLY,
  [
    'modules/carts/backend.ts',
    "import { lazyPort } from '../../kernel/index.js';\n" +
      "const deps = { queue: lazyPort(ctx, 'promotionService') };",
  ],
  [
    'modules/carts/services/cart-bulk.ts',
    'export class CartBulk {\n' +
      '  async enqueue() {\n' +
      "    const queue = new BullQueue('carts-bulk', { connection: 1 });\n" +
      '    try { await queue.add({}); } catch { return 0; }\n' +
      '    return 1;\n' +
      '  }\n' +
      '  async reprice() {\n' +
      '    try { return await this.deps.queue.applyToCart({}); } catch { return 0; }\n' +
      '  }\n}',
  ],
]);

/**
 * The direction the narrowing may not fail in: a local bound to a **call**,
 * which the carriage analysis does not follow and therefore cannot judge.
 *
 * `catalog` binds `const customFields = this.#requireCustomFields()`, holding
 * `custom_fields`' gated definition port through exactly that shape. Reading
 * "carries says no" as "not a port" took six `catch` sites in
 * `attribute-commands.ts` out of the population, so this tree is the one that
 * has to stay red.
 */
const PORT_CATCH_CALL_BOUND_LOCAL_TREE = new Map([
  PORT_CATCH_PROVIDER_ONLY,
  [
    'modules/carts/backend.ts',
    "import { lazyPort } from '../../kernel/index.js';\n" +
      "const deps = { customFields: lazyPort(ctx, 'promotionService') };",
  ],
  [
    'modules/carts/services/cart-attributes.ts',
    'export class CartAttributes {\n' +
      '  #require() { return this.deps.customFields; }\n' +
      '  async apply() {\n' +
      '    const customFields = this.#require();\n' +
      '    try { return await customFields.applyToCart({}); } catch { return 0; }\n' +
      '  }\n}',
  ],
]);

const PORT_CATCH_SHADOWED_METHOD_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/backend.ts',
    "const deps = { close: () => cradle().promotionService.shutdown() };",
  ],
  [
    'modules/carts/services/cart-gateway-service.ts',
    'export class CartGatewayService {\n' +
      '  async shutdown() {\n' +
      '    try { await this.close(); } catch { return 0; }\n' +
      '  }\n' +
      '  async viaOwnMethod(payload) {\n' +
      '    try { await this.settlePaid(payload); } catch { return 0; }\n' +
      '  }\n' +
      '  private async close() { this.rows.length = 0; }\n' +
      '  private async settlePaid(payload) {\n' +
      '    await this.deps.promotionService.applyToCart(payload);\n' +
      '  }\n' +
      '}',
  ],
]);

/**
 * A repeating timer built from `setTimeout`, in a file that opens no scope. The
 * red proof runs through `analyzeSource` rather than `violationsOf` alone
 * (issue #128): the blindness was in the **classifier**, which grepped for
 * `setInterval(` and so kept this file out of the population entirely — a
 * violation list can only stay empty for something it was never handed.
 */
/**
 * A `package.json` that runs a `src/` file the shape rules cannot classify —
 * behind two commands and three flags, the way `seed:dev` runs the dev seed.
 */
const DECLARING_PACKAGE_JSON = JSON.stringify({
  name: 'backend',
  scripts: {
    'seed:dev':
      'pnpm run migration:up && tsx --env-file-if-exists=.env src/seeds/dev-catalog-seed.ts',
  },
});

const UNSCOPED_SELF_RESCHEDULING = `
  const scheduleNext = (delayMs) => { timer = setTimeout(tick, delayMs); };
  const tick = () => { void reindex().then(() => scheduleNext(60000)); };
`;

/**
 * Entry sites in one synthetic file that establish no scope and are not ledgered.
 *
 * `kind` is asserted, not merely counted: the classifier is what went blind in
 * issue #128, and it fails by putting a site in the wrong class as readily as by
 * dropping it.
 */
function unscopedEntrySites(
  file: string,
  source: string,
  kind: EntryKind,
  declared: ReadonlySet<string> = new Set(),
): number {
  return violationsOf(findEntrySites(file, source, declared)).filter((e) => e.kind === kind).length;
}

/**
 * The declared-program shape (issue #228), entered where a real run enters it:
 * a `package.json` **text**, so the derivation that turns a script command into
 * an entry point runs. Handing over a ready-made path set would prove the
 * classifier over a population the parse is what produces — and the parse is the
 * part that had never existed.
 */
function unscopedDeclaredProgram(packageJson: string, file: string, source: string): number {
  const declared = new Set(declaredProgramEntryPoints(packageJson));
  return unscopedEntrySites(file, source, 'program', declared);
}

/**
 * Issue #237, and the reason the rewrite exists: one file, two entry sites, one
 * of them right.
 *
 * This is `kernel/lifecycle/registry-cache.ts` as issue #235 found it — a pub/sub
 * handler reading the database with no scope, and a correctly wrapped
 * `setInterval` 130 lines below. The file-level check reported it `scoped`,
 * because a file-level answer is a disjunction.
 */
const TWO_SITES_ONE_RIGHT = `
  export class Cache {
    watch(subscriber) {
      subscriber.on('message', () => { void this.refreshFromDb(); });
    }
    degrade() {
      setInterval(() => {
        void enterSystemScope('cache: degraded refresh', () => this.refreshFromDb());
      }, 30000);
    }
  }
`;

/**
 * The granularity itself, proven as a **discrimination**: the unscoped site is
 * reported *while* its sibling in the same file is scoped.
 *
 * Returning the violation count alone would go green on a check that had gone
 * back to answering per file and simply called the whole file unscoped — the
 * opposite defect, equally wrong. So the sibling's `scoped` is a precondition:
 * lose it and this proof reports nothing at all.
 */
function unscopedSiteBesideAScopedOne(): number {
  const sites = findEntrySites('/repo/backend/src/kernel/lifecycle/registry-cache.ts', TWO_SITES_ONE_RIGHT);
  if (sites.filter((site) => site.kind === 'interval' && site.scoped).length !== 1) return 0;
  return violationsOf(sites).filter((site) => site.kind === 'message').length;
}

/**
 * The same disjunction at its last hiding place: a **file-level** site — a
 * declared program — whose own top-level execution opens nothing, in a file
 * whose Worker opens a scope correctly. Asked over the whole file, the program
 * reads scoped off the Worker's wrapper.
 */
function unscopedProgramBesideAScopedWorker(): number {
  const declared = new Set(declaredProgramEntryPoints(DECLARING_PACKAGE_JSON));
  const sites = findEntrySites(
    '/repo/backend/src/seeds/dev-catalog-seed.ts',
    "const w = new Worker(Q, (job) => enterSystemScope('seed: job', () => run(job)));\nvoid main();",
    declared,
  );
  if (sites.filter((site) => site.kind === 'worker' && site.scoped).length !== 1) return 0;
  return violationsOf(sites).filter((site) => site.kind === 'program').length;
}

/**
 * The ledger's second direction, entered from source: a site the ledger exempts
 * that now opens a scope of its own. Handing `staleAllowances` a ready-made
 * record would prove the set subtraction and nothing above it — including the
 * key derivation, which is where a per-site ledger can silently stop matching.
 */
function staleLedgerEntry(): number {
  // The key is **derived from the ledger**, not written down. This proof used
  // to name `settings`' `modules-install.ts` shim, and it went silently dead
  // the day that shim was legitimately deleted (feature 080, T053(d)) — a red
  // proof keyed on one real entry is a hostage to that entry's retirement,
  // which is the failure this whole inventory exists to refuse.
  //
  // It takes the first `setInterval` entry because that is the construct this
  // fixture can synthesise, and returns 0 — failing the proof loudly — if the
  // ledger holds none. A ledger that stops containing the shape this proof
  // needs must say so, not pass.
  const key = Object.keys(NO_SCOPE_NEEDED).find((k) => k.endsWith(':setInterval'));
  if (key === undefined) return 0;
  const [path, enclosing] = key.split(':');
  if (path === undefined || enclosing === undefined || enclosing === '<file>') return 0;
  const sites = findEntrySites(
    `/repo/backend/${path}`,
    `export function ${enclosing}() {\n` +
      `  setInterval(() => enterSystemScope('lease', () => refresh()), 1000);\n` +
      `}\n`,
  );
  // The site must be recognised **and** scoped, or the stale verdict below
  // would be true for the uninteresting reason that no site was found at all.
  if (sites.filter((site) => site.scoped).length !== 1) return 0;
  return staleAllowances(sites).filter((stale) => stale === key).length;
}

/**
 * Violations of one signal only.
 *
 * The kind is asserted rather than the count, because a fixture written for one
 * signal routinely trips another — and a proof that counts both is a proof the
 * signal it names could go blind behind.
 */
function channelViolations(source: string, relPath: string, kind: ChannelViolation['kind']): number {
  return channelAnalyze(source, relPath).filter((v) => v.kind === kind).length;
}

/** One source, judged the way the CLI judges it: the hint decides, the parse rules. */
function classificationFindings(
  source: string,
  file: string,
  wanted: (count: number) => boolean,
): number {
  if (!ENTITY_DECORATOR_HINT.test(source)) return 0;
  return classificationAnalyze(source, file).filter((f) => wanted(f.classifications.length)).length;
}

function relationViolations(source: string, file: string): number {
  if (!RELATION_DECORATOR_HINT.test(source)) return 0;
  return boundaryAnalyze(source, file).filter(isViolation).length;
}

/**
 * A module importing another module's internals, in one synthetic file.
 *
 * The fixture is source text plus a path under `src/`, which is what a real run
 * reads: the specifier walker, the path normaliser and the surface classifier
 * all execute. A proof handing the check a resolved `{ owner, target }` pair
 * would prove the reporter and leave the two parts that can go blind — the
 * walker and the normaliser — unexercised, and it is the *normaliser* that has
 * the recorded defect: a prefix match on one nesting depth undercounted the
 * tree 2.2× (348 against the real 674), which is why both depths below get a
 * proof of their own rather than one shared one.
 */
const ORDER_SERVICE_FILE = 'modules/orders/services/order-service.ts';

function crossModuleKinds(source: string, file: string, kind: CrossModuleImportKind): number {
  return moduleBoundaryAnalyze(source, file).filter((f) => f.kind === kind).length;
}

function crossModuleTargets(source: string, file: string, target: string): number {
  return moduleBoundaryAnalyze(source, file).filter((f) => f.target === target).length;
}

/**
 * The one module package this repository has, as the check's CLI derives it —
 * npm name to manifest id, off the member's own `endora` block.
 *
 * The fixture is the map because the map is where the analysis begins for a bare
 * specifier (issue #130): a proof that handed in a resolved target would leave
 * the resolution — which is the whole of the defect — unexercised.
 */
const MODULE_PACKAGE_NAMES: ReadonlyMap<string, string> = new Map([
  ['@endora-commerce/mod-blog', 'blog'],
]);

function crossModulePackageTargets(source: string, file: string, target: string): number {
  return moduleBoundaryAnalyze(source, file, MODULE_PACKAGE_NAMES).filter(
    (f) => f.target === target,
  ).length;
}

/**
 * A module package's published surface, as the check's CLI reads it (D-171).
 *
 * The fixture is a **manifest and an emitted module**, because that is where the
 * analysis begins: a subpath is contract surface iff the module it resolves to
 * exports no runtime binding, and both the `exports` resolution and the
 * emitted-module read decide it. A proof that handed in a ready-made verdict
 * would prove the `continue` and leave the mechanism unexercised (issue #130).
 */
const MODULE_PACKAGE_DIR = '/w/packages/modules/blog';
const MODULE_PACKAGE_MANIFEST = JSON.stringify({
  name: '@endora-commerce/mod-blog',
  endora: { type: 'module', id: 'blog' },
  exports: {
    './backend': { types: './dist/backend/index.d.ts', default: './dist/backend/index.js' },
    './ports': { types: './dist/ports/index.d.ts', default: './dist/ports/index.js' },
  },
});

function modulePackageTree(portsEmit: string | null): Readonly<Record<string, string>> {
  const files: Record<string, string> = {
    [`${MODULE_PACKAGE_DIR}/package.json`]: MODULE_PACKAGE_MANIFEST,
    [`${MODULE_PACKAGE_DIR}/dist/backend/index.js`]:
      'export function registerModule(ctx) {}\nexport const entities = [];\n',
  };
  // `null` is the unbuilt subpath: declared, and the file behind it is not
  // there. It must refuse rather than exempt (issue #113).
  if (portsEmit !== null) files[`${MODULE_PACKAGE_DIR}/dist/ports/index.js`] = portsEmit;
  return files;
}

function packagedReaches(specifier: string, portsEmit: string | null): number {
  const files = modulePackageTree(portsEmit);
  return moduleBoundaryAnalyze(
    `import type { X } from '${specifier}';`,
    ORDER_SERVICE_FILE,
    MODULE_PACKAGE_NAMES,
    modulePackageSurfaces(new Map([['@endora-commerce/mod-blog', MODULE_PACKAGE_DIR]]), {
      exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      read: (path) => {
        const text = files[path];
        if (text === undefined) throw new Error(`[d171-fixture] no such file: ${path}`);
        return text;
      },
    }),
  ).length;
}

/** The tree the ledger proofs judge: one module reaching another module's entity. */
const ORDERS_READS_A_PRODUCT =
  "import { Product } from '../../catalog/entities/product.entity.js';";
const ORDERS_READS_NOTHING = 'export class OrderService {}';
/**
 * The same target, twice in one file — the shape the ledger key merges, and
 * therefore the shape only a count can speak about (issue #267).
 */
const ORDERS_READS_A_PRODUCT_TWICE = [
  "import type { Product } from '../../catalog/entities/product.entity.js';",
  'export class OrderService {',
  "  async load() { return import('../../catalog/entities/product.entity.js'); }",
  '}',
].join('\n');
const CROSS_MODULE_KEY = `${ORDER_SERVICE_FILE}:catalog/entities/product.entity`;

// --- check-admin-registrations (feature 091, FR-018) -------------------------
//
// The fixture is a route table and a nav, as declarations, plus the import map
// that says which surface directory a component comes from. That is where the
// attribution happens and therefore where the proof has to enter: a fixture
// handing in a ready-made owner would exercise the subtraction and leave the
// two attributions — the one that reads `App.tsx`'s imports and the one that
// reads `AppShell.tsx`'s `module` field — unrun (issue #130).
function adminRegistrationFindings(
  baseline: Readonly<Record<string, AdminRegistrationCounts>>,
  blog: AdminRegistrationCounts | null,
): readonly AdminRegistrationFinding[] {
  const routes: AdminRouteDeclaration[] = [];
  const nav: AdminNavDeclaration[] = [];
  if (blog !== null) {
    for (let at = 0; at < blog.routes; at += 1) {
      routes.push({ path: `/blog/${at}`, component: 'BlogPage', line: at + 1 });
    }
    for (let at = 0; at < blog.nav; at += 1) {
      nav.push({ to: `/blog/${at}`, module: 'blog', line: at + 1 });
    }
  }
  return checkAdminRegistrations(
    {
      routes,
      nav,
      componentDirectories: new Map([['BlogPage', 'blog']]),
      moduleOfDirectory: new Map([['blog', 'blog']]),
      registered: new Set(['blog']),
    },
    baseline,
  ).findings;
}

/** 1 when the record refuses the run, 0 when it does not. */
function adminRegistrationsVacuous(record: {
  readonly admin?: AdminSurfaceLayout | null;
  readonly routes: number;
  readonly nav: number;
  readonly baselineEntries: number;
}): number {
  const admin =
    record.admin === undefined
      ? ({ sourceRoot: 'admin/src' } as AdminSurfaceLayout)
      : record.admin;
  return adminRegistrationsVacuousReason({ ...record, admin }) === null ? 0 : 1;
}

function moduleBoundaryTree(source: string): Map<string, string> {
  return new Map([
    ['modules/orders/backend.ts', 'export function registerModule(ctx) {}'],
    ['modules/catalog/backend.ts', 'export function registerModule(ctx) {}'],
    [ORDER_SERVICE_FILE, source],
  ]);
}

// --- the admin population (feature 091, FR-017) ------------------------------
//
// The fixture is the **layout**, not a resolved attribution: which module owns
// an admin surface directory is exactly the thing that goes wrong, and a proof
// handed a ready-made owner would leave the alias expansion and the
// directory→module join — the two halves the defect lives in — unexercised
// (issue #130). `warehouses` is `inventory`'s here because `AppShell.tsx`
// attributes `/warehouses` to `module: 'inventory'` in the real tree, and
// `_shared` is nobody's for the same reason: no nav entry claims it.
const ADMIN_SURFACES: AdminBoundarySurfaces = {
  sourceRoot: 'admin/src',
  moduleRoot: 'admin/src/modules',
  aliasPrefix: '@/',
  moduleOfDirectory: new Map([
    ['catalog', 'catalog'],
    ['inventory', 'inventory'],
    ['warehouses', 'inventory'],
    ['assets_library', 'assets_library'],
  ]),
};

function adminReaches(source: string, file: string): readonly CrossModuleImport[] {
  return moduleBoundaryAnalyze(
    source,
    file,
    undefined,
    undefined,
    undefined,
    ADMIN_SURFACES,
  );
}

function adminTargets(source: string, file: string, target: string): number {
  return adminReaches(source, file).filter((finding) => finding.target === target).length;
}

/**
 * A reach the analysis must see, carried in every discrimination below so a
 * proof cannot go green off seeing nothing.
 */
const ADMIN_CONTROL = "import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';";

function adminOnlyTheControl(source: string, file: string): number {
  const found = adminReaches(source, file);
  return found.length === 1 && found[0]?.target === 'assets_library' ? 1 : 0;
}

/**
 * The schema the `sql` predicate's proofs resolve against — **source text**, not
 * a table→owner map (D-87; issue #130).
 *
 * A fixture handing in a ready-made map would leave both owner-map passes
 * unproven, and the second pass is the one with the recorded blindness: an
 * entity-only map resolves 220 tables and reports **zero** of the 39 findings
 * that hang off a join table or a channel bridge. So `products` and `cms_blocks`
 * arrive through `@Entity({ tableName })`, `sales_channels` through a *kernel*
 * entity, and `sales_channel_products` through `create table` DDL in the
 * pre-065 core block and nothing else.
 */
const SQL_BOUNDARY_SCHEMA: ReadonlyMap<string, string> = new Map([
  [
    'modules/catalog/entities/product.entity.ts',
    "@Entity({ tableName: 'products' })\nexport class Product {}",
  ],
  [
    'modules/blog/entities/blog-post.entity.ts',
    "@Entity({ tableName: 'blog_posts' })\nexport class BlogPost {}",
  ],
  ['modules/assets_library/entities/asset.entity.ts', '@Entity()\nexport class Asset {}'],
  [
    'modules/cms/entities/cms-block.entity.ts',
    "@Entity({ tableName: 'cms_blocks' })\nexport class CmsBlock {}",
  ],
  [
    'kernel/sales-channels/sales-channel.entity.ts',
    "@Entity({ tableName: 'sales_channels' })\nexport class SalesChannel {}",
  ],
  [
    'db/migrations/20260424T165847_core_foundation_init.ts',
    'this.addSql(`create table "sales_channel_products" ' +
      '("sales_channel_id" uuid not null, "product_id" uuid not null);`);',
  ],
]);

const BLOG_SERVICE_FILE = 'modules/blog/services/blog-service.ts';

/** One module source against {@link SQL_BOUNDARY_SCHEMA}: text in, findings out. */
function sqlBoundaryFindings(source: string, file: string = BLOG_SERVICE_FILE) {
  return findCrossModuleSql({
    sources: new Map([[file, source]]),
    schema: new Map([...SQL_BOUNDARY_SCHEMA, [file, source]]),
  }).found;
}

/**
 * A shape the predicate must **not** flag, proven as a discrimination.
 *
 * "No finding" cannot go red on its own, so each of these fixtures carries the
 * negative shape *and* a control the predicate does have to see, and returns 1
 * only when exactly the control comes back. A predicate that starts reading
 * comments, migrations or its own module's tables returns two findings and the
 * proof drops to 0 — red, in the run that widened it.
 */
/**
 * The same fixture with an installed package's tables in the map (T034).
 *
 * The package half enters here, at the check's own entry point, because that is
 * where a run hands it in: `loadPackageDeclarations` is proven separately, over
 * a package tree on disk, in `package-declarations.test.ts`.
 */
function sqlPackageFindings(
  source: string,
  packageTables: readonly PackageTable[] = FIXTURE_PACKAGE_TABLES,
  file: string = BLOG_SERVICE_FILE,
) {
  return findCrossModuleSql({
    sources: new Map([[file, source]]),
    schema: new Map([...SQL_BOUNDARY_SCHEMA, [file, source]]),
    packageTables,
  }).found;
}

/** What `@fixture/mod-widgets` declares: one entity table and one join table. */
const FIXTURE_PACKAGE_TABLES: readonly PackageTable[] = [
  {
    table: 'fixture_widgets',
    moduleId: 'fixture_widgets',
    packageName: '@fixture/mod-widgets',
    source: 'entity',
  },
  {
    table: 'fixture_widget_tags',
    moduleId: 'fixture_widgets',
    packageName: '@fixture/mod-widgets',
    source: 'migration',
  },
];

function sqlOnlyTheControl(source: string, file: string = BLOG_SERVICE_FILE): number {
  const found = sqlBoundaryFindings(source, file);
  return found.length === 1 && found[0]?.table === 'products' ? 1 : 0;
}

const SQL_CONTROL = 'await conn.execute(`select id from products where status = ?`, [s]);';

/**
 * The knex builder's fixtures (issue #187) — the same schema, the same entry
 * point, and a `syntax` assertion on every one.
 *
 * A builder names its table as an argument to a call, so a proof that only
 * checked the table would be satisfied by the statement path it is not testing.
 * {@link sqlBuilderFindings} therefore keeps only the builder findings, and the
 * discriminations below keep the builder control in the same fixture, so "no
 * finding" cannot go green on its own.
 */
const KNEX_BINDING = 'const knex = em.getKnex();';
const BUILDER_CONTROL = "await knex('products').where('status', s);";

function sqlBuilderFindings(source: string, file: string = BLOG_SERVICE_FILE) {
  return sqlBoundaryFindings(source, file).filter((f) => f.syntax === 'builder');
}

function sqlBuilderOnlyTheControl(source: string, file: string = BLOG_SERVICE_FILE): number {
  const found = sqlBoundaryFindings(source, file);
  return found.length === 1 && found[0]?.table === 'products' && found[0]?.syntax === 'builder'
    ? 1
    : 0;
}

const DRIFTED_DOC = [
  '# Doc',
  '',
  '<!-- verbatim-from: backend/src/example.ts -->',
  '```ts',
  'export function greet(name: string, extra: number): string {',
  '```',
].join('\n');

const DOC_CITING_A_MOVED_FILE = [
  '# Doc',
  '',
  '<!-- verbatim-from: backend/src/moved-away.ts -->',
  '```ts',
  'export function greet(name: string): string {',
  '```',
].join('\n');

const DOC_WITHOUT_A_FENCE = [
  '# Doc',
  '',
  '<!-- verbatim-from: backend/src/example.ts -->',
  'export function greet(name: string): string {',
].join('\n');

function docReaderFor(doc: string): (path: string) => string {
  return (path: string): string => {
    if (path.endsWith('example.ts')) return 'export function greet(name: string): string {\n';
    if (path.endsWith('moved-away.ts')) throw new Error('ENOENT');
    return doc;
  };
}

/** 1 when the artefact comparison refuses for the stated reason, 0 otherwise. */
function artifactVerdicts(
  rendered: string,
  read: (p: string) => string,
  reason: 'missing' | 'stale' | 'empty',
): number {
  const verdict = compareArtifact('/repo/x.generated.ts', rendered, read);
  return !verdict.ok && verdict.reason === reason ? 1 : 0;
}

/**
 * The `foreign` verdict's fixtures (feature 080, T030a).
 *
 * The roots are **derived**, by the same call a real run makes, because the
 * derivation — which of the paths under `node_modules` is a workspace member
 * linked out of this repository, and which is an installed package — is the
 * thing these proofs exist to protect. A hand-written root list would leave it
 * unrun, which is issue #130's shape.
 */
const CONTAINMENT_ROOTS = permittedRoots(REPO_ROOT);
const ENTITIES_REGISTRY_PATH = renderEntitiesRegistry(coreSources({})).outputPath;
const MIGRATIONS_REGISTRY_PATH = join(
  dirname(ENTITIES_REGISTRY_PATH),
  'migrations-registry.generated.ts',
);

/** A rendered artefact carrying exactly the specifiers a proof is about. */
function renderedArtefact(...specifiers: readonly string[]): string {
  const imports = specifiers.map((s, i) => `import { E${i} } from '${s}';`).join('\n');
  return `${imports}\n\nexport const ALL_ENTITIES = [] as const;\n`;
}

function foreignSpecifiers(content: string): string[] {
  return containmentSites(ENTITIES_REGISTRY_PATH, content, CONTAINMENT_ROOTS)
    .filter((site) => site.verdict === 'foreign')
    .map((site) => site.specifier);
}

/**
 * The leak, through the real generator and with the artefact byte-identical to
 * disk — i.e. deterministic, which is the state in which nothing else looks.
 */
function renderedLeakFindings(): number {
  const rendered = renderEntitiesRegistry(
    coreSources({
      'node_modules/@vendor/mod-blog/entities/probe.entity.ts':
        '@Entity()\nexport class VendorProbe {}\n',
    }),
  );
  const examined = examineArtifact(
    rendered.outputPath,
    rendered.content,
    () => rendered.content,
    CONTAINMENT_ROOTS,
  );
  return !examined.verdict.ok && examined.verdict.reason === 'foreign' ? 1 : 0;
}

/** Bare workspace member beside a bare installed package: only the latter. */
function workspaceMemberOnlyTheControl(): number {
  const found = foreignSpecifiers(renderedArtefact('@endora-commerce/contracts/src/index.js', 'zod/index.js'));
  return found.length === 1 && found[0] === 'zod/index.js' ? 1 : 0;
}

/** A core-tree entry beside a leaked one: only the leak. */
function coreEntryOnlyTheControl(): number {
  const found = foreignSpecifiers(
    renderedArtefact(
      '../modules/blog/entities/post.entity.js',
      '../node_modules/@vendor/mod-blog/entities/probe.entity.js',
    ),
  );
  return found.length === 1 && found[0]?.includes('node_modules') === true ? 1 : 0;
}

/**
 * The floor, over real examinations: an artefact that contributed no entry is
 * refused **by name**, and the one that contributed some is not.
 */
function containmentFloorRefusals(): number {
  const withEntries = renderedArtefact('../modules/blog/entities/post.entity.js');
  const contained = examineArtifact(
    ENTITIES_REGISTRY_PATH,
    withEntries,
    () => withEntries,
    CONTAINMENT_ROOTS,
  );
  const noEntry = 'export const MIGRATION_REGISTRY = [] as const;\n';
  const silent = examineArtifact(
    MIGRATIONS_REGISTRY_PATH,
    noEntry,
    () => noEntry,
    CONTAINMENT_ROOTS,
  );
  const refusal = vacuousContainmentPopulation([contained, silent], CONTAINMENT_ROOTS);
  // Named, not counted: a refusal naming the artefact that *did* contribute
  // entries would mean the floor is firing on the wrong one, and would be just
  // as non-zero.
  return refusal !== null &&
    refusal.includes('migrations-registry.generated.ts') &&
    vacuousContainmentPopulation([contained], CONTAINMENT_ROOTS) === null
    ? 1
    : 0;
}

/** Findings a document produces, of the one shape the proof is about. */
function snippetFindings(doc: string, message: string): number {
  return checkDocument('d.md', docReaderFor(doc)).filter((f) => f.message.includes(message)).length;
}

/**
 * Documents discovered under a synthetic tree.
 *
 * The discovery half is why this check exists at all: membership used to be an
 * opt-in list of two files, one of which carried no marker, so it reported "2
 * documents checked" over one that participated. A proof that only ran
 * `checkDocument` would never touch that.
 */
function discoveredCitingDocuments(): number {
  const root = mkdtempSync(join(tmpdir(), 'endora-doc-snippets-'));
  try {
    mkdirSync(join(root, 'docs/docs/guide'), { recursive: true });
    writeFileSync(
      join(root, 'docs/docs/guide/page.md'),
      '<!-- verbatim-from: backend/src/example.ts -->\n',
      'utf8',
    );
    writeFileSync(join(root, 'docs/docs/guide/other.md'), '# No marker here\n', 'utf8');
    // Exactly the one that asked for the guarantee: a discovery that returns
    // every page would also be non-zero, and would mean the marker enrols
    // nothing.
    const found = discoverCitingDocuments(root);
    return found.length === 1 && found[0] === 'docs/docs/guide/page.md' ? 1 : 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Hand-released harness resources in one synthetic test file.
 *
 * The fixture is source text, so both stages run: the binding pass that decides
 * which identifiers hold a `BackendServerHandle`, and the release pass over the
 * resource table. Handing the second a name the first never produced is the
 * shape issue #130 is about — and here it is the *binding* that would go blind
 * first, since a handle is spelled three ways and only one of them mentions
 * `setupBackendServer`.
 */
/**
 * `check-fixture-substitution`'s analysis, entered where a real run enters it:
 * one test file's source text, an empty ledger, violations out.
 */
function defaultedReads(file: string, source: string): number {
  return checkFixtureSubstitution({ sources: new Map([[file, source]]) }, {}).violations.length;
}

/**
 * `check-shared-table-wipes`' analysis, entered where a real run enters it: one
 * test file's source text and an empty baseline, findings out.
 *
 * Filtered by the finding's `kind`, so the three spellings prove themselves
 * separately — an ORM-only detector reports zero over a `truncate`, and zero is
 * what a drained tree looks like.
 */
function tableWipes(file: string, source: string, kind: WipeKind): number {
  const sources = new Map([[file, source]]);
  const over = checkSharedTableWipes({ sources }, {}).regressions.length;
  return over === 0 ? 0 : findUnscopedWipes({ sources }).filter((w) => w.kind === kind).length;
}

function handReleases(file: string, source: string, resource: string): number {
  return checkHarnessTeardown({ sources: new Map([[file, source]]) }, {}).violations.filter(
    (v) => v.resource === resource,
  ).length;
}

/** The `let h: BackendServerHandle` + `beforeAll` shape every converted file uses. */
const HANDLE_DECLARED = 'let h: BackendServerHandle;\n';

/**
 * The command-coverage **population**, on disk — the half of that check no
 * proof reached (issue #134).
 *
 * `analyzeSource` was proven on three shapes and the two stages above it were
 * not: `collectScannedFiles`, which decides what is judged at all, and
 * `isMigratedModulePath`, which decides whether a finding blocks the build or
 * only prints. That is the same seam issue #128 sat behind — a violation list
 * stays empty for a file that was never handed to the analyzer, and unread and
 * clean print the same line. The walk once anchored on `/services/`, so the
 * fixture puts the write in a `routes.admin.ts`.
 */
function commandCoverageTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'endora-command-coverage-'));
  mkdirSync(join(root, 'src/modules/orders/migrations'), { recursive: true });
  mkdirSync(join(root, 'src/modules/audit_logs/services'), { recursive: true });
  mkdirSync(join(root, 'src/modules/blog/services'), { recursive: true });
  for (const file of [
    'src/modules/orders/routes.admin.ts',
    'src/modules/orders/migrations/20260901T000000_orders_thing.ts',
    'src/modules/audit_logs/services/audit-log.service.ts',
    'src/modules/blog/services/blog.service.ts',
  ]) {
    writeFileSync(join(root, file), UNAUDITED_WRITE, 'utf8');
  }
  return root;
}

/** Repo-relative path → how many findings the analyzer reports for it. */
function commandCoverageWalk(root: string): Map<string, number> {
  return new Map(
    collectScannedFiles(join(root, 'src/modules')).map((file) => {
      const rel = relative(root, file).replaceAll('\\', '/');
      return [rel, commandCoverageAnalyze(rel, readFileSync(file, 'utf8')).length] as const;
    }),
  );
}

/** The walk reaches the file the rule is about, and only the arguable exclusions are missing. */
function commandCoveragePopulation(): number {
  const root = commandCoverageTree();
  try {
    const walked = commandCoverageWalk(root);
    // A walk that returned everything would also be non-zero, and would mean
    // the two exclusions in the header are not exclusions at all.
    return (walked.get('src/modules/orders/routes.admin.ts') ?? 0) > 0 &&
      !walked.has('src/modules/orders/migrations/20260901T000000_orders_thing.ts') &&
      !walked.has('src/modules/audit_logs/services/audit-log.service.ts')
      ? 1
      : 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `--module orders` makes that module's findings blocking and leaves the rest report-only. */
function commandCoverageModuleSelection(): number {
  const root = commandCoverageTree();
  try {
    const walked = commandCoverageWalk(root);
    const named = 'src/modules/orders/routes.admin.ts';
    const unnamed = 'src/modules/blog/services/blog.service.ts';
    // Named on both sides: a classifier that answered `true` for everything
    // would block the whole tree, which is the mirror of answering `false`.
    return (walked.get(named) ?? 0) > 0 &&
      (walked.get(unnamed) ?? 0) > 0 &&
      isMigratedModulePath(named, ['orders']) &&
      !isMigratedModulePath(unnamed, ['orders'])
      ? 1
      : 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Ungated uncatchable entry points of one construct, in one synthetic file. */
function ungatedTimers(file: string, source: string, construct: EntryConstruct): number {
  return checkEntryPresence({ sources: new Map([[file, source]]) }, {}).violations.filter(
    (v) => v.construct === construct,
  ).length;
}

/**
 * Ungated entry points of one **finding kind**, in one synthetic file.
 *
 * The kind is what the boot-hook proofs assert, not the count: `mixed-boot-hook`
 * and `no-presence-decision` are two different repairs — "split it first" and
 * "probe the top" — and a check that collapsed the first into the second would
 * still report a finding while teaching the change that breaks the tree
 * (D-68).
 */
function ungatedEntriesOfKind(file: string, source: string, finding: EntryFinding): number {
  return checkEntryPresence({ sources: new Map([[file, source]]) }, {}).violations.filter(
    (v) => v.finding === finding,
  ).length;
}

/** A `blog` boot hook that does work and asks nothing — the plain D-68 shape. */
const UNPROBED_WORK_BOOT_HOOK = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    await seedDefaultCategory(ctx.cradle<BlogCradle>().emFactory);
  });
}
`;

/** The same hook with the probe nested where a `catch` can swallow it. */
const BOOT_HOOK_PROBED_INSIDE_TRY = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    try {
      if (!effectiveState.isPresent('blog')) return;
      await seedDefaultCategory(ctx.cradle<BlogCradle>().emFactory);
    } catch (err) {
      console.warn(err);
    }
  });
}
`;

/**
 * `blog`'s hook as it stood before D-68 split it: an asset-reference scanner
 * registered beside two row-writing seeds. Probing this hook stops the scanner,
 * after which an operator can delete an asset a switched-off `blog` still
 * references — which is why the check has to report it as its own kind.
 */
const MIXED_BOOT_HOOK = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    const { assetReferenceRegistry, emFactory } = ctx.cradle<BlogCradle>();
    registerBlogAssetReferences(assetReferenceRegistry, emFactory);
    await seedDefaultCategory(emFactory);
  });
}
`;

/** Runs one shell check over a fixture that violates it; 1 when it goes red. */
function shellRed(script: string, prepare: (f: ReturnType<typeof createShellCheckFixture>) => void): number {
  const fixture = createShellCheckFixture();
  try {
    prepare(fixture);
    return fixture.run(script).status === 1 ? 1 : 0;
  } finally {
    fixture.cleanup();
  }
}

/**
 * 1 when the shell check **refused** the fixture rather than judging it.
 *
 * Separate from {@link shellRed} because the two are different verdicts and a
 * proof that accepted either would go green on a check that had stopped telling
 * "this tree is wrong" from "I could not read this tree" — which is the whole
 * of issue #113, and the reason exit 2 exists.
 */
function shellRefusal(
  script: string,
  prepare: (f: ReturnType<typeof createShellCheckFixture>) => void,
): number {
  const fixture = createShellCheckFixture();
  try {
    prepare(fixture);
    return fixture.run(script).status === 2 ? 1 : 0;
  } finally {
    fixture.cleanup();
  }
}

/** A file for `check-nul-bytes`: its path and its raw bytes, the check's own input. */
const nulFile = (path: string, text: string): ScannedFile => ({
  path,
  bytes: new TextEncoder().encode(text),
});

/**
 * A source whose NUL sits past the 8000 bytes git reads before deciding binary.
 *
 * `admin-actions-service.ts` carried its NUL at byte 8032, so git kept diffing
 * it as text; a check that copied git's window would have read it clean.
 */
const nulPastGitWindow = (path: string): ScannedFile =>
  nulFile(path, `${'// padding\n'.repeat(Math.ceil((GIT_BINARY_WINDOW + 64) / 11))}const k = \`a\0b\`;`);

/** 1 when exactly the expected paths came back — the shape a discrimination needs. */
const exactlyNulPaths = (files: readonly ScannedFile[], expected: readonly string[]): number =>
  JSON.stringify(findNulBytes(files).map((f) => f.path)) === JSON.stringify(expected) ? 1 : 0;

/**
 * The same discrimination, over a **tree on disk** rather than over records.
 *
 * A directory exclusion has two consumers — the walk, which prunes it, and
 * `isScannablePath`, which states the rule — and a `ScannedFile` list enters
 * below both: it hands the analysis a path the walk has already decided to
 * emit. So issue #248's exclusions are proven through a spawned run over a
 * fixture repository, which is the only input that can see a pruning stop
 * happening. See `test/helpers/nul-bytes-check-fixture.ts`.
 */
const nulTreeSkips = (generated: string, source: string): number =>
  reportsOnlyTheSourceFile(generated, source);

/** A file for `check-diacritic-folds`: a repo-relative path and its source text. */
const foldSource = (path: string, source: string): FoldSource => ({ path, source });

/** The naive one-liner four admin authors wrote, parameterised by its two halves. */
const naiveFold = (form: 'NFD' | 'NFKD', strip: string): string =>
  `export const n = (v: string) => v.normalize('${form}').replace(${strip}, '');`;

/** U+0300–U+036F as the characters themselves — how one backend slugifier spells it. */
const RAW_COMBINING_RANGE = `[${'̀'}-${'ͯ'}]`;

/**
 * A hand-rolled slug builder, parameterised by the two things that vary.
 *
 * `fold` is the step whose **absence** was undetectable before issue #244: a
 * site that passes `''` here writes no fold at all, so the first two signals
 * see nothing in it — which is precisely why the `slug-run` proofs below have
 * to be written against both values.
 */
const handRolledSlug = (fold: string, collapse: string): string =>
  `export const slug = (v: string) => ${fold}(v).replace(${collapse}, '-');`;

/** 1 when exactly the expected paths folded — the shape a discrimination needs. */
const exactlyFoldPaths = (files: readonly FoldSource[], expected: readonly string[]): number =>
  JSON.stringify([...new Set(findDiacriticFolds(files).map((f) => f.path))]) ===
  JSON.stringify(expected)
    ? 1
    : 0;

// --- the inventory ----------------------------------------------------------

/**
 * `check-singleton-identity` over source text and a package list — every input a
 * real run has, and none of its answers (feature 080, T061).
 *
 * The package's composition is written out rather than derived from a value,
 * because the verdict rests on it: `paymentAdapterRegistry` is a finding only
 * because `registerModule` hands *that object* to the container, and
 * `PaymentMethod` only because the package's `entities` array publishes it. The
 * consumer's second import is what makes the process hold both copies, and it
 * is a real specifier the analysis has to resolve.
 */
function singletonIdentityFindings(
  consumer: string,
  kind: SingletonIdentityFindingKind,
  allowed: Readonly<Record<string, string>> = {},
): number {
  return checkSingletonIdentity(
    {
      sources: new Map([
        [
          'packages/modules/payment_methods/src/backend/index.ts',
          "import { paymentAdapterRegistry } from './services/registry-singleton.js';\n" +
            "import { PaymentMethod } from './entities/payment-method.entity.js';\n" +
            'export const entities = [PaymentMethod];\n' +
            'export function registerModule(ctx) {\n' +
            '  ctx.di.register({ paymentAdapterRegistry: ctx.asFunction(() => paymentAdapterRegistry) });\n' +
            '}\n',
        ],
        [
          'packages/modules/payment_methods/src/backend/services/registry-singleton.ts',
          'export const paymentAdapterRegistry = new PaymentAdapterRegistry();\n',
        ],
        [
          'packages/modules/payment_methods/src/backend/entities/payment-method.entity.ts',
          '@Entity()\nexport class PaymentMethod {}\n',
        ],
        ['backend/test/integration/place-order.test.ts', consumer],
      ]),
      packages: [
        {
          moduleId: 'payment_methods',
          npmName: '@endora-commerce/mod-payment-methods',
          root: 'packages/modules/payment_methods',
        },
      ],
    },
    allowed,
  ).findings.filter((finding) => finding.kind === kind).length;
}

/** The line that puts the package's published artefact in the same process. */
const LOADS_THE_ARTEFACT =
  "import * as pm from '@endora-commerce/mod-payment-methods/backend';\n";

/**
 * `check-singleton-identity`'s chain-parent signal, over the arrangement batch
 * four met (T061a): an entity class in one package, the `@TransitivelyScoped`
 * child that names it in another, and a **service** between the consumer and the
 * entity — so nothing the consumer writes mentions the duplicated class.
 *
 * Written out rather than derived, for the reason the fixture above is: the
 * verdict rests on `Document` being both a chain parent (`Filing` names it) and
 * a member of the package's published `entities` array, and a proof that handed
 * in either answer would leave the derivation that finds them unproven.
 */
const CHAIN_PARENT_FILES: Record<string, string> = {
  'packages/modules/billing/src/backend/entities/document.entity.ts':
    "@Entity({ tableName: 'documents' })\nexport class Document {}\n",
  'packages/modules/billing/src/backend/services/document-corrections.ts':
    "import { Document } from '../entities/document.entity.js';\n" +
    'export class DocumentCorrections { constructor() { void Document; } }\n',
  'packages/modules/billing/src/backend/index.ts':
    "import { Document } from './entities/document.entity.js';\n" +
    'export const entities = [Document];\n',
  'packages/modules/filings/src/backend/entities/filing.entity.ts':
    "@Entity({ tableName: 'filings' })\n@TransitivelyScoped('Document', 'documentId')\n" +
    'export class Filing {}\n',
  'backend/src/composition.generated.ts':
    "import * as billing from '@endora-commerce/mod-billing/backend';\n" +
    'export const MODULES = [billing];\n',
  'backend/test/helpers/test-server.ts':
    "import { MODULES } from '../../src/composition.generated.js';\n" +
    'export function setupBackendServer() { return MODULES; }\n',
};

const CHAIN_PARENT_PACKAGES = [
  {
    moduleId: 'billing',
    npmName: '@endora-commerce/mod-billing',
    root: 'packages/modules/billing',
  },
  {
    moduleId: 'filings',
    npmName: '@endora-commerce/mod-filings',
    root: 'packages/modules/filings',
  },
];

function chainParentFindings(
  consumers: Record<string, string>,
  kind: SingletonIdentityFindingKind,
): number {
  return checkSingletonIdentity(
    {
      sources: new Map(Object.entries({ ...CHAIN_PARENT_FILES, ...consumers })),
      packages: CHAIN_PARENT_PACKAGES,
    },
    {},
  ).findings.filter((finding) => finding.kind === kind).length;
}

/** The service reach: the consumer names a service, the service names the class. */
const REACHES_THE_SERVICE =
  "import { DocumentCorrections } from " +
  "'../../../packages/modules/billing/src/backend/services/document-corrections.js';\n";

const CHECKS: readonly CheckEntry[] = [
  {
    // Feature 091's FR-018. Four findings, and the two count drifts are the
    // ones the ratchet exists for — a batch that moves a module's admin
    // directory does not touch either host file, so the number it leaves
    // behind describes a registration that is now declared twice. Every
    // fixture enters as route and nav **declarations** plus the import map,
    // because the attribution — a route by the directory its component comes
    // from, a nav entry by the `module` field it carries — is where the defect
    // lives; a proof handed a ready-made owner would count the arithmetic and
    // nothing above it (issue #130).
    script: 'backend/scripts/check-admin-registrations.ts',
    npmScript: 'check:admin-registrations',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-admin-registrations.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    // Its population is the admin's two host registries, which a moved backend
    // module tree does not touch. What it *does* follow is the admin module
    // root, derived from the source alias — and losing that is exit 2 through
    // its own first vacuous reason, proven below.
    residueGuard: 'not-a-module-walk',
    red: {
      'unrecorded-module': top(
        () =>
          adminRegistrationFindings({}, { routes: 1, nav: 1 }).filter(
            (finding) => finding.kind === 'unrecorded-module',
          ).length,
      ),
      'stale-baseline-entry': top(
        () =>
          adminRegistrationFindings({ blog: { routes: 3, nav: 1 } }, null).filter(
            (finding) => finding.kind === 'stale-baseline-entry' && finding.owner === 'blog',
          ).length,
      ),
      // The direction Story 3 produces: the screens moved into the package and
      // the `<Route>` stayed, so the admin declares it twice.
      'route-count-drift-above': top(
        () =>
          adminRegistrationFindings({ blog: { routes: 3, nav: 1 } }, { routes: 1, nav: 1 }).filter(
            (finding) => finding.kind === 'route-count-drift',
          ).length,
      ),
      // The other direction: a module grew a hand-written registration, which
      // after Phase 2 is no longer how an admin screen is added.
      'route-count-drift-below': top(
        () =>
          adminRegistrationFindings({ blog: { routes: 0, nav: 1 } }, { routes: 1, nav: 1 }).filter(
            (finding) => finding.kind === 'route-count-drift',
          ).length,
      ),
      'nav-count-drift': top(
        () =>
          adminRegistrationFindings({ blog: { routes: 1, nav: 4 } }, { routes: 1, nav: 1 }).filter(
            (finding) => finding.kind === 'nav-count-drift',
          ).length,
      ),
      // The four vacuous reasons, each entered on the record a real run builds.
      // Without them a tree whose admin had moved would compare an empty walk
      // against an empty baseline and report a cheerful zero.
      'no-admin-layout-refuses': top(() =>
        adminRegistrationsVacuous({ admin: null, routes: 0, nav: 0, baselineEntries: 1 }),
      ),
      'no-routes-refuses': top(() =>
        adminRegistrationsVacuous({ routes: 0, nav: 1, baselineEntries: 1 }),
      ),
      'no-nav-refuses': top(() =>
        adminRegistrationsVacuous({ routes: 1, nav: 0, baselineEntries: 1 }),
      ),
      'empty-baseline-refuses': top(() =>
        adminRegistrationsVacuous({ routes: 1, nav: 1, baselineEntries: 0 }),
      ),
    },
  },
  {
    // Four signals in the header, so four proofs — signal 4 carries both of the
    // positions it was widened to see (D-48), which is the pair signal 3 could
    // not reach.
    script: 'backend/scripts/check-channel-resolution.ts',
    npmScript: 'channel:resolution',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-channel-resolution.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'raw-channel-header': top(() =>
        channelViolations(
          "const code = request.headers['x-sales-channel'];",
          'modules/catalog/services/pricing.service.ts',
          'raw-channel-header',
        ),
      ),
      'request-channel-reresolution': top(() =>
        channelViolations(
          'const channel = await em.findOne(SalesChannel, { code });',
          'modules/catalog/services/catalog-query.service.ts',
          'request-channel-reresolution',
        ),
      ),
      'settings-channel-literal': top(() =>
        channelViolations(
          "const value = await this.settings.get('shop.name', 'default');",
          'modules/settings/services/branding.service.ts',
          'settings-channel-literal',
        ),
      ),
      'invented-identifier-default-parameter': top(() =>
        channelViolations(
          "export function buy(sku: string, salesChannelId: string = 'default') { return sku; }",
          'modules/quick_order/services/one-click.service.ts',
          'invented-channel-identifier',
        ),
      ),
      'invented-identifier-random-uuid': top(() =>
        channelViolations(
          'const salesChannelId = channel?.id ?? randomUUID();',
          'modules/orders/services/order-creation.service.ts',
          'invented-channel-identifier',
        ),
      ),
    },
  },
  {
    script: 'backend/scripts/check-command-coverage.ts',
    npmScript: 'check:command-coverage',
    job: 'quality',
    companionTest: 'backend/test/unit/commands/check-command-coverage.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'unaudited-sensitive-write': top(
        () =>
          commandCoverageAnalyze('src/modules/catalog/services/thing.service.ts', UNAUDITED_WRITE)
            .filter((f) => f.kind === 'unaudited-sensitive-write').length,
      ),
      'double-audit': top(
        () =>
          commandCoverageAnalyze(
            'src/modules/catalog/services/thing.service.ts',
            DOUBLE_AUDITED_WRITE,
          ).filter((f) => f.kind === 'double-audit').length,
      ),
      // The escape hatch's own ratchet: a marker guarding a write that has moved
      // away reads as a considered decision about a write that is not there.
      'stale-ignore': top(
        () =>
          commandCoverageAnalyze('src/modules/catalog/services/thing.service.ts', STALE_IGNORE)
            .filter((f) => f.kind === 'stale-ignore').length,
      ),
      // The two stages above the analyzer, which nothing proved until issue
      // #134: the disk walk that decides what is judged at all, and the
      // `--module` classifier that decides whether a finding blocks. Both take
      // a fixture tree on disk, because that is what a real run reads.
      'scan-walk-population': top(commandCoveragePopulation),
      'module-selection-blocks': top(commandCoverageModuleSelection),
      // --- `em.create` joins the vocabulary (D-89) --------------------------
      //
      // Three for the widening and two for its edges. `create` is the name of
      // nearly every service method in this tree, so the EntityManager
      // narrowing is what keeps the widening from manufacturing findings — and
      // `field-assignment-alone` asserts the limit the header now states in
      // writing, rather than leaving it to be discovered.
      'em-create-unaudited': top(
        () =>
          commandCoverageAnalyze('src/modules/catalog/services/thing.service.ts', EM_CREATE_WRITE)
            .filter((f) => f.kind === 'unaudited-sensitive-write').length,
      ),
      'service-create-not-flagged': top(() => {
        const findings = commandCoverageAnalyze(
          'src/modules/catalog/services/thing.service.ts',
          `${EM_CREATE_WRITE}\n${SERVICE_CREATE_CALL}`,
        ).filter((f) => f.kind === 'unaudited-sensitive-write');
        // The `remove` narrowing's twin: `deps.orderService.create(…)` is a call
        // into an audited service, not an ORM mutation. Proven against the
        // control above, because "no finding" cannot go red on its own.
        return findings.length === 1 && findings[0]?.method === 'rename' ? 1 : 0;
      }),
      'create-under-a-command': top(() => {
        const findings = commandCoverageAnalyze(
          'src/modules/catalog/services/thing.service.ts',
          `${EM_CREATE_WRITE}\n${EM_CREATE_UNDER_COMMAND}`,
        ).filter((f) => f.kind === 'unaudited-sensitive-write');
        return findings.length === 1 && findings[0]?.method === 'rename' ? 1 : 0;
      }),
      'field-assignment-alone': top(() => {
        const findings = commandCoverageAnalyze(
          'src/modules/catalog/services/thing.service.ts',
          `${EM_CREATE_WRITE}\n${FIELD_ASSIGNMENT_ONLY}`,
        ).filter((f) => f.kind === 'unaudited-sensitive-write');
        // Not an oversight: the header says a call-shaped check cannot see
        // `order.status = ref`, and this is the assertion under that sentence.
        return findings.length === 1 && findings[0]?.method === 'rename' ? 1 : 0;
      }),
      // D-89(c) — the mirror image. A marker on a caller whose downstream
      // carries its own marker is provably guarding nothing, and until now the
      // transitive rule counted the downstream's write and kept it alive.
      'marker-on-a-caller-of-a-marked-unit': top(
        () =>
          commandCoverageAnalyze(
            'src/modules/catalog/services/thing.service.ts',
            MARKED_CALLER_OF_MARKED_UNIT,
          ).filter((f) => f.kind === 'stale-ignore' && f.method === 'publish').length,
      ),
    },
  },
  {
    // Every shape a specifier can take, because a module that wants the
    // container can spell it five ways and only one of them is `import … from`.
    script: 'backend/scripts/check-container-imports.ts',
    npmScript: 'check:container-imports',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/container-import-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      import: top(() => containerAnalyze("import { asClass } from 'awilix';\n", MODULE_FILE).length),
      'import-type': top(
        () => containerAnalyze("import type { Resolver } from 'awilix';\n", MODULE_FILE).length,
      ),
      'export-from': top(
        () => containerAnalyze("export { asClass } from 'awilix';\n", MODULE_FILE).length,
      ),
      'dynamic-import': top(
        () => containerAnalyze("const a = await import('awilix');\n", MODULE_FILE).length,
      ),
      // A deep specifier, which is the other half of the rule: the package name
      // is matched, not the exact string.
      require: top(
        () => containerAnalyze("const a = require('awilix/lib/awilix.js');\n", MODULE_FILE).length,
      ),
    },
  },
  {
    script: 'backend/scripts/check-doc-snippets.ts',
    npmScript: 'check:doc-snippets',
    job: 'quality',
    companionTest: 'backend/test/unit/docs/check-doc-snippets.test.ts',
    vacuousGuard: 'exit-2',
    // Its population is the citing documents, not the tree they cite; a moved
    // target is a citation that no longer matches, which is a finding. Feature
    // 080's T010 re-examined it and left the root where it is for that reason —
    // the module tree cannot make this check go silently green. Its own
    // document roots can, and since T010 a root that contributes no markdown
    // file exits 2 rather than being covered by the other one.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'drifted-quotation': top(() => snippetFindings(DRIFTED_DOC, 'not a verbatim quotation')),
      'cited-file-moved': top(() =>
        snippetFindings(DOC_CITING_A_MOVED_FILE, 'cited file does not exist'),
      ),
      'marker-without-a-fence': top(() =>
        snippetFindings(DOC_WITHOUT_A_FENCE, 'not followed by a fenced code block'),
      ),
      // Not a violation count: the population. A discovery that stops matching
      // reports zero documents and every one of them reads as checked.
      discovery: top(discoveredCitingDocuments),
      // The population one level up: a declared root that contributed nothing,
      // which the total-loss guard cannot see because the other root is full.
      'empty-document-root': top(emptyDocumentRoot),
    },
  },
  {
    script: 'backend/scripts/check-entity-tenant-classification.ts',
    npmScript: null,
    job: 'quality',
    companionTest: 'backend/test/unit/tenancy/classification-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      unclassified: top(() =>
        classificationFindings(
          '@Entity({ tableName: "widgets" })\nexport class Widget {}',
          'src/modules/catalog/entities/widget.ts',
          (count) => count === 0,
        ),
      ),
      // Exactly one is the rule, so two decorators fail as loudly as none.
      'more-than-one-classification': top(() =>
        classificationFindings(
          '@Entity()\n@OrgScoped()\n@GlobalEntity()\nexport class Widget {}',
          'src/modules/catalog/entities/widget.ts',
          (count) => count > 1,
        ),
      ),
      // Feature 080, T034. The population is the platform, not the tree: a
      // module can arrive as an installed package, and a published one ships
      // compiled output in which the decorated source text above is gone — so
      // the two proofs enter with the package's *declarations*, which is where
      // this check receives them. The enumeration under that, on a package tree
      // on disk, is proven in `package-declarations.test.ts`; splitting them
      // there is what keeps each proof at the top of the analysis it protects.
      'package-entity-without-a-classification': top(
        () =>
          packageEntityFindings([
            {
              moduleId: 'fixture_widgets',
              packageName: '@fixture/mod-widgets',
              className: 'FixtureWidget',
              table: 'fixture_widgets',
              classifications: [],
              file: '/instance/node_modules/@fixture/mod-widgets/lib/backend/index.js',
            },
          ]).filter((finding) => finding.classifications.length === 0).length,
      ),
      // The refusal, which is the property that stops this check answering "no
      // owner" in silence: a discovered package whose entities cannot be
      // enumerated stops the run at exit 2 instead of being credited with none.
      'unreadable-package-refuses': top(() =>
        unreadablePackageReason({
          ...NO_PACKAGE_DECLARATIONS,
          discovered: 1,
          unreadable: [
            {
              packageName: '@fixture/mod-schema-without-entities',
              moduleId: 'fixture_schema_only',
              at: '/instance/node_modules/@fixture/mod-schema-without-entities/package.json',
              reason: 'it ships migrations and its "./backend" export declares no `entities`',
            },
          ],
        }) === null
          ? 0
          : 1,
      ),
    },
  },
  {
    script: 'backend/scripts/check-entry-scope.ts',
    npmScript: 'check:entry-scope',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/entry-scope-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      cli: top(() =>
        unscopedEntrySites(
          '/repo/backend/src/modules/search/scripts/reindex.ts',
          'void main();',
          'cli',
        ),
      ),
      worker: top(() =>
        unscopedEntrySites(
          '/repo/backend/src/modules/search/workers/index-worker.ts',
          "const worker = new Worker('search.index', handle);",
          'worker',
        ),
      ),
      'interval-setInterval': top(() =>
        unscopedEntrySites(
          '/repo/backend/src/modules/search/plugin.ts',
          'setInterval(() => { void reindex(); }, 60000);',
          'interval',
        ),
      ),
      // The spelling the classifier could not see until issue #128.
      'interval-self-rescheduling': top(() =>
        unscopedEntrySites(
          '/repo/backend/src/modules/search/plugin.ts',
          UNSCOPED_SELF_RESCHEDULING,
          'interval',
        ),
      ),
      // Issue #228 — the shape the *population* could not see: a program
      // `package.json` runs that is under no `scripts/` directory, constructs no
      // Worker and starts no timer. `unscoped=0` said nothing about it.
      'declared-program': top(() =>
        unscopedDeclaredProgram(
          DECLARING_PACKAGE_JSON,
          '/repo/backend/src/seeds/dev-catalog-seed.ts',
          'main().catch((err) => { process.exit(1); });',
        ),
      ),
      // Issue #235's own class: a message delivered off a socket the composition
      // opened has no caller to inherit a context from, and the check had no
      // population for it at all.
      'pubsub-message': top(() =>
        unscopedEntrySites(
          '/repo/backend/src/kernel/lifecycle/registry-cache.ts',
          "subscriber.on('message', () => { void refreshFromDb(em); });",
          'message',
        ),
      ),
      // Issue #237 — `kernel/container.ts` is under no `scripts/` directory, is
      // no declared program, constructs no Worker and starts no timer, so no
      // file-level class ever contained its shutdown handler. The event is a
      // loop variable there, which is why an unreadable one stays in.
      'process-lifecycle': top(() =>
        unscopedEntrySites(
          '/repo/backend/src/kernel/container.ts',
          'for (const signal of signals) process.once(signal, handler);',
          'process',
        ),
      ),
      // The granularity itself, and the reason for the rewrite: without this
      // proof the per-site change is unevidenced.
      'unscoped-site-beside-a-scoped-one': top(unscopedSiteBesideAScopedOne),
      'file-level-site-beside-a-scoped-worker': top(unscopedProgramBesideAScopedWorker),
      // The ledger's second direction.
      'stale-ledger-entry': top(staleLedgerEntry),
    },
  },
  {
    script: 'backend/scripts/check-error-translations.ts',
    npmScript: 'check:error-translations',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-error-translations.test.ts',
    vacuousGuard: 'exit-2',
    // Its bundle half **is** a module walk (feature 080, T010). It used to be
    // marked otherwise on the ground that a residue "reads as 208 violations
    // rather than as a clean tree" — true, and the wrong half of the question:
    // loud is not the same as right, and those violations say "write nineteen
    // sentences" about sentences that already exist. The floor now reconciles
    // the walk against the modules the routing table names, so a residue exits
    // 2. The walk itself deliberately stays a listing of `src/modules` rather
    // than a resolution of the index — P2 asks whether every sentence written
    // *anywhere* is reachable, and a bundle left behind by a dropped
    // registration is exactly that question.
    readSize: 'reported',
    residueGuard: 'derived-population',
    // Two predicates, and the second (feature 082, D-127) has **no ledger** —
    // not an empty one. Every P2 repair is a JSON line moved or deleted plus at
    // most one routing line, so there is nothing a ledger could schedule. Four
    // candidate exceptions were tested and refuted in `rulings.md` § 7: a
    // planned re-route (one line, nothing to schedule), a deployment override
    // (measured impossible — the sanctioned lever is decorating
    // `adminI18nService`), two wordings for one code (impossible by
    // construction, the envelope reads one key), and a sentence written before
    // its code (refused by Principle II, which lands the contract first). If a
    // fifth is found, record it there and add the ledger then. Do not add one
    // here to make a build pass.
    red: {
      'missing-in-both-languages': top(
        () =>
          findUntranslatedErrorCodes({
            keys: { BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' } },
            readBundle: () => ({}),
            listBundleKeys: () => [],
          }).length,
      ),
      // "Both shipped languages" is the rule: an English-only sentence is still
      // a raw code for half the operators.
      'missing-in-one-language': top(
        () =>
          findUntranslatedErrorCodes({
            keys: { BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' } },
            readBundle: (_moduleId, language) =>
              language === 'en' ? { 'errors.BLOG_POST_NOT_FOUND': 'Post not found.' } : {},
            listBundleKeys: () => [],
          }).length,
      ),
      // P2's three kinds, one proof each, because four of a check's signals can
      // go blind behind the fifth's red (issue #130). Each enters at the top:
      // a routing table and a bundle walk in, findings out.
      'sentence-unreachable': top(
        () =>
          findUnreachableSentences(
            errorSentenceTree({ 'blog.en': { 'errors.BLOG_POST_NOT_FOUND': 'No such post.' } }),
          ).filter((f) => f.kind === 'unreachable').length,
      ),
      'sentence-duplicated': top(
        () =>
          findUnreachableSentences(
            errorSentenceTree({
              'cms.en': { 'errors.BLOG_POST_NOT_FOUND': 'No such post.' },
              'blog.en': { 'errors.BLOG_POST_NOT_FOUND': 'No such post.' },
            }),
          ).filter((f) => f.kind === 'duplicate').length,
      ),
      'sentence-names-no-code': top(
        () =>
          findUnreachableSentences(
            errorSentenceTree({ 'blog.en': { 'errors.COUPON_EXPIRED': 'It expired.' } }),
          ).filter((f) => f.kind === 'no-code').length,
      ),
      // The fourth fixture D-127 requires — a correctly-filed sentence, token
      // key included, yielding **zero** findings — cannot live here: a `red`
      // proof must come back non-zero. It is
      // `check-error-translations.test.ts`' "says nothing about a
      // correctly-filed sentence, token keys included", and it is what stops a
      // predicate that reports every `errors.*` key it sees from passing the
      // three above.
      //
      // T010's shape: a bundle walk that came back short of the modules the
      // routing table names. It is not a translation finding at all — it is the
      // refusal that has to fire *before* P1 turns a residue into nineteen
      // pieces of writing nobody needs to do.
      'bundle-residue': top(() => bundleResidueRefusal(['modules/catalog/i18n/en.json'])),
    },
  },
  {
    // Three axes, and a proof for each value of each: the shape the read reaches
    // the fallback through (two-step, inline, plain assignment), the **binding**
    // the read lands in (plain name, array pattern, object pattern,
    // destructuring assignment) and the fabrication the fallback performs
    // (string, `||` string, `randomUUID()`, number). None implies another — a
    // check that saw only `?? ''` after a `const` would have reported zero over
    // the `randomUUID()` site the first MR fixed, and one that saw every
    // fallback but only a plain-name binding reported zero over the two live
    // sites of issue #275. Zero reads exactly like a clean tree in both cases.
    // The dialect the read is written in is a fourth: `getKnex()` chains name
    // no read at the tail the walk was reading.
    //
    // The negatives are the companion test's, not this file's: an inventory
    // entry proves a check can still go red, and a proof that a check stays
    // green over honest source cannot do that.
    script: 'backend/scripts/check-fixture-substitution.ts',
    npmScript: 'check:fixture-substitution',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-fixture-substitution.test.ts',
    vacuousGuard: 'exit-2',
    // Walks `backend/test`, not `backend/src/modules`.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      // The block six files carried, letter for letter (issue #159).
      'two-step-string': top(() =>
        defaultedReads(
          'integration/carts/cart-abandonment-worker.integration.test.ts',
          [
            'const ch = await tmpEm.findOne(SalesChannel, { systemDefault: true });',
            "systemDefaultChannelId = ch?.id ?? '';",
          ].join('\n'),
        ),
      ),
      'inline-string': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          "const id = (await em.findOne(SalesChannel, { systemDefault: true }))?.id ?? '';",
        ),
      ),
      // A read bound by assignment rather than declaration — the shape a
      // `let` + `beforeAll` file writes, which is most of `test/`.
      'assigned-read': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          [
            'let rows;',
            "rows = await em.execute('select id from sales_channels');",
            "const id = rows[0]?.id ?? '';",
          ].join('\n'),
        ),
      ),
      'logical-or': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          [
            'const ch = await em.findOne(SalesChannel, {});',
            "const id = ch?.id || 'default';",
          ].join('\n'),
        ),
      ),
      // An id that satisfies the column type and matches no row: the test does
      // not fail, it stops measuring.
      'random-uuid': top(() =>
        defaultedReads(
          'integration/audit_logs/detached-from-admin-users.test.ts',
          [
            "const admins = await em.execute('select id from admin_users limit 1');",
            'const actorId = admins[0]?.id ?? randomUUID();',
          ].join('\n'),
        ),
      ),
      'numeric-fabrication': top(() =>
        defaultedReads(
          'contract/orders/external-intake.test.ts',
          [
            'const stockBefore = await em.findOne(StockLevel, { productId });',
            'const reservedBefore = stockBefore?.reserved ?? 0;',
          ].join('\n'),
        ),
      ),
      // Issue #275's five, and the first three are one axis the check did not
      // have: the **binding shape**. `const [channel] = await em.execute(…)`
      // bound no name, so the `??` under it was rooted in nothing and the file
      // reported clean for a year — the dialect was never the problem
      // (`execute` was in the vocabulary from the start) and the same
      // destructuring hid an ORM read just as completely, which is why the
      // object shape is proven separately from the array one.
      'array-destructured-read': top(() =>
        defaultedReads(
          'integration/dictionaries/reference-registry-consumers.test.ts',
          [
            'const [channel] = await em.execute(',
            '  `select "default_language" as code from "sales_channels"`,',
            ') as Array<{ code: string }>;',
            "const code = channel?.code ?? 'en-US';",
          ].join('\n'),
        ),
      ),
      'object-destructured-read': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          [
            'const { defaultCurrency } = (await em.findOne(SalesChannel, {})) as SalesChannel;',
            "const code = defaultCurrency ?? 'PLN';",
          ].join('\n'),
        ),
      ),
      // A `let` in the file body assigned inside a `beforeAll` — an expression
      // target rather than a binding name, and a separate code path from both.
      'destructuring-assignment': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          [
            'let channel;',
            "[channel] = await em.execute('select code from sales_channels');",
            "const code = channel?.code ?? 'en-US';",
          ].join('\n'),
        ),
      ),
      // The other two are the query-builder dialect, and they fail differently:
      // a chain whose **tail** names no read, and a chain that names no read
      // **anywhere** because its receiver is a bare identifier. A proof of the
      // first alone would stay green with the binding pass deleted.
      'builder-chain': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          [
            "const rows = await em.getKnex().select('*').from('sales_channels');",
            "const code = rows[0]?.code ?? 'en-US';",
          ].join('\n'),
        ),
      ),
      'bound-builder': top(() =>
        defaultedReads(
          'integration/x.test.ts',
          [
            'const knex = h.em().getConnection().getKnex();',
            "const rows = await knex('sales_channels').where('system_default', true);",
            "const code = rows[0]?.code ?? 'en-US';",
          ].join('\n'),
        ),
      ),
    },
  },
  {
    // Three spellings of one act, and each is a separate detector: the ORM
    // filter left empty, a `truncate`, and a `delete from` with no `where`. A
    // proof per spelling, because a check that kept seeing `nativeDelete(X, {})`
    // after its SQL reader broke would report the 26 ORM sites and none of the
    // 171 others — and would still print a number. The fourth proof is the
    // ratchet's second direction, which is the half a baseline check loses
    // silently: a file whose deletes were scoped keeps its number and the debt
    // stops describing anything.
    //
    // The negatives — a filtered delete, a `where`, the harness's own truncate —
    // are the companion test's; an inventory entry proves a check can go red.
    script: 'backend/scripts/check-shared-table-wipes.ts',
    npmScript: 'check:shared-table-wipes',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-shared-table-wipes.test.ts',
    vacuousGuard: 'exit-2',
    // Walks `backend/test`.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      // The block all eight comparison files carried (issue #166).
      'orm-empty-filter': top(() =>
        tableWipes(
          'contract/comparisons/public-pdf.contract.test.ts',
          [
            'beforeEach(async () => {',
            '  const em = h.em();',
            '  await em.nativeDelete(ComparisonProduct, {});',
            '  await em.nativeDelete(Comparison, {});',
            '});',
          ].join('\n'),
          'orm',
        ),
      ),
      'sql-truncate': top(() =>
        tableWipes(
          'integration/promotions/stats.test.ts',
          [
            'beforeEach(async () => {',
            "  await h.em().getConnection().execute('truncate table promotions cascade');",
            '});',
          ].join('\n'),
          'sql-truncate',
        ),
      ),
      'sql-delete-without-where': top(() =>
        tableWipes(
          'unit/dictionaries/label-resolver.test.ts',
          [
            'beforeAll(async () => {',
            '  await conn.execute(`delete from "dictionary_translations"`);',
            '});',
          ].join('\n'),
          'sql-delete',
        ),
      ),
      // The second direction: a baseline standing over a file that no longer
      // wipes anything is a debt already paid, and nothing else would say so.
      'baseline-drained': top(
        () =>
          checkSharedTableWipes(
            { sources: new Map([['integration/x.test.ts', 'const a = 1;']]) },
            { 'integration/x.test.ts': 1 },
          ).drained.length,
      ),
    },
  },
  {
    // Two stages, and a proof for every shape of each. The resource table is
    // five entries with two spellings for an ioredis client, so six release
    // proofs; the binding pass reads a handle three ways, and the two that do
    // not mention `setupBackendServer` get their own — a binding that narrows to
    // the assignment would report zero over every shared helper in `test/`, and
    // zero is what a clean tree looks like.
    script: 'backend/scripts/check-harness-teardown.ts',
    npmScript: 'check:harness-teardown',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-harness-teardown.test.ts',
    vacuousGuard: 'exit-2',
    // Walks `backend/test`.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'app-close': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          'const h = await setupBackendServer();\nawait h.app.close();\n',
          'app',
        ),
      ),
      'orm-close': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          'const h = await setupBackendServer();\nawait h.orm.close(true);\n',
          'orm',
        ),
      ),
      'redis-disconnect': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          'const h = await setupBackendServer();\nh.redis.disconnect();\n',
          'redis',
        ),
      ),
      // `quit` closes an ioredis client just as `disconnect` does; a table that
      // learned only the spelling the sweep happened to find would miss it.
      'redis-quit': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          'const h = await setupBackendServer();\nawait h.redis.quit();\n',
          'redis',
        ),
      ),
      // The client the hand-rolled block never disconnected — one abandoned
      // subscriber per composed server, for the length of a single-fork run.
      'redis-subscriber-disconnect': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          'const h = await setupBackendServer();\nh.redisSubscriber.disconnect();\n',
          'redisSubscriber',
        ),
      ),
      // The other one it never released: the awilix container holding every
      // composed module's singletons.
      'container-dispose': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          'const h = await setupBackendServer();\nawait h.container.dispose();\n',
          'container',
        ),
      ),
      'handle-from-variable-annotation': top(() =>
        handReleases(
          'contract/blog/admin-posts.contract.test.ts',
          `${HANDLE_DECLARED}await h.app.close();\n`,
          'app',
        ),
      ),
      'handle-from-parameter-annotation': top(() =>
        handReleases(
          'helpers/off-state.ts',
          'export async function stop(h: BackendServerHandle) { await h.app.close(); }\n',
          'app',
        ),
      ),
    },
  },
  {
    // Three independent rules in one script (A: ORM relations, B: platform-root
    // imports, C: the kernel's transitive closure), so three proofs. B and C are
    // deliberately not redundant — each covers the other's blind spot — and a
    // single proof would let either go dark behind the other's red.
    script: 'backend/scripts/check-kernel-boundary.ts',
    npmScript: 'check:kernel-boundary',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/boundary-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'rule-a-cross-module-relation': top(() =>
        relationViolations(CROSS_MODULE_RELATION, RELATION_TARGET_SOURCE),
      ),
      'rule-b-platform-import': top(
        () =>
          analyzePlatformImports(
            "import { blogService } from '../modules/blog/services/blog.service.js';\n",
            KERNEL_FILE,
            PLATFORM_ROOT,
          ).filter(isImportViolation).length,
      ),
      'rule-c-closure': top(() => {
        const sources: Record<string, string> = {
          [join(PLATFORM_ROOT, 'kernel/index.ts')]: "export { a } from './hop.js';\n",
          [join(PLATFORM_ROOT, 'kernel/hop.ts')]:
            "import { b } from '../modules/blog/services/blog.service.js';\n",
        };
        return analyzeClosure({
          roots: [join(PLATFORM_ROOT, 'kernel/index.ts')],
          read: (file) => sources[file] ?? null,
        }).violations.length;
      }),
    },
  },
  {
    // Eight specifier shapes, both nesting depths, the overlay tree, the two
    // halves of the ledger and the three ways a permanence claim goes wrong —
    // sixteen, and the last eight are not padding. The shape count is the reach
    // of the rule: a walker that stops seeing `import type` loses 43% of the
    // tree's 674 sites, and a normaliser that sees one nesting depth loses more
    // than half of what is left, silently, in both cases reporting a smaller
    // number rather than an error. The permanence proofs are the same property
    // one level up (D-77): the flag removes an entry from `ledger-size`, so a
    // check that stopped refusing an unjustified one would let the residue be
    // lowered by declaration.
    //
    // Nine more for the `sql` predicate (D-87), and its two owner-map passes are
    // the reason the schema enters as source text: an entity-only map resolves
    // 220 tables, misses every join table and every bridge, and reports 39 fewer
    // findings — a smaller number rather than an error, again.
    script: 'backend/scripts/check-module-boundary.ts',
    npmScript: 'check:module-boundary',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-module-boundary.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'value-import': top(() =>
        crossModuleKinds(ORDERS_READS_A_PRODUCT, ORDER_SERVICE_FILE, 'value-import'),
      ),
      // FR-003: erased at runtime, still an edge — and the shape ESLint's
      // `prefer: 'type-imports'` rewrites value imports into automatically.
      'type-only-import': top(() =>
        crossModuleKinds(
          "import type { CartService } from '../../carts/services/cart-service.js';",
          ORDER_SERVICE_FILE,
          'type-only-import',
        ),
      ),
      // A *value* import whose first specifier is typed: a classifier reading
      // the first token calls it type-only, one requiring every specifier to be
      // typed calls it a value import, and the kind records which was taken.
      'mixed-type-specifier': top(() =>
        crossModuleKinds(
          "import { type ProductId, Product } from '../../catalog/entities/product.entity.js';",
          ORDER_SERVICE_FILE,
          'mixed-type-specifier',
        ),
      ),
      'dynamic-import': top(() =>
        crossModuleKinds(
          'async reserve() { await import("../../inventory/services/reservation.js"); }',
          ORDER_SERVICE_FILE,
          'dynamic-import',
        ),
      ),
      're-export': top(() =>
        crossModuleKinds(
          "export { Product } from '../../catalog/entities/product.entity.js';",
          ORDER_SERVICE_FILE,
          're-export',
        ),
      ),
      'require-call': top(() =>
        crossModuleKinds(
          "const { Product } = require('../../catalog/entities/product.entity.js');",
          ORDER_SERVICE_FILE,
          'require-call',
        ),
      ),
      'import-type-node': top(() =>
        crossModuleKinds(
          "let p: import('../../catalog/entities/product.entity.js').Product;",
          ORDER_SERVICE_FILE,
          'import-type-node',
        ),
      ),
      'side-effect-import': top(() =>
        crossModuleKinds(
          "import '../../catalog/register.js';",
          ORDER_SERVICE_FILE,
          'side-effect-import',
        ),
      ),
      // A module that has become a package is still a module (feature 080).
      // !910 moved `blog` out of `backend/src/modules` and left this check's
      // "bare specifiers are ignored" premise standing: measured on that tree,
      // `organizations` importing the `BlogPost` entity as
      // `@endora-commerce/mod-blog/backend` left `reaches=25 violations=0`,
      // exactly the run without it. A ledgered edge rewritten into a package
      // specifier does not become legal, it becomes invisible — and the two-way
      // ledger then calls the entry describing it stale.
      'module-package-specifier': top(() =>
        crossModulePackageTargets(
          "import { BlogPost } from '@endora-commerce/mod-blog/backend';",
          ORDER_SERVICE_FILE,
          'blog',
        ),
      ),
      // D-171. T050 (!928) gave a module package a type-only `./ports` subpath
      // so a published port interface has a home, and this check went on
      // counting a reach into it exactly as it counts `<pkg>/backend` — so
      // publishing the interface gave it a supported name and did not retire the
      // consumer's ledger entry, which is what D-169 says the conversion
      // removes. A subpath is contract surface iff the module it resolves to
      // exports no runtime binding, derived from the artefact on every run.
      //
      // Three proofs and they are one discrimination: "no finding" cannot go red
      // on its own, so the first is paired with the second, which is the same
      // specifier and the same consumer one `const` of emitted JavaScript apart.
      'contract-surface-subpath-is-not-a-reach': top(() =>
        packagedReaches('@endora-commerce/mod-blog/ports', 'export {};\n') === 0 &&
        packagedReaches('@endora-commerce/mod-blog/backend', 'export {};\n') === 1
          ? 1
          : 0,
      ),
      'runtime-binding-on-a-subpath-counts-again': top(() =>
        packagedReaches('@endora-commerce/mod-blog/ports', "export const NAME = 'blogPort';\n"),
      ),
      // Issue #113's shape, in the one direction where a silence grants standing
      // instead of withholding it: a file the check cannot read must never
      // become an exemption. `./ports` is declared here and its emitted module
      // is absent, which is what an unbuilt `dist` looks like from inside.
      'unreadable-subpath-refuses': top(() => {
        try {
          packagedReaches('@endora-commerce/mod-blog/ports', null);
          return 0;
        } catch (error) {
          return error instanceof UnreadableSubpathError ? 1 : 0;
        }
      }),
      // The two nesting depths, each from the file position that produces it.
      // A prefix match satisfies one and not the other, and that is the
      // documented 2.2× undercount.
      'sibling-depth': top(() =>
        crossModuleTargets(
          "import { Product } from '../catalog/entities/product.entity.js';",
          'modules/blog/plugin.ts',
          'catalog',
        ),
      ),
      'nested-depth': top(() =>
        crossModuleTargets(
          "import { Product } from '../../catalog/entities/product.entity.js';",
          'modules/blog/services/blog-service.ts',
          'catalog',
        ),
      ),
      // An overlay module is an ordinary lifecycle participant (feature 057), so
      // the rule applies to its tree on the same terms.
      'overlay-module': top(() =>
        crossModuleTargets(
          "import { Loyalty } from '../../loyalty/services/loyalty-service.js';",
          'apps/example/modules/rewards/services/rewards-service.ts',
          'loyalty',
        ),
      ),
      // The ledger's two directions. Both take the source map *and* the shards,
      // because the ledger is only meaningful against findings the walk
      // produced: handing the comparison two ready-made sets would prove the
      // set difference and nothing above it.
      'unledgered-violation-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT) }, [
            { moduleId: 'orders', entries: { 'modules/orders/x.ts:catalog/y': 'another edge' } },
          ]).violations.length,
      ),
      'stale-shard-entry-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_NOTHING) }, [
            { moduleId: 'orders', entries: { [CROSS_MODULE_KEY]: 'cut long ago' } },
          ]).stale.length,
      ),
      // D-77's sixth failure mode. A permanent entry claims the edge is not
      // debt, which buys it out of `ledger-size`; the price is that it has to
      // name what *would* retire it, and the sweep is not an answer — an entry
      // claiming both permanence and "retired by the cut merge request" is
      // claiming nothing, and that is the shape misuse takes.
      'permanent-without-retiring-condition-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT) }, [
            {
              moduleId: 'orders',
              entries: {
                [CROSS_MODULE_KEY]: {
                  permanent: true,
                  reason: 'A foreign key makes the seam co-transactional.',
                  retiredBy: '',
                },
              },
            },
          ]).permanentIssues.length,
      ),
      'permanent-naming-the-sweep-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT) }, [
            {
              moduleId: 'orders',
              entries: {
                [CROSS_MODULE_KEY]: {
                  permanent: true,
                  reason: 'A foreign key makes the seam co-transactional.',
                  retiredBy: 'The orders cut merge request.',
                },
              },
            },
          ]).permanentIssues.length,
      ),
      // Issue #267's three. The key is `(file, target)`, so it answers "is this
      // file already known to reach that target" and not "how much": MR !793
      // added two `product_categories` statements to two files that each
      // already had an entry, `sql` rose 52 -> 54, and `violations` and `stale`
      // stayed 0. The fixture is a file that reaches one target **twice**, in
      // source text, because the walk that produces the number is the part
      // under test — handing the comparison a ready-made count would prove the
      // arithmetic and nothing above it.
      'entry-count-below-the-reaches-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT_TWICE) }, [
            { moduleId: 'orders', entries: { [CROSS_MODULE_KEY]: 'not yet cut, and it is one reach' } },
          ]).countIssues.length,
      ),
      // The stale direction one granularity down: a number left standing after
      // the reaches under it went. A count that could only ever rise would be
      // the one ledger in this tree that ratchets one way.
      'entry-count-above-the-reaches-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT_TWICE) }, [
            {
              moduleId: 'orders',
              entries: { [CROSS_MODULE_KEY]: { sites: 3, reason: 'not yet cut' } },
            },
          ]).countIssues.length,
      ),
      // The shard is imported at runtime, so `tsc` never sees the count either:
      // a `sites` that is not a positive integer reads as a recorded number and
      // can be compared with nothing.
      'non-positive-entry-count-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT_TWICE) }, [
            {
              moduleId: 'orders',
              entries: { [CROSS_MODULE_KEY]: { sites: 0, reason: 'not yet cut' } },
            },
          ]).countIssues.length,
      ),
      // A shard is loaded through a dynamic import, so `tsc` never sees it: a
      // mistyped flag would otherwise read as an object with no reason and be
      // accepted as ordinary debt.
      'malformed-shard-value-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT) }, [
            {
              moduleId: 'orders',
              entries: { [CROSS_MODULE_KEY]: { permanently: true } as never },
            },
          ]).permanentIssues.length,
      ),
      // Issue #217's own shape, and the one that makes the two proofs above
      // reachable at all: a shard typed `Readonly<Record<string, string>>`
      // cannot *hold* a permanent entry, so the rule they prove never runs over
      // it. The fixture is the shard's source text, because the declared type
      // exists nowhere else — the imported value has already lost it.
      'shard-declaring-its-own-entry-type-fails': top(
        () =>
          checkModuleBoundary({ sources: moduleBoundaryTree(ORDERS_READS_A_PRODUCT) }, [
            {
              moduleId: 'orders',
              entries: { [CROSS_MODULE_KEY]: 'not yet cut' },
              source: "export const entries: Readonly<Record<string, string>> = {};",
            },
          ]).shardShapeIssues.length,
      ),

      // --- the `sql` predicate (D-87) --------------------------------------
      //
      // Nine, and the last four are discriminations rather than counts: "no
      // finding" cannot go red on its own, so each carries a control the
      // predicate does have to see and returns 0 the moment a second finding
      // appears beside it. Every one enters as source text — including the
      // schema, so both owner-map passes run rather than being handed their
      // answer.
      'sql-select-foreign-table': top(
        () =>
          sqlBoundaryFindings(SQL_CONTROL).filter(
            (f) => f.predicate === 'sql' && f.table === 'products' && f.target === 'catalog',
          ).length,
      ),
      'sql-join-foreign-table': top(
        () =>
          sqlBoundaryFindings(
            'await conn.execute(`select p.id, a.url from blog_posts p join assets a on a.id = p.cover_id`);',
          ).filter((f) => f.table === 'assets').length,
      ),
      'sql-write-foreign-table': top(
        () =>
          sqlBoundaryFindings(
            'await conn.execute(`insert into "cms_blocks" ("id") values (?)`, [id]);',
            'modules/newsletter/services/consent-block-seeder.ts',
          ).filter((f) => f.direction === 'write' && f.target === 'cms').length,
      ),
      // The shape an entity-only owner map reports zero of: no entity class in
      // the tree declares `sales_channel_products`, and it is the cluster the
      // live defect (#174) sits in.
      'sql-bridge-table-owned-by-a-migration': top(
        () =>
          sqlBoundaryFindings(
            'await conn.execute(`select product_id from sales_channel_products where sales_channel_id = ?`, [id]);',
            'modules/catalog/services/catalog-query.service.ts',
          ).filter((f) => f.table === 'sales_channel_products' && f.target === 'kernel').length,
      ),
      'sql-template-with-substitution': top(
        () =>
          sqlBoundaryFindings(
            "await conn.execute(`select id from products where id in (${ids.map(() => '?').join(',')})`, ids);",
          ).filter((f) => f.table === 'products').length,
      ),
      'sql-own-table-is-not-a-finding': top(() =>
        sqlOnlyTheControl(`${SQL_CONTROL}\nawait conn.execute(\`select * from blog_posts\`);`),
      ),
      // The regex-over-source spike hallucinated a dozen tables off apostrophes
      // in English prose, because an apostrophe opens a string literal that runs
      // to the next one. The fixture enters as source text, so the *parser* is
      // what refuses it.
      'sql-in-a-comment-is-not-a-finding': top(() =>
        sqlOnlyTheControl(
          [
            '/* Historically this did `select id from products`, hence the port. */',
            "// It's the same read, and it's the one that couldn't stay: select id from products.",
            SQL_CONTROL,
          ].join('\n'),
        ),
      ),
      'sql-in-a-migration-is-not-a-finding': top(() => {
        const found = findCrossModuleSql({
          sources: new Map([
            [BLOG_SERVICE_FILE, SQL_CONTROL],
            ['modules/blog/migrations/20260810T101010_blog_thing.ts', 'this.addSql(`select id from products`);'],
          ]),
          schema: SQL_BOUNDARY_SCHEMA,
        }).found;
        return found.length === 1 && found[0]?.file === BLOG_SERVICE_FILE ? 1 : 0;
      }),
      'sql-unknown-table-is-not-a-finding': top(() =>
        sqlOnlyTheControl(
          `${SQL_CONTROL}\nawait conn.execute(\`select 1 from a_table_nobody_owns\`);`,
        ),
      ),
      // Feature 080, T034 — the third owner-map source. Without it a table an
      // installed package owns resolves to nobody and the reach is *not a
      // finding*, which is the silence `unattributed` is printed to make
      // visible, one layer out from where the printing reaches. The fixture
      // enters as source text plus the package's declared tables, so the
      // statement path and the owner map both run.
      'sql-package-table': top(
        () =>
          sqlPackageFindings(
            'await conn.execute(`select tag from fixture_widget_tags where widget_id = ?`, [id]);',
          ).filter((f) => f.table === 'fixture_widget_tags' && f.target === 'fixture_widgets')
            .length,
      ),
      // A package may not take a core table's attribution away from the module
      // that owns it — the same precedence the entity pass has over the
      // migration pass, for the same reason. The control is the only finding
      // when the package claims `products` as well.
      'package-does-not-take-a-core-table': top(() => {
        const found = sqlPackageFindings(SQL_CONTROL, [
          {
            table: 'products',
            moduleId: 'fixture_widgets',
            packageName: '@fixture/mod-widgets',
            source: 'entity',
          },
        ]);
        return found.length === 1 && found[0]?.target === 'catalog' ? 1 : 0;
      }),

      // --- the knex builder (issue #187) -----------------------------------
      //
      // A builder names its table as an argument to a call, so the statement
      // path has no statement to anchor on and the import predicate has no
      // specifier: seven cross-module accesses in five files stood outside a
      // `sql=111` that read as the whole coupling, which is the "violations=0
      // licenses a package split the tree has not earned" failure D-87 exists
      // to end. Six proofs, four positive and two discriminations, and every
      // one of them asserts `syntax: 'builder'` — a proof that only named the
      // table would go green off the statement path it is not testing (issue
      // #130). All six enter as source text, schema included.
      'sql-builder-knex-callable': top(
        () =>
          sqlBuilderFindings(`${KNEX_BINDING}\nawait knex('products').select('id');`).filter(
            (f) => f.table === 'products' && f.target === 'catalog',
          ).length,
      ),
      'sql-builder-from-literal': top(
        () =>
          sqlBuilderFindings("await em.getKnex().from('products').where('status', s);").filter(
            (f) => f.table === 'products' && f.target === 'catalog',
          ).length,
      ),
      'sql-builder-join-literal': top(
        () =>
          sqlBuilderFindings(
            `${KNEX_BINDING}\nawait knex('blog_posts as b').join('assets as a', 'a.id', 'b.cover_id');`,
          ).filter((f) => f.table === 'assets' && f.target === 'assets_library').length,
      ),
      // The bridge cluster, reached the second way. No entity class declares
      // `sales_channel_products`, so this is simultaneously the migration pass
      // of the owner map and the builder path — either going blind reads 0.
      'sql-builder-bridge-table-owned-by-a-migration': top(
        () =>
          sqlBuilderFindings(
            `${KNEX_BINDING}\nawait knex('sales_channel_products').where('sales_channel_id', id);`,
            'modules/catalog/services/catalog-query.service.ts',
          ).filter((f) => f.table === 'sales_channel_products' && f.target === 'kernel').length,
      ),
      // The two discriminations, each carrying the builder control in the same
      // fixture so it cannot pass by seeing nothing. The first is why the
      // method list is enumerated: `where`/`select`/`orderBy` take columns, and
      // a column spelled like another module's table is not a reach into it.
      'sql-builder-column-argument-is-not-a-finding': top(() =>
        sqlBuilderOnlyTheControl(
          `${KNEX_BINDING}\n${BUILDER_CONTROL}\n` +
            "await knex('blog_posts').select('cms_blocks').where('assets', true).orderBy('products');",
        ),
      ),
      // The flooding shape, measured: `isPresent('inventory')`,
      // `defineModuleManifest('catalog')` and `@Entity({ tableName: 'products' })`
      // put a table-shaped literal in 270 argument positions no builder reaches.
      'sql-builder-non-builder-call-is-not-a-finding': top(() =>
        sqlBuilderOnlyTheControl(
          `${KNEX_BINDING}\n${BUILDER_CONTROL}\n` +
            "if (!effectiveState.isPresent('assets')) return;\nconst label = translate('cms_blocks');",
        ),
      ),

      // --- the admin population (feature 091, FR-017) ----------------------
      //
      // 72 cross-module reaches stand inside `admin/src/modules` and every one
      // of them was outside every boundary instrument in this repository:
      // `moduleWalkRoots` does not include `admin/`. The cost is not that they
      // went unjudged — it is what happens when a directory moves into its
      // module's package, which is the shape
      // `specs/084-small-f4-package-layout/contracts/module-package-layout.md`
      // §0 measured on the backend: the specifier is rewritten, the reach
      // leaves the walk, and the two-way ledger calls the entry describing it
      // stale. Seven proofs, four positive and three discriminations, all
      // entering as source text and a path with the layout as the only
      // pre-computed input.
      'admin-alias-reach': top(() =>
        adminTargets(
          "import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';",
          'admin/src/modules/catalog/ProductEditor.tsx',
          'assets_library',
        ),
      ),
      // 27 of the 94 are written relatively rather than through the alias, and
      // an alias-only resolver would report them as third-party imports it
      // cleared.
      'admin-relative-reach': top(() =>
        adminTargets(
          "import { CountryPicker } from '../assets_library/components/CountryPicker.js';",
          'admin/src/modules/catalog/ProductEditor.tsx',
          'assets_library',
        ),
      ),
      // The directory name is not the module id. `AppShell.tsx` attributes
      // `/warehouses` to `module: 'inventory'`, so a `basename` attribution
      // files this reach under a module that does not exist — an orphan shard,
      // which reads as a ledger defect rather than as a mis-attribution.
      'admin-directory-that-is-not-a-module-id': top(() =>
        adminTargets(
          ADMIN_CONTROL,
          'admin/src/modules/warehouses/WarehouseEditor.tsx',
          'assets_library',
        ) === 1 &&
        adminReaches(ADMIN_CONTROL, 'admin/src/modules/warehouses/WarehouseEditor.tsx')[0]
          ?.moduleId === 'inventory'
          ? 1
          : 0,
      ),
      // A `.tsx` under the module root whose directory no route attributes is
      // the admin application's own, and its reaches are not a module's debt.
      // The control is in the same fixture, one directory over, so the proof
      // cannot pass by seeing nothing.
      'admin-host-owned-directory-is-not-a-module': top(() =>
        adminReaches(ADMIN_CONTROL, 'admin/src/modules/_shared/email-builder/Editor.tsx')
          .length === 0 &&
        adminReaches(ADMIN_CONTROL, 'admin/src/modules/catalog/ProductEditor.tsx').length === 1
          ? 1
          : 0,
      ),
      // The other direction of the same rule: a reach *into* a host-owned
      // directory is not a cross-module reach either, because there is no
      // module on the far side to ask for a port.
      'admin-reach-into-a-host-owned-directory-is-not-a-finding': top(() =>
        adminOnlyTheControl(
          `${ADMIN_CONTROL}\nimport { EmailBuilder } from '@/modules/_shared/email-builder';`,
          'admin/src/modules/catalog/ProductEditor.tsx',
        ),
      ),
      // In the backend the *directory* is the identity, so an overlay `catalog`
      // reaching the core `catalog` is the cross-tree edge it is. In the admin
      // one module owns two surface directories, and comparing directories
      // reports `inventory -> inventory` as a violation nobody can ledger.
      'admin-two-directories-of-one-module-is-not-a-finding': top(() =>
        adminOnlyTheControl(
          `${ADMIN_CONTROL}\nimport { Panel } from '@/modules/warehouses/ChannelMembershipPanel';`,
          'admin/src/modules/inventory/InventoryPage.tsx',
        ),
      ),
      // Issue #215 one frontend over, and the direction the coverage floor
      // cannot see: the floor is derived from the admin layout, so a layout
      // that resolved to nothing turns the floor off while every other number
      // holds. The ledger is the independent author — a `.tsx` key was written
      // by the merge request that recorded the reach — so its keys standing
      // against an absent layout is exit 2 rather than 72 stale entries.
      'admin-population-lost-refuses': top(() =>
        adminPopulationLost(
          null,
          ['admin/src/modules/catalog/ProductEditor.tsx:assets_library/components/AssetPicker'],
          () => true,
        ) === null
          ? 0
          : 1,
      ),
      // Its discrimination, in the same shape: a backend ledger key must not
      // trip the refusal, or every fixture tree in `test/helpers` would exit 2
      // for a reason that has nothing to do with the admin.
      'admin-population-lost-ignores-a-backend-key': top(() =>
        adminPopulationLost(null, [CROSS_MODULE_KEY], () => true) === null ? 1 : 0,
      ),
      // The second half of the anchor's question, and the one the split-tree
      // fixture found: it asks whether the *derivation* broke while the tree it
      // derives from stayed. A checkout with no `admin/` at all has genuinely
      // stale entries and the two-way ledger says so in its own words — so a
      // key whose file is gone must not turn that into exit 2, or every
      // synthetic backend copying the real ledger shards refuses for a reason
      // that has nothing to do with the module tree.
      'admin-population-lost-ignores-a-key-whose-file-is-gone': top(() =>
        adminPopulationLost(
          null,
          ['admin/src/modules/catalog/ProductEditor.tsx:assets_library/components/AssetPicker'],
          () => false,
        ) === null
          ? 1
          : 0,
      ),
    },
  },
  {
    // `compareArtifact` is the top of what this script analyses: the rendering
    // belongs to `generate-composer.ts`, which has its own tests, and the one
    // way a broken generator could reach this check silently — rendering
    // nothing, since two empty strings compare equal — is the third proof.
    //
    // The last three are the fourth verdict, `foreign` (feature 080 T030a,
    // D-155.6), and they need the other kind of fixture: determinism renders
    // the artefact twice and compares, so **two renders of a wrong generator
    // agree**. Measured on a tree carrying one symlinked vendor package under
    // `src/modules/`, with the leak regenerated into the committed registry:
    // all six artefacts reported deterministic, exit 0. The leak proof
    // therefore enters at the `SourceTree` and runs through the real generator,
    // as D-155.6 asks; the two discriminations enter at the same place the
    // containment pass does in a real run — a rendered artefact's text, with
    // the roots derived from this repository rather than handed in.
    //
    // Those two use **this** repository's roots, which is what makes them cheap
    // and what limits them: this checkout declares no module package and holds
    // no installed one, so the specifiers they classify are written here rather
    // than emitted. Since feature 080's T041a the generator *can* emit a bare
    // one (D-149), and the same discrimination is made over a fixture checkout
    // that holds a module in each of the three places one can be, with the
    // package model and the roots both derived from that checkout:
    // `test/unit/scripts/module-package-artefacts.test.ts`.
    script: 'backend/scripts/check-overlay-determinism.ts',
    npmScript: 'overlay:check',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-overlay-determinism.test.ts',
    // Both, since T030a: the byte comparison is a verdict its caller turns into
    // exit 1, and the containment floor — an artefact that contributed no
    // entry, a workspace derivation that named no package, an import line the
    // parser could not read — exits 2 on its own.
    vacuousGuard: 'exit-2',
    // Compares committed artefacts against a regenerated pair; a moved tree
    // makes them differ, which is the finding.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      stale: top(() => artifactVerdicts('rendered\n', () => 'stale\n', 'stale')),
      missing: top(() =>
        artifactVerdicts(
          'rendered\n',
          () => {
            throw new Error('ENOENT');
          },
          'missing',
        ),
      ),
      // Two empty strings compare equal, so a generator whose walk found nothing
      // would report every artefact deterministic and up to date.
      'empty-render': top(() => artifactVerdicts('', () => '', 'empty')),
      // A `SourceTree` holding a `node_modules/…` path, rendered by the real
      // generator: the leak D-141 and D-146 both aim at.
      foreign: top(() => renderedLeakFindings()),
      // The discrimination that matters, and the one that must not be got
      // backwards: a workspace member is committed with a bare specifier
      // (D-149) and is not foreign, while an installed package named the same
      // way is. Both in one fixture, so the proof cannot pass by seeing
      // nothing.
      'workspace-package-is-not-foreign': top(() => workspaceMemberOnlyTheControl()),
      // The other half of the same discrimination, and the one that keeps the
      // verdict usable: 586 of the 586 entries the committed artefacts carry
      // today are core-tree relative specifiers.
      'core-entry-is-not-foreign': top(() => coreEntryOnlyTheControl()),
      // The floor, entered on real examinations rather than a hand-built
      // record: an artefact that contributed no entry, over roots the
      // derivation itself produced.
      'vacuous-containment-population': top(() => containmentFloorRefusals()),
    },
  },
  {
    // The three ways a gated port is reached, from the check's own header: its
    // own name, a module-local `lazyPort` alias, and a deps-object key — the
    // last being 121 of the tree's ~130 `lazyPort` calls. The fourth proof is
    // D-63's derived `OWNER LOCKED`: the shape that has to stay refused is a
    // site resting on a lock **that has been withdrawn**, because a retirement
    // nothing can un-retire is exactly the stale "locked" reason the derivation
    // exists to avoid. Both halves enter at the top — source text plus the
    // manifests — so the derivation itself runs rather than a locked-id set the
    // fixture hands in.
    //
    // Every proof here enters at `checkPortCatches({ sources })`, which is the
    // top of the whole analysis: the alias table, the fixpoint, the scoping
    // rules, the `catch` classifier and the ledger comparison all run on the
    // fixture's own text. That is why issue #278's scoping change needed no
    // fixture repositioning — the existing proofs already sat above the thing it
    // moved, unlike `check-entry-scope`'s, which handed a pre-classified record
    // to the last function in the chain and so protected nothing (issue #130).
    script: 'backend/scripts/check-port-catches.ts',
    npmScript: 'check:port-catches',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-catch-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'port-own-name': top(() => checkPortCatches({ sources: PORT_CATCH_TREE }, {}).violations.length),
      'packaged-owner-registration': top(
        () =>
          checkPortCatches({ sources: PORT_CATCH_PACKAGED_OWNER_TREE }, {}).violations.length,
      ),
      'local-alias': top(
        () => checkPortCatches({ sources: PORT_CATCH_ALIAS_TREE }, {}).violations.length,
      ),
      'deps-object-key': top(
        () => checkPortCatches({ sources: PORT_CATCH_DEPS_TREE }, {}).violations.length,
      ),
      'lock-withdrawn': top(
        () =>
          checkPortCatches(
            { sources: PORT_CATCH_TREE, manifests: [PORT_CATCH_OWNER_UNLOCKED] },
            {},
          ).violations.length,
      ),
      'ledger-over-a-locked-owner': top(
        () =>
          checkPortCatches(
            { sources: PORT_CATCH_TREE, manifests: [PORT_CATCH_OWNER_LOCKED] },
            { 'modules/carts/services/cart-admin-service.ts:promotionService': 'stale now' },
          ).stale.length,
      ),
      // --- the one hop backwards (D-88) ------------------------------------
      //
      // Two shapes it now refuses and two it still must not follow. The last
      // two are discriminations: each tree carries the negative shape *and* the
      // same class's real hop as a control, so the proof reads 1 while the limit
      // holds and 0 the moment a second finding appears beside it.
      'method-hop-through-this': top(
        () =>
          checkPortCatches({ sources: PORT_CATCH_METHOD_HOP_TREE }, {}).violations.filter(
            (entry) => entry.port === 'settlePaid' && entry.gates.includes('promotionService'),
          ).length,
      ),
      'method-hop-transitively-through-the-class': top(
        () =>
          checkPortCatches({ sources: PORT_CATCH_TRANSITIVE_HOP_TREE }, {}).violations.filter(
            (entry) => entry.port === 'settlePaid' && entry.gates.includes('promotionService'),
          ).length,
      ),
      'free-function-in-another-file-is-not-followed': top(() => {
        const violations = checkPortCatches({ sources: PORT_CATCH_FREE_FUNCTION_TREE }, {})
          .violations;
        return violations.length === 1 && violations[0]?.port === 'settlePaid' ? 1 : 0;
      }),
      'own-method-shadows-a-module-alias': top(() => {
        const violations = checkPortCatches({ sources: PORT_CATCH_SHADOWED_METHOD_TREE }, {})
          .violations;
        return violations.length === 1 && violations[0]?.port === 'settlePaid' ? 1 : 0;
      }),
      // --- an alias is visible where its binding is (issue #278) ------------
      //
      // Three discriminations, and the third points the other way: it is the
      // shape that has to stay **red**, because a narrowing that reads "the
      // analysis cannot follow this" as "this is not a port" removes findings
      // instead of noise. Each tree carries its own control, so a proof reading
      // 0 says the check stopped seeing rather than started being precise.
      'parameter-alias-does-not-escape-its-declaring-file': top(() => {
        const violations = checkPortCatches({ sources: PORT_CATCH_PARAMETER_SCOPE_TREE }, {})
          .violations;
        return violations.length === 1 &&
          violations[0]?.file === 'modules/carts/services/cart-pricing.ts'
          ? 1
          : 0;
      }),
      'local-that-manifestly-holds-no-port-shadows-a-module-alias': top(() => {
        const violations = checkPortCatches({ sources: PORT_CATCH_LOCAL_SHADOW_TREE }, {})
          .violations;
        return violations.length === 1 &&
          violations[0]?.file === 'modules/carts/services/cart-bulk.ts'
          ? 1
          : 0;
      }),
      'local-bound-to-a-call-shadows-nothing': top(() => {
        const violations = checkPortCatches({ sources: PORT_CATCH_CALL_BOUND_LOCAL_TREE }, {})
          .violations;
        return violations.length === 1 && violations[0]?.port === 'customFields' ? 1 : 0;
      }),
    },
  },
  {
    // Ten analyses in one script, and each of the five rules below is fed here
    // by the **scanner** rather than by a hand-built list (issue #130). The
    // blindness this check has actually suffered was in `resolvedNames`: a
    // `port(ctx, name)` helper hid fourteen resolutions, several registered by
    // nobody; a module-local cradle alias hid ninety-eight more; and
    // `const { a, b } = cradle()` — the two shapes above written together — hid
    // `catalog`'s asset-reference boot hook until issue #127. Every proof here
    // therefore starts from source text.
    //
    // Three of the rules had no proof at all until issue #134, and two of them
    // were a week old and load-bearing: `findNonBindingIssues` carries D-44's
    // guard-rails on `contributes-to`, and `importedContributionSeams` is the
    // only reason `gatewayRefundRegistry`'s policy requirement bites — the
    // payment gateways reach that registry by importing the singleton, which no
    // container scan sees.
    script: 'backend/scripts/check-port-dependencies.ts',
    npmScript: 'check:port-dependencies',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-dependency-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'undeclared-dependency': top(() =>
        portViolations(ORDERS_RESOLVES_AT_CALL, PAYMENT_PORTS, 'undeclared-dependency'),
      ),
      'unowned-name': top(() =>
        portViolations(ORDERS_RESOLVES_UNOWNED, PAYMENT_PORTS, 'unowned-name'),
      ),
      // Feature 080, T034. The same resolution, against a map that knows an
      // installed package owns the name: it stops being `unowned-name` — a
      // wiring bug in the consumer — and becomes the undeclared edge it is. The
      // fixture is the consumer's source text plus the owner map, so the
      // resolution scanner runs; what fills the map from a package tree on disk
      // is proven in `package-declarations.test.ts`.
      'package-owned-name-is-an-edge-not-a-wiring-bug': top(() => {
        const owners = new Map([
          ...PAYMENT_PORTS,
          ['nobodyRegistersThis', 'fixture_widgets'] as const,
        ]);
        const kinds = findViolations({
          resolutions: ordersResolutions(ORDERS_RESOLVES_UNOWNED),
          owners,
          dependencies: new Map([['orders', []]]),
          providedPorts: PAYMENT_PORTS,
        }).map((violation) => violation.kind);
        return kinds.length === 1 && kinds[0] === 'undeclared-dependency' ? 1 : 0;
      }),
      'captured-name': top(() => portViolations(ORDERS_CAPTURES, PAYMENT_PORTS, 'captured-name')),
      'gated-port-before-first-request': top(() =>
        portViolations(ORDERS_RESOLVES_AT_BOOT, PAYMENT_PORTS, 'gated-port-at-boot'),
      ),
      'deactivation-ledger-unassigned': top(
        () =>
          buildDeactivationLedger({
            reads: ledgerReads({
              resolutions: ordersResolutions(ORDERS_CAPTURES),
              seams: [],
              owners: PAYMENT_PORTS,
              providedPorts: PAYMENT_PORTS,
            }),
            declaredDependencies: new Map(),
            nonBinding: [],
            neverAbsentOwners: new Set(),
            acknowledged: [],
            contributionPolicies: {},
            excludedNames: new Set(),
          }).unassigned.length,
      ),
      // `findRootIssues` — the three ways a composition root breaks a port with
      // every module correct. Each fixture names only its own shape: the
      // shadowing root registers nothing the host table mentions, and the two
      // host-table shapes register no module port.
      'root-shadows-module-port': top(
        () =>
          rootIssues({
            roots: { production: ROOT_SHADOWS_THE_PORT, harness: ROOT_REGISTERS_NOTHING },
            moduleSource: PAYMENTS_BACKEND,
            hostRegistered: {},
            consumerSource: ORDERS_RESOLVES_AT_CALL,
          }).filter((issue) => issue.kind === 'root-shadows-module-port').length,
      ),
      'root-supplies-nothing': top(
        () =>
          rootIssues({
            roots: { production: ROOT_REGISTERS_NOTHING, harness: ROOT_REGISTERS_NOTHING },
            moduleSource: '',
            hostRegistered: { ordersAdminScopeResolver: 'auth' },
            consumerSource: ORDERS_RESOLVES_THE_BRIDGE,
          }).filter((issue) => issue.kind === 'root-supplies-nothing').length,
      ),
      'root-divergence': top(
        () =>
          rootIssues({
            roots: { production: ROOT_REGISTERS_NOTHING, harness: ROOT_SUPPLIES_THE_BRIDGE },
            moduleSource: '',
            hostRegistered: { ordersAdminScopeResolver: 'auth' },
            consumerSource: ORDERS_RESOLVES_THE_BRIDGE,
          }).filter((issue) => issue.kind === 'root-divergence').length,
      ),
      // The same function over `PLATFORM_OWNED_NAMES` (issue #49, D-73). Four
      // shapes, four fixtures, and each names only its own: the unsupplied one
      // is registered nowhere, the divergent one by a single root, the
      // module-owned one by a module's `backend.ts`, and the stale one by
      // nothing at all with nothing resolving it either. One proof each,
      // because a list whose consequences were asserted and never verified is
      // what this ruling is about, and three signals going blind behind a
      // fourth's red would reproduce it one level down.
      'platform-name-unsupplied': top(
        () =>
          rootIssues({
            roots: { production: ROOT_REGISTERS_NOTHING, harness: ROOT_REGISTERS_NOTHING },
            moduleSource: '',
            hostRegistered: {},
            consumerSource: ORDERS_RESOLVES_THE_PLATFORM_NAME,
            platformNames: [PLATFORM_NAME],
            kernelSource: KERNEL_REGISTERS_SOMETHING_ELSE,
          }).filter((issue) => issue.kind === 'platform-name-unsupplied').length,
      ),
      'platform-name-divergence': top(
        () =>
          rootIssues({
            roots: {
              production: ROOT_REGISTERS_NOTHING,
              harness: ROOT_SUPPLIES_THE_PLATFORM_NAME,
            },
            moduleSource: '',
            hostRegistered: {},
            consumerSource: ORDERS_RESOLVES_THE_PLATFORM_NAME,
            platformNames: [PLATFORM_NAME],
            kernelSource: KERNEL_REGISTERS_SOMETHING_ELSE,
          }).filter((issue) => issue.kind === 'platform-name-divergence').length,
      ),
      'platform-name-owned-by-module': top(
        () =>
          rootIssues({
            roots: {
              production: ROOT_SUPPLIES_THE_PLATFORM_NAME,
              harness: ROOT_SUPPLIES_THE_PLATFORM_NAME,
            },
            moduleSource: '',
            hostRegistered: {},
            consumerSource: ORDERS_RESOLVES_THE_PLATFORM_NAME,
            platformNames: [PLATFORM_NAME],
            kernelSource: KERNEL_REGISTERS_SOMETHING_ELSE,
            // Both roots register it and something resolves it, so neither of
            // the two shapes above applies: only the ownership scan can find
            // this one, which is what makes it its own proof.
            ownerSource: MODULE_OWNS_THE_PLATFORM_NAME,
          }).filter((issue) => issue.kind === 'platform-name-owned-by-module').length,
      ),
      'platform-name-stale': top(
        () =>
          rootIssues({
            roots: { production: ROOT_REGISTERS_NOTHING, harness: ROOT_REGISTERS_NOTHING },
            moduleSource: '',
            hostRegistered: {},
            // Nothing resolves the platform name — which is the whole
            // difference between `stale` and `unsupplied`, and the reason the
            // consumer fixture here reads a different name.
            consumerSource: ORDERS_RESOLVES_THE_BRIDGE,
            platformNames: [PLATFORM_NAME],
            kernelSource: KERNEL_REGISTERS_SOMETHING_ELSE,
          }).filter((issue) => issue.kind === 'platform-name-stale').length,
      ),
      // `findNonBindingIssues` — D-44's five. The first two hold every kind of
      // entry to the tree; the last three are the guard-rails `contributes-to`
      // rests on, so each of those fixtures satisfies the other two guard-rails
      // and trips only its own.
      'non-binding-wrong-owner': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'assets_library',
              name: 'promptActionToolRegistry',
              kind: 'degrades-without',
              whenAbsent: 'The assistant offers no catalog tools.',
              reason: 'Declaring it would make an optional assistant bind the operator.',
            },
            ownerSource: PROMPT_ACTIONS_REGISTERS,
            consumerSource: CATALOG_READS_AT_CALL,
            policies: {},
          }).filter((issue) => issue.kind === 'wrong-owner').length,
      ),
      'non-binding-nothing-resolves': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'degrades-without',
              whenAbsent: 'The assistant offers no catalog tools.',
              reason: 'Declaring it would make an optional assistant bind the operator.',
            },
            ownerSource: PROMPT_ACTIONS_REGISTERS,
            consumerSource: 'export function registerModule(ctx: ModuleContext): void {}',
            policies: {},
          }).filter((issue) => issue.kind === 'nothing-resolves').length,
      ),
      'contribution-over-a-gated-port': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'contributes-to',
              reason: 'A push of inert descriptors the host filters at enumeration.',
            },
            ownerSource: PROMPT_ACTIONS_PROVIDES_A_PORT,
            consumerSource: CATALOG_PUSHES_AT_BOOT,
            policies: { 'prompt_actions:promptActionToolRegistry': 'skip' },
          }).filter((issue) => issue.kind === 'contribution-over-a-gated-port').length,
      ),
      'contribution-registry-without-policy': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'contributes-to',
              reason: 'A push of inert descriptors the host filters at enumeration.',
            },
            ownerSource: PROMPT_ACTIONS_REGISTERS,
            consumerSource: CATALOG_PUSHES_AT_BOOT,
            policies: {},
          }).filter((issue) => issue.kind === 'contribution-registry-without-policy').length,
      ),
      'contribution-not-pushed-at-boot': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'contributes-to',
              reason: 'A push of inert descriptors the host filters at enumeration.',
            },
            ownerSource: PROMPT_ACTIONS_REGISTERS,
            consumerSource: CATALOG_READS_AT_CALL,
            policies: { 'prompt_actions:promptActionToolRegistry': 'skip' },
          }).filter((issue) => issue.kind === 'contribution-not-pushed-at-boot').length,
      ),
      // The mirror rail, on `refuses-without` (owner ruling, 2026-08-25). The
      // kind claims two things — the operation refuses, and the owner's
      // control keeps working — and each fixture is the *accepted* declaration
      // with exactly one of them falsified, because both signals are absences
      // and a fixture that satisfied neither could not say which it caught.
      'refusal-over-an-ungated-name': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'refuses-without',
              whenAbsent: 'the assistant answers nothing at all',
              reason: 'The tool call has no fallback and lets the refusal reach the caller.',
            },
            // A plain `ctx.di.register`, so there is no gate and nothing to
            // refuse — the exact mirror of `contribution-over-a-gated-port`.
            ownerSource: PROMPT_ACTIONS_REGISTERS,
            consumerSource: CATALOG_READS_AT_CALL,
            policies: {},
          }).filter((issue) => issue.kind === 'refusal-over-an-ungated-name').length,
      ),
      'refusal-over-a-bound-owner': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'refuses-without',
              whenAbsent: 'the assistant answers nothing at all',
              reason: 'The tool call has no fallback and lets the refusal reach the caller.',
            },
            ownerSource: PROMPT_ACTIONS_PROVIDES_A_PORT,
            consumerSource: CATALOG_READS_AT_CALL,
            policies: {},
            // The bind the entry denies. `defineModuleManifest` refuses this
            // manifest outright, so the fixture takes the other route into a
            // composition — see the note above `nonBindingIssues`.
            dependencies: ['prompt_actions'],
            unhelped: true,
          }).filter((issue) => issue.kind === 'refusal-over-a-bound-owner').length,
      ),
      'refusal-without-a-sentence': top(
        () =>
          nonBindingIssues({
            edge: {
              moduleId: 'prompt_actions',
              name: 'promptActionToolRegistry',
              kind: 'refuses-without',
              reason: 'The tool call has no fallback and lets the refusal reach the caller.',
            },
            ownerSource: PROMPT_ACTIONS_PROVIDES_A_PORT,
            consumerSource: CATALOG_READS_AT_CALL,
            policies: {},
            unhelped: true,
          }).filter((issue) => issue.kind === 'refusal-without-a-sentence').length,
      ),
      // `importedContributionSeams` — the two spellings of a push into an
      // imported singleton, each in its own fixture so neither can go blind
      // behind the other's red.
      'imported-seam-register': top(() => importedSeamShapes(STRIPE_PUSHES)),
      'imported-seam-unregister': top(() => importedSeamShapes(STRIPE_WITHDRAWS)),
    },
  },
  {
    // Six shapes over one population, and the fixture for every one of them is
    // **barrel source text plus module source text plus a file list** — the
    // three inputs a real run hands the analysis. Nothing here is pre-computed:
    // the published surface is derived from the barrel by the same parse
    // `published-surface.test.ts` uses, the module attribution is read off the
    // key, and the specifier is resolved through the `.js` to `.ts` rewrite. A
    // proof handed a ready-made "these symbols are published" set would leave
    // all three unproven, and the first of them is where a wrong answer would
    // be *quiet*: a short published set turns correct reaches into findings,
    // whose obvious repair is to widen the barrel.
    //
    // `unpublished-symbol` is the rule. `whole-file-reach` is the shape a
    // symbol-level verdict cannot see — a namespace or side-effect import names
    // no symbol, so it reaches the file's internals whatever they are. The last
    // two are #215 one layer in (!879): a specifier that resolves to nothing and
    // a walked file no module owns are both files the `read:` line counts and
    // nothing judges, so each is a finding rather than a skip. The ledger gets
    // both directions of its own — a key describing no reach, and a symbol an
    // entry names that the walk no longer sees — because the second is the one a
    // per-target count could not express: swapping one unpublished name for
    // another leaves the key and the site total unchanged.
    script: 'backend/scripts/check-platform-surface.ts',
    npmScript: 'check:platform-surface',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-platform-surface.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'unpublished-symbol': top(() =>
        platformSurfaceFindings(
          {
            'backend/src/modules/blog/backend.ts':
              "import { SettingsCache } from '../../kernel/settings/settings-cache.js';",
          },
          'unpublished-symbol',
        ),
      ),
      'whole-file-reach': top(() =>
        platformSurfaceFindings(
          {
            'backend/src/modules/blog/backend.ts':
              "import * as cache from '../../kernel/settings/settings-cache.js';",
          },
          'whole-file-reach',
        ),
      ),
      'unresolvable-reach': top(() =>
        platformSurfaceFindings(
          { 'backend/src/modules/blog/backend.ts': "import { X } from '../../kernel/gone.js';" },
          'unresolvable-reach',
        ),
      ),
      'unattributed-source': top(() =>
        platformSurfaceFindings(
          { 'backend/src/apps/example/reduced-deployment.ts': '' },
          'unattributed-source',
        ),
      ),
      // T060 — the shape a packaged module writes. The fixture is a package's
      // own source text naming the host by its bare specifier, which is the
      // only spelling a module outside the application tree has: the population
      // this proof stands over is the one the sweep moves, one module at a time.
      'unpublished-subpath': top(() =>
        platformSurfaceFindings(
          {
            'packages/modules/blog/src/backend.ts':
              "import { SettingsCache } from '@endora-commerce/platform/kernel/settings/settings-cache.js';",
          },
          'unpublished-subpath',
        ),
      ),
      'stale-ledger-key': top(
        () =>
          checkPlatformSurface(platformSurfaceInput({}), {
            'backend/src/modules/blog/backend.ts|backend/src/db/index.ts': { symbols: ['initOrm'], reason: 'gone' },
          }).staleKeys.length,
      ),
      'stale-ledger-symbol': top(
        () =>
          checkPlatformSurface(
            platformSurfaceInput({
              'backend/src/modules/blog/backend.ts': "import { initOrm } from '../../db/index.js';",
            }),
            {
              'backend/src/modules/blog/backend.ts|backend/src/db/index.ts': {
                symbols: ['initOrm', 'closeOrm'],
                reason: 'one of these is gone',
              },
            },
          ).staleSymbols.length,
      ),
      'unreadable-barrel': top(() =>
        platformSurfaceRefusal({
          missingBarrels: [],
          surface: publishedSurface(new Map([['backend/src/events/index.ts', "export * from './bus.js';"]])),
        }) === null
          ? 0
          : 1,
      ),
      'missing-barrel': top(() =>
        platformSurfaceRefusal({
          missingBarrels: ['backend/src/tenancy/index.ts'],
          surface: publishedSurface(new Map()),
        }) === null
          ? 0
          : 1,
      ),
    },
  },
  {
    // Three signals, eight shapes.
    //
    // Signal 1 (D-97.3) bites in two places and only one of them was ever hit:
    // the published port, and an interface a consumer widens it with.
    //
    // Signal 2 (issue #192) is the container name, and its two shapes are not
    // interchangeable: an unregistered name fails loudly at first call, a name
    // that resolves to the ungated twin does not fail at all. The second proof
    // asserts `documentedRegistrationKind: 'plain'` rather than just the kind,
    // because "the doc points at a registration with no gate on it" is the whole
    // finding — a proof that only counted it would stay green if the check
    // stopped telling a plain registration from a gated one.
    //
    // The fifth is the ledger's second direction. `PORTS_WITHOUT_A_REGISTRATION`
    // is empty since D-98.5 and is not a queue; a two-way ratchet whose stale
    // half nothing proves is a list that quietly outlives its reason, and an
    // empty ledger is exactly where that goes unnoticed — the proof hands the
    // check a ledger of its own rather than the shipped one.
    //
    // Signal 3 (issue #196, D-98.2) is the **other direction** of signal 2's
    // edge — consumer resolution → publication rather than doc → registration —
    // and it needs three proofs because two of the three things it does are
    // discriminations rather than findings. `resolution-of-unpublished-name` is
    // the finding. `resolution-discrimination` is the one that keeps the signal
    // honest: it hands the check a **cradle** read and a `lazyPort` literal over
    // the same unpublished name in the same source and asserts exactly one
    // finding, so the check cannot pass by declining both — four of the five
    // names the two population methods disagree on are cradle reads, and
    // excluding that path silently is how a signal goes half-missing. And
    // `stale-unpublished-resolution` is the resolution ledger's second
    // direction, handed a ledger of its own for the same reason the fifth proof
    // is.
    //
    // Each fixture enters as source text — a pre-parsed member list, or a
    // registration map handed in already built, would prove the reporter and not
    // the sweep that has to find the port and the registration in the first
    // place.
    script: 'backend/scripts/check-port-shape.ts',
    npmScript: 'check:port-shape',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-shape-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'optional-method-on-port': top(
        () =>
          checkPortShape({
            contracts: new Map([
              [
                'contracts/custom-fields.ts',
                [
                  '/** Container name: `customFieldDefinitionReadPort`. */',
                  'export interface CustomFieldDefinitionReadPort {',
                  '  listForEntity(entityType: string): Promise<unknown[]>;',
                  '  publishInvalidate?(entityType: string): Promise<void>;',
                  '}',
                ].join('\n'),
              ],
            ]),
            modules: new Map(),
          }).findings.filter((f) => f.kind === 'optional-method-on-port').length,
      ),
      'optional-method-on-port-extension': top(
        () =>
          checkPortShape({
            contracts: new Map([
              [
                'contracts/custom-fields.ts',
                [
                  '/** Container name: `customFieldDefinitionReadPort`. */',
                  'export interface CustomFieldDefinitionReadPort {',
                  '  listForEntity(entityType: string): Promise<unknown[]>;',
                  '}',
                ].join('\n'),
              ],
            ]),
            modules: new Map([
              [
                'modules/catalog/services/catalog-attribute-read.service.ts',
                [
                  'export interface AttributeDefinitionSource extends CustomFieldDefinitionReadPort {',
                  "  publishInvalidate?(entityType: 'product'): Promise<void>;",
                  '}',
                ].join('\n'),
              ],
            ]),
          }).findings.filter((f) => f.kind === 'optional-method-on-port-extension').length,
      ),
      'container-name-unregistered': top(
        () =>
          checkPortShape({
            contracts: new Map([['contracts/admin-users.ts', PORT_DOC('impersonationService')]]),
            modules: new Map([
              [
                'modules/admin_users/backend.ts',
                "ctx.di.providePort('somethingElse', ctx.asFunction(f).singleton());",
              ],
            ]),
            unregisteredLedger: {},
          }).nameFindings.filter((f) => f.kind === 'container-name-unregistered').length,
      ),
      'container-name-not-the-gated-registration': top(
        () =>
          checkPortShape({
            contracts: new Map([['contracts/admin-roles.ts', PORT_DOC('adminRoleService')]]),
            modules: new Map([
              [
                'modules/admin_roles/backend.ts',
                [
                  'ctx.di.register({ adminRoleService: ctx.asFunction(f).singleton() });',
                  "ctx.di.providePort<PublishedPort>('adminRolePort', ctx.asFunction(g).singleton());",
                ].join('\n'),
              ],
            ]),
            unregisteredLedger: {},
          }).nameFindings.filter(
            (f) =>
              f.kind === 'container-name-not-the-gated-registration' &&
              f.documentedRegistrationKind === 'plain',
          ).length,
      ),
      'stale-unregistered-ledger-entry': top(
        () =>
          checkPortShape({
            contracts: new Map([['contracts/admin-roles.ts', PORT_DOC('adminRolePort')]]),
            modules: new Map([
              [
                'modules/admin_roles/backend.ts',
                "ctx.di.providePort<PublishedPort>('adminRolePort', ctx.asFunction(g).singleton());",
              ],
            ]),
            unregisteredLedger: { PublishedPort: 'no provider, pending a ruling' },
          }).staleLedgerEntries.length,
      ),
      'resolution-of-unpublished-name': top(
        () =>
          checkPortShape({
            contracts: new Map([
              ['contracts/admin-notifications.ts', PORT_DOC('adminNotificationRecordPort')],
            ]),
            modules: new Map([
              [
                'modules/admin_notifications/backend.ts',
                "ctx.di.providePort('adminNotificationService', ctx.asFunction(f).singleton());",
              ],
              [
                'modules/product_feeds/backend.ts',
                "const bell = lazyPort<Port>(ctx, 'adminNotificationService');",
              ],
            ]),
            unregisteredLedger: {},
            unpublishedResolutionLedger: {},
          }).unpublishedResolutions.filter((f) => f.kind === 'resolution-of-unpublished-name')
            .length,
      ),
      // The discrimination, counted as a finding so it can go red on its own:
      // one source, one name, both shapes. A check that stopped telling a
      // cradle read from a `lazyPort` literal reports 2 here and fails, and one
      // that stopped seeing `lazyPort` at all reports 0 and fails too.
      'resolution-discrimination': top(() => {
        const findings = checkPortShape({
          contracts: new Map([
            ['contracts/admin-notifications.ts', PORT_DOC('adminNotificationRecordPort')],
          ]),
          modules: new Map([
            [
              'modules/admin_notifications/backend.ts',
              "ctx.di.providePort('adminNotificationService', ctx.asFunction(f).singleton());",
            ],
            [
              'modules/product_feeds/backend.ts',
              [
                'const { adminNotificationService } = ctx.cradle<ProductFeedsCradle>();',
                "const copied = lazyPort<Port>(ctx, 'adminNotificationService');",
              ].join('\n'),
            ],
          ]),
          unregisteredLedger: {},
          unpublishedResolutionLedger: {},
        }).unpublishedResolutions;
        return findings.length === 1 && findings[0]?.line === 2 ? 1 : 0;
      }),
      // D-171.1 — the condition. `payments` registers `orders`' interface with
      // an explicitly typed `providePort<T>` and names it at no `implements`
      // clause, so nothing in the language relates the two types: that is
      // D-77's rejected alternative, and it is what the amendment refuses.
      // Source text on both sides, so the declaration has to be found in the
      // module's own `ports/` and the registration in its `backend.ts`.
      'declared-elsewhere-without-implements': top(
        () =>
          checkPortShape({
            contracts: new Map([['contracts/orders.ts', PORT_DOC('orderReadPort')]]),
            modules: new Map([
              [
                'modules/payments/backend.ts',
                "ctx.di.providePort<PaymentPlacementApplyPort>('paymentPlacementApplyPort', " +
                  'ctx.asFunction(f).singleton());',
              ],
              [
                'modules/payments/services/payment-placement-apply-port.ts',
                [
                  'export class PaymentPlacementApplyService {',
                  '  openForOrder(em: EntityManager): Promise<void> {}',
                  '}',
                ].join('\n'),
              ],
            ]),
            modulePorts: new Map([
              [
                'modules/orders/ports/index.ts',
                [
                  '/**',
                  ' * Container name: `paymentPlacementApplyPort`. Owner: `payments`.',
                  ' */',
                  'export interface PaymentPlacementApplyPort {',
                  '  openForOrder(em: EntityManager): Promise<void>;',
                  '}',
                ].join('\n'),
              ],
            ]),
            unregisteredLedger: {},
            unpublishedResolutionLedger: {},
          }).declaredElsewhere.filter((f) => f.kind === 'declared-elsewhere-without-implements')
            .length,
      ),
      // The discrimination, counted as a finding so it can go red on its own:
      // the same declaration and the same registration, with the `implements`
      // clause present, must be silent. A signal that reported every
      // cross-module registration would fire here; one that had stopped reading
      // module ports at all would report 0 above and 0 here, and only this
      // pair tells the two apart.
      'declared-elsewhere-discrimination': top(() => {
        const declaration = new Map([
          [
            'modules/orders/ports/index.ts',
            [
              '/**',
              ' * Container name: `paymentPlacementApplyPort`. Owner: `payments`.',
              ' */',
              'export interface PaymentPlacementApplyPort {',
              '  openForOrder(em: EntityManager): Promise<void>;',
              '}',
            ].join('\n'),
          ],
        ]);
        const registration =
          "ctx.di.providePort<PaymentPlacementApplyPort>('paymentPlacementApplyPort', " +
          'ctx.asFunction(f).singleton());';
        const implementing = [
          'export class PaymentPlacementApplyService implements PaymentPlacementApplyPort {',
          '  openForOrder(em: EntityManager): Promise<void> {}',
          '}',
        ].join('\n');
        const run = (service: string): number =>
          checkPortShape({
            contracts: new Map([['contracts/orders.ts', PORT_DOC('orderReadPort')]]),
            modules: new Map([
              ['modules/payments/backend.ts', registration],
              ['modules/payments/services/payment-placement-apply-port.ts', service],
            ]),
            modulePorts: declaration,
            unregisteredLedger: {},
            unpublishedResolutionLedger: {},
          }).declaredElsewhere.length;
        const withoutClause = [
          'export class PaymentPlacementApplyService {',
          '  openForOrder(em: EntityManager): Promise<void> {}',
          '}',
        ].join('\n');
        return run(implementing) === 0 && run(withoutClause) === 1 ? 1 : 0;
      }),
      'stale-unpublished-resolution': top(
        () =>
          checkPortShape({
            contracts: new Map([
              ['contracts/admin-notifications.ts', PORT_DOC('adminNotificationRecordPort')],
            ]),
            modules: new Map([
              [
                'modules/admin_notifications/backend.ts',
                "ctx.di.providePort('adminNotificationService', ctx.asFunction(f).singleton());",
              ],
              [
                'modules/product_feeds/backend.ts',
                "const bell = lazyPort<Port>(ctx, 'adminNotificationRecordPort');",
              ],
            ]),
            unregisteredLedger: {},
            unpublishedResolutionLedger: {
              'product_feeds:adminNotificationService': 'deferred, pending the cut',
            },
          }).staleUnpublishedResolutions.length,
      ),
    },
  },
  {
    // Five shapes, because a wrong permission and an unreadable one fail
    // differently: the two directions of a bad code (declared none, declared
    // another module's), and the three ways the target cannot be resolved
    // (nothing registers it, the candidates disagree, the gate cannot be read).
    // The last is the one that would turn every `missing` finding into a pass if
    // it went blind, since an unreadable `preHandler` read as "no gate" agrees
    // with everything. Each fixture is source text: a proof handed a ready-made
    // route record would skip the gate reading the comparison rests on.
    script: 'backend/scripts/check-action-route-permissions.ts',
    npmScript: 'check:action-route-permissions',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-action-route-permissions.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'action-declaring-no-code': top(
        () =>
          actionRouteAnalyse(
            {
              sources: new Map([[ACTION_ROUTE_FILE, GATED_ADMIN_ROUTE]]),
              actions: [ACTION_WITHOUT_CODE],
            },
            {},
          ).violations.length,
      ),
      'action-declaring-another-routes-code': top(
        () =>
          actionRouteAnalyse(
            {
              sources: new Map([[ACTION_ROUTE_FILE, GATED_ADMIN_ROUTE]]),
              actions: [{ ...ACTION_WITHOUT_CODE, requiredPermission: 'catalog:write' }],
            },
            {},
          ).violations.length,
      ),
      'target-route-nothing-registers': top(
        () =>
          actionRouteAnalyse(
            {
              sources: new Map([[ACTION_ROUTE_FILE, GATED_ADMIN_ROUTE]]),
              actions: [
                { ...ACTION_WITHOUT_CODE, moduleId: 'ghosts', targetRoute: '/ghost' },
              ],
            },
            {},
          ).violations.length,
      ),
      'candidates-that-disagree': top(
        () =>
          actionRouteAnalyse(
            {
              sources: new Map([
                [
                  ACTION_ROUTE_FILE,
                  [
                    "app.get('/api/v1/admin/inventory/state', { preHandler: requireAdmin('orders:read') }, h);",
                    "app.get('/api/v1/admin/inventory/presence', { preHandler: requireAdmin() }, h);",
                  ].join('\n'),
                ],
              ]),
              actions: [{ ...ACTION_WITHOUT_CODE, requiredPermission: 'orders:read' }],
            },
            {},
          ).violations.length,
      ),
      'gate-it-cannot-read': top(
        () =>
          actionRouteAnalyse(
            {
              sources: new Map([
                [
                  ACTION_ROUTE_FILE,
                  "app.get('/api/v1/admin/inventory', { preHandler: guards[level] }, h);",
                ],
              ]),
              actions: [ACTION_WITHOUT_CODE],
            },
            {},
          ).violations.length,
      ),
      'stale-ledger-entry': top(
        () =>
          actionRouteAnalyse(
            { sources: new Map([[ACTION_ROUTE_FILE, GATED_ADMIN_ROUTE]]), actions: [] },
            { 'inventory:open-inventory': 'undecided' },
          ).stale.length,
      ),
    },
  },
  {
    // Five signals over one rule — a module's background consumers reach the
    // module's seam — and the fixture for each names only its own.
    //
    // Three for the subscription half: a bus-shaped receiver with an event name
    // no signal 3 would match, a domain event off a receiver no signal 1 would
    // match, and a cast around a bus. Written as one `eventBus.on('a.b.v1', …)`
    // the fixture satisfies two signals at once, so either could go blind behind
    // the other.
    //
    // Two for the queue half, and they are different questions rather than two
    // spellings of one: `ungated-registration` is a call to a derived worker
    // factory whose value goes nowhere — the shape `pwa` shipped, invisible to
    // any predicate keyed on `new Worker(` — and `ungated-construction` is a
    // module that builds the worker itself and keeps it. Both fixtures enter as
    // source text at the top of the analysis, so the factory derivation runs:
    // the registration proof supplies the factory *file* rather than a
    // pre-computed factory name, which is the only way it can catch a derivation
    // that has stopped working.
    script: 'backend/scripts/check-subscribe-seam.ts',
    npmScript: 'check:subscribe-seam',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/subscribe-seam-check.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'bus-shaped-receiver': top(
        () =>
          checkSubscribeSeam(
            {
              sources: new Map([
                [
                  'modules/inventory/services/low-stock-alert-service.ts',
                  "eventBus.on('refresh', (p) => this.handle(p));",
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'domain-event-name': top(
        () =>
          checkSubscribeSeam(
            {
              sources: new Map([
                [
                  'modules/inventory/services/low-stock-alert-service.ts',
                  "this.deps.notifier.on('inventory.adjusted.v1', (p) => this.handle(p));",
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'cast-receiver': top(
        () =>
          checkSubscribeSeam(
            {
              sources: new Map([
                [
                  'modules/inventory/services/low-stock-alert-service.ts',
                  "(options.eventBus as InventoryBus).on('refresh', (p) => this.handle(p));",
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'ungated-registration': top(
        () =>
          checkWorkerSeam(
            {
              sources: new Map([
                [
                  'modules/pwa/services/push-delivery-queue.ts',
                  "import { Worker } from 'bullmq';\n" +
                    'export function createPushDeliveryWorker(redis, processor) {\n' +
                    '  return new Worker(QUEUE, (job) => processor(job), { connection: redis });\n' +
                    '}',
                ],
                [
                  'modules/pwa/plugin.ts',
                  'createPushDeliveryWorker(options.redis, processor);',
                ],
              ]),
            },
            {},
          ).violations.filter((v) => v.kind === 'registration').length,
      ),
      'ungated-construction': top(
        () =>
          checkWorkerSeam(
            {
              sources: new Map([
                [
                  'modules/webhooks/plugin.ts',
                  "import { Worker } from 'bullmq';\n" +
                    'const w = new Worker(QUEUE, handler, { connection });\n' +
                    'hold(w);',
                ],
              ]),
            },
            {},
          ).violations.filter((v) => v.kind === 'construction').length,
      ),
    },
  },
  {
    // Two shapes and two scopes, and each proof names only its own: a knex
    // instance and a short `getConnection().execute` are different spellings of
    // the same escape, and a `conn` local is the spelling thirty-nine of the
    // converted sites were written in — proving the inline form alone would
    // leave the bound one free to go blind. The fourth proof is the Command
    // scope, where the transaction comes from `CommandBus.run` rather than from
    // a `transactional(` in the same file, so a check that only knew the
    // lexical callback would report zero over three live findings.
    script: 'backend/scripts/check-transaction-context.ts',
    npmScript: 'check:transaction-context',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-transaction-context.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'knex-instance': top(
        () =>
          checkTransactionContext(
            {
              sources: new Map([
                [
                  'modules/orders/services/order-service.ts',
                  'await em.transactional(async (tx) => {\n  const knex = tx.getKnex();\n});',
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'connection-execute': top(
        () =>
          checkTransactionContext(
            {
              sources: new Map([
                [
                  'modules/cms/services/cms-page-service.ts',
                  "await em.transactional(async (tx) => {\n  await tx.getConnection().execute('delete from cms_pages where id = ?', [id]);\n});",
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'connection-bound-to-a-local': top(
        () =>
          checkTransactionContext(
            {
              sources: new Map([
                [
                  'modules/blog/services/blog-post-service.ts',
                  "await em.transactional(async (tx) => {\n  const conn = tx.getConnection();\n  await conn.execute('insert into blog_posts (id) values (?)', [id]);\n});",
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'command-run-scope': top(
        () =>
          checkTransactionContext(
            {
              sources: new Map([
                [
                  'modules/catalog/commands/attribute-commands.ts',
                  "const cmd = {\n  action: 'catalog.attribute.delete',\n  run: async ({ em }) => {\n    await em.getConnection().execute('select 1 from products', []);\n  },\n};",
                ],
              ]),
            },
            {},
          ).violations.length,
      ),
      'stale-ledger-entry': top(
        () =>
          checkTransactionContext(
            { sources: new Map([['modules/blog/services/blog-post-service.ts', 'const a = 1;']]) },
            { 'modules/blog/services/blog-post-service.ts#knex-instance#tx.getKnex()': 'retired' },
          ).stale.length,
      ),
    },
  },
  {
    // Two findings in the header, so two proofs, plus the ledger's own
    // staleness — and two controls that are the *rule* rather than politeness:
    // the conjunction is what keeps this check off the 328 correct reaches into
    // a package's source, so a proof that only showed it going red would not
    // show it is the right check. See the header's "what it cannot see", which
    // records a third signal that was written, measured at 100% false
    // positives, and removed.
    script: 'backend/scripts/check-singleton-identity.ts',
    npmScript: 'check:singleton-identity',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-singleton-identity.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      'composed-singleton-reach-container': top(() =>
        singletonIdentityFindings(
          `${LOADS_THE_ARTEFACT}import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';`,
          'composed-singleton-reach',
        ),
      ),
      'composed-singleton-reach-entities': top(() =>
        singletonIdentityFindings(
          `${LOADS_THE_ARTEFACT}import { PaymentMethod } from '../../../packages/modules/payment_methods/src/backend/entities/payment-method.entity.js';`,
          'composed-singleton-reach',
        ),
      ),
      'whole-file-reach': top(() =>
        singletonIdentityFindings(
          `${LOADS_THE_ARTEFACT}const m = await import('../../../packages/modules/payment_methods/src/backend/index.js');`,
          'whole-file-reach',
        ),
      ),
      'stale-allowance': top(() =>
        singletonIdentityFindings(`${LOADS_THE_ARTEFACT}const a = 1;`, 'stale-allowance', {
          'backend/test/integration/place-order.test.ts:packages/modules/payment_methods/src/backend/index.ts':
            'retired',
        }),
      ),
      // Conjunct 1 absent: one copy in the process is no copies too many, which
      // is what makes five entity reaches in this repository's unit tests
      // correct by derivation rather than by a ledger entry (D-168).
      'one-copy-is-not-a-finding': top(() => {
        const withBoth = singletonIdentityFindings(
          `${LOADS_THE_ARTEFACT}import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';`,
          'composed-singleton-reach',
        );
        const withOne = singletonIdentityFindings(
          "import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';",
          'composed-singleton-reach',
        );
        return withBoth === 1 && withOne === 0 ? 1 : 0;
      }),
      // Conjunct 2 absent: `import type` erases, so it evaluates nothing. This
      // is the repair !982 took and the one the message tells an author to make.
      'type-only-reach-is-not-a-finding': top(() => {
        const value = singletonIdentityFindings(
          `${LOADS_THE_ARTEFACT}import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';`,
          'composed-singleton-reach',
        );
        const typeOnly = singletonIdentityFindings(
          `${LOADS_THE_ARTEFACT}import type { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';`,
          'composed-singleton-reach',
        );
        return value === 1 && typeOnly === 0 ? 1 : 0;
      }),
      // The third signal (T061a). The consumer names a *service*; the entity is
      // one hop behind it, which is why conjunct 2 asked of the binding could
      // not see batch four's seven sites.
      'chain-parent-reach': top(() =>
        chainParentFindings(
          {
            'backend/test/integration/billing.test.ts':
              "import { setupBackendServer } from '../helpers/test-server.js';\n" +
              REACHES_THE_SERVICE,
          },
          'chain-parent-reach',
        ),
      ),
      // Batch four's seventh site, and a shape of its own: the reach sits in a
      // helper whose *own* closure loads no artefact — it reaches the harness
      // through `import type` — while every test importing it holds both copies.
      'chain-parent-reach-behind-a-helper': top(() =>
        chainParentFindings(
          {
            'backend/test/helpers/billing-ports.ts':
              `${REACHES_THE_SERVICE}import type { setupBackendServer } from './test-server.js';\n`,
            'backend/test/integration/orders.test.ts':
              "import { setupBackendServer } from '../helpers/test-server.js';\n" +
              "import '../helpers/billing-ports.js';\n",
          },
          'chain-parent-reach',
        ),
      ),
      // The refusal, not a finding: the signal's population *is* those literals,
      // so a computed parent name would shorten it in silence.
      'unreadable-chain-parent': top(
        () =>
          transitiveParents(
            new Map([
              [
                'packages/modules/filings/src/backend/entities/filing.entity.ts',
                "@Entity({ tableName: 'filings' })\n@TransitivelyScoped(PARENT, 'documentId')\n" +
                  'export class Filing {}\n',
              ],
            ]),
          ).unreadable.length,
      ),
      // The control that is the *narrowing*: the same transitive reach onto the
      // same composed entity, with no tenant chain naming it, is not a finding.
      // Without it the signal is "any composed singleton reached transitively",
      // which is several hundred correct reaches and a ledger of exceptions.
      'an-unnamed-entity-is-not-a-finding': top(() => {
        const consumer = {
          'backend/test/integration/billing.test.ts':
            "import { setupBackendServer } from '../helpers/test-server.js';\n" +
            REACHES_THE_SERVICE,
        };
        const named = chainParentFindings(consumer, 'chain-parent-reach');
        const withoutTheChild = { ...CHAIN_PARENT_FILES };
        delete withoutTheChild['packages/modules/filings/src/backend/entities/filing.entity.ts'];
        const unnamed = checkSingletonIdentity(
          {
            sources: new Map(Object.entries({ ...withoutTheChild, ...consumer })),
            packages: CHAIN_PARENT_PACKAGES,
          },
          {},
        ).findings.length;
        return named === 1 && unnamed === 0 ? 1 : 0;
      }),
    },
  },
  {
    // The four constructs the header says it can see. The second is the shape
    // issue #128 found hiding from the sibling check; the fourth arrived with
    // D-68 and brings three proofs of its own, because a boot hook fails this
    // rule in three distinguishable ways and one of them has a *different
    // repair* — a mixed hook is split, never probed.
    script: 'backend/scripts/check-entry-presence.ts',
    npmScript: 'check:entry-presence',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-entry-presence.test.ts',
    vacuousGuard: 'exit-2',
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      setInterval: top(() =>
        ungatedTimers(
          'modules/price_lists/plugin.ts',
          'setInterval(() => { void statusWorker.sweep(); }, 300000);',
          'setInterval',
        ),
      ),
      'self-rescheduling-setTimeout': top(() =>
        ungatedTimers('modules/search/plugin.ts', UNSCOPED_SELF_RESCHEDULING, 'setTimeout'),
      ),
      'process.on': top(() =>
        ungatedTimers(
          'modules/price_lists/plugin.ts',
          "process.on('SIGTERM', () => { void statusWorker.drain(); });",
          'process.on',
        ),
      ),
      'boot-hook-without-presence': top(() =>
        ungatedEntriesOfKind(
          'modules/blog/backend.ts',
          UNPROBED_WORK_BOOT_HOOK,
          'no-presence-decision',
        ),
      ),
      'boot-hook-probed-inside-try': top(() =>
        ungatedEntriesOfKind(
          'modules/blog/backend.ts',
          BOOT_HOOK_PROBED_INSIDE_TRY,
          'presence-decided-inside-try',
        ),
      ),
      'mixed-boot-hook': top(() =>
        ungatedEntriesOfKind('modules/blog/backend.ts', MIXED_BOOT_HOOK, 'mixed-boot-hook'),
      ),
      'stale-boot-hook-ledger-entry': top(() => {
        // The other direction of the two-way ratchet: an entry naming a site
        // that no longer exists. It enters as source text like every other
        // proof here — the ledger key is derived from the finding the analysis
        // produces, never written down beside it.
        const site = new Map([['modules/blog/backend.ts', UNPROBED_WORK_BOOT_HOOK]]);
        const found = checkEntryPresence({ sources: site }, {}).violations[0];
        if (found === undefined) return 0;
        const repaired = new Map([
          [
            'modules/blog/backend.ts',
            UNPROBED_WORK_BOOT_HOOK.replace(
              'await seed',
              "if (!effectiveState.isPresent('blog')) return;\n    await seed",
            ),
          ],
        ]);
        return checkEntryPresence({ sources: repaired }, { [entryPresenceKeyOf(found)]: 'stale' })
          .stale.length;
      }),
    },
  },
  {
    // Issue #216 — a reason that restates a fact the tree re-derives, and gets
    // it wrong. Five shapes, and the fifth is the one that matters most: the
    // classification has to move when the *manifests* move, in the same run,
    // which is why every proof enters as source text plus a manifest list and
    // none of them is handed a locked set.
    //
    // Issue #279 — and then the population turned out to be the part nothing
    // proved. The five above enter at `checkLockClaims`, which takes the source
    // map `collectArtifacts` produced, so every one of them is green whether or
    // not `packages/contracts/src` is in that map — and it was not, while a
    // published port's doc block is exactly where a module writes "when the
    // owner is switched off". The sixth proof therefore enters as a **tree on
    // disk**, spawned: a synthetic repository whose contracts package carries a
    // switchability claim about a module its manifests lock. Revert the
    // widening and it goes green, which is what a proof of a population has to
    // be able to do.
    script: 'backend/scripts/check-lock-claims.ts',
    npmScript: 'check:lock-claims',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-lock-claims.test.ts',
    vacuousGuard: 'exit-2',
    // Part of the population **is** the module tree: the manifests, where
    // `nonBindingDependencies` and `acknowledgedDependencies` reasons live and
    // where D-100's four original stale claims sat. The ledger shards and the
    // in-script ledgers are under `scripts/`, which a module move leaves alone
    // — and that is exactly why the check needs the derived floor rather than
    // an emptiness test. On a partial move ~56 artefacts survive, the
    // regenerated index still answers for every module so the locked set is
    // complete, and all three of this check's own vacuity conditions pass while
    // half the manifests go unread. Every registered module ships a
    // `manifest.ts` by construction, so the floor is exact and needs no
    // `excluded` list. The contracts half (issue #279) carries the same kind of
    // floor from its own declared source, the package barrel, printed beside it
    // as `contracts-barrel:<covered>/<expected>`.
    readSize: 'reported',
    residueGuard: 'derived-population',
    red: {
      // The identifier spelling, as the withdrawn cut wrote it.
      'lock-claimed-over-switchable-module': top(() =>
        staleClaims(
          "  'Withdrawn: `fixture_switchable` is `nonDeactivatable`, so the ports cannot go in.',",
          'stale-lock-claim',
        ),
      ),
      // The prose spelling, over the wrapped-string seam a reason is written
      // on: subject and assertion land on different source lines, so a check
      // reading line by line sees neither.
      'lock-claimed-across-a-wrapped-string': top(() =>
        staleClaims(
          "  'F3 Phase C. Retired by nothing — `fixture_switchable` ' +\n" +
            "  'is non-deactivatable and the edge cannot be declared.',",
          'stale-lock-claim',
        ),
      ),
      // The claim that never writes the word. This was the load-bearing step of
      // the withdrawal in #216, and a check keyed on `deactivatable` misses it.
      'lock-claimed-as-always-present': top(() =>
        staleClaims(
          "// the orchestrator refuses a needed dependency and `fixture_switchable` is always present",
          'stale-lock-claim',
        ),
      ),
      // The converse, which goes stale by the same mechanism when a lock is
      // *added*: `catalog` carried one for `price_lists` for two features.
      'switchability-claimed-over-locked-module': top(() =>
        staleClaims(
          '// `fixture_locked` is deactivatable (`fixture_locked.enabled`), so the flip is refused.',
          'stale-switchable-claim',
        ),
      ),
      // The derivation itself. The same sentence, judged against manifests in
      // which the lock has been withdrawn — nothing in the text changed, and a
      // check that had written the locked set down would still be green.
      'claim-going-stale-because-a-manifest-moved': top(() => {
        const source = '// `fixture_locked` is non-deactivatable.';
        const unlocked: readonly ManifestActivationInput[] = [
          {
            id: 'fixture_locked',
            activation: { settingCode: 'fixture_locked.enabled', default: true },
          },
          { id: 'fixture_switchable', activation: { default: true } },
        ];
        const before = checkLockClaims({
          sources: new Map([['scripts/ledgers/x.ts', source]]),
          manifests: CLAIM_MANIFESTS,
        }).findings.length;
        const after = checkLockClaims({
          sources: new Map([['scripts/ledgers/x.ts', source]]),
          manifests: unlocked,
        }).findings.length;
        return before === 0 ? after : 0;
      }),
      // Issue #279 — the source the population did not hold. It enters as a
      // repository on disk because that is the only entry above
      // `collectArtifacts`, and it asserts the finding names the *contract*:
      // the count alone is green on a run that found the same claim in the
      // ledger shard beside it, which is the population that already existed.
      'lock-claim-in-a-published-contract': top(() =>
        reportsClaimInAPublishedContract(
          '/**\n' +
            ' * The orders read port.\n' +
            ' *\n' +
            ' * Owner off: `fixture_locked` is switchable, so every caller has to handle\n' +
            ' * the 503 `MODULE_DISABLED` envelope.\n' +
            ' */\n' +
            'export interface OrdersReadPort { read(): Promise<string> }\n',
          'stale-switchable-claim',
        ),
      ),
    },
  },
  {
    // The check whose defect its own artefact hides: a NUL makes git call the
    // file binary, so the diff that would show the byte shows nothing at all.
    // Six shapes it must see and two it must not. The two exclusions are proven
    // as **discriminations** — a proof that asserts "no finding" is green when
    // the check is blind, so each pairs the excluded file with a source file
    // beside it and asserts that exactly the source comes back.
    script: 'backend/scripts/check-nul-bytes.ts',
    npmScript: 'check:nul-bytes',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-nul-bytes.test.ts',
    vacuousGuard: 'exit-2',
    // Walks the whole repository, and every file in it is its population.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'raw-nul-in-source': top(
        () =>
          findNulBytes([nulFile('backend/src/http/interceptors/registry.ts', 'const k = `a\0b`;')])
            .length,
      ),
      // Git's own heuristic reads the first 8000 bytes only, which is why one
      // of the six kept diffing as text while carrying the byte.
      'nul-past-gits-binary-window': top(
        () =>
          findNulBytes([nulPastGitWindow('backend/src/x/service.ts')]).filter(
            (finding) => finding.beyondGitBinaryWindow,
          ).length,
      ),
      // A test file is in the population like any other source: a fixture
      // builds a JavaScript string, and the escape builds the same string.
      'nul-in-test-fixture': top(
        () =>
          findNulBytes([
            nulFile('backend/test/unit/product_feeds/xml-feed-serializer.test.ts', '`A\0B`'),
          ]).length,
      ),
      // The reason the exclusion is a deny-list rather than an allow-list of
      // known-text extensions: neither of these would be in the population.
      'nul-in-unlisted-text-extension': top(() =>
        exactlyNulPaths(
          [nulFile('backend/src/db/seed.sql', "values ('\0')"), nulFile('tooling/c.toml', 'k="\0"')],
          ['backend/src/db/seed.sql', 'tooling/c.toml'],
        ),
      ),
      'nul-in-extensionless-file': top(
        () => findNulBytes([nulFile('scripts/release-notes', 'a\0b')]).length,
      ),
      'binary-extension-excluded': top(() =>
        exactlyNulPaths(
          [
            nulFile('admin/public/icons/admin-192.png', '\x89PNG\0\0\0'),
            nulFile('admin/src/main.ts', 'const k = `a\0b`;'),
          ],
          ['admin/src/main.ts'],
        ),
      ),
      'pruned-directory-excluded': top(() =>
        exactlyNulPaths(
          [
            nulFile('node_modules/dep/index.js', 'a\0b'),
            nulFile('backend/dist/index.js', 'a\0b'),
            nulFile('backend/src/index.ts', 'a\0b'),
          ],
          ['backend/src/index.ts'],
        ),
      ),
      // A nested git worktree is another commit of this same repository, so a
      // file already repaired here is still unrepaired there — and reported
      // once per worktree, against a path no merge request can change. It is a
      // *path* exclusion, not a name one, because `.claude/` also holds
      // `agents/` and `skills/`, which are tracked source and stay scanned.
      'nested-worktree-excluded-but-not-the-rest-of-dot-claude': top(() =>
        exactlyNulPaths(
          [
            nulFile('.claude/worktrees/agent-a1/backend/src/index.ts', 'a\0b'),
            nulFile('.claude/agents/endora-commerce-dev.md', 'a\0b'),
            nulFile('backend/src/index.ts', 'a\0b'),
          ],
          ['.claude/agents/endora-commerce-dev.md', 'backend/src/index.ts'],
        ),
      ),
      // Issue #248 — a generated tree scanned as source. It is the one proof
      // here that cannot enter as bytes: the exclusion is a decision the
      // *walk* takes, and a `ScannedFile` list is what the walk produced. Both
      // anchorings are proven, because they are two tables and a repair to one
      // says nothing about the other.
      'generated-tree-skipped-by-name': top(() =>
        nulTreeSkips('docs/.docusaurus/registry.js', 'backend/src/modules/orders/graph.ts'),
      ),
      'generated-tree-skipped-by-path': top(() =>
        nulTreeSkips('backend/var/assets/ab/abcdef.xml', 'backend/src/modules/orders/graph.ts'),
      ),
      // The ledger's second direction: an entry naming a file that no longer
      // carries a NUL. It enters as bytes, like every other proof here.
      'stale-ledger-entry': top(
        () =>
          checkNulBytes([nulFile('backend/src/a.ts', 'const k = `ab`;')], {
            'backend/src/a.ts': 'A reason that has outlived its file.',
          }).stale.length,
      ),
    },
  },
  {
    // Issue #240 — the wrong answer that looks like the right one. Four authors
    // wrote `normalize('NFD').replace(/\p{Diacritic}/gu, '')` inside a year and
    // all four shipped the same bug, because `ł` has no canonical
    // decomposition. Seven shapes it must see — two decomposing forms, four
    // spellings of the strip, and the strip standing alone — and five it must
    // not, each proven as a discrimination because "no finding" is green when
    // the check is blind. The comment discrimination is the load-bearing one:
    // four files in this tree quote the wrong one-liner on purpose, so a
    // text-level implementation reports the documentation that exists to
    // prevent the defect. Its population is the whole tree since the fold moved
    // into `@endora-commerce/contracts`: the rule "use the shared fold" had nothing to mean
    // in a package that could not reach one, which is why three packages that
    // fold were excluded by the first version of this entry.
    //
    // Issue #244 — and then this check turned out to be the family's own worked
    // example. Both signals above have a population defined by the **presence**
    // of the thing they check, so a slug builder that folds nothing writes
    // nothing for them to see: two shipped that way for a year, deleting `ł`
    // out of every Polish name, while the check printed `violations=0`
    // throughout. The third signal, `slug-run`, keys on the builder instead —
    // present whether or not the site folds — and its load-bearing proof is
    // `slug-run-that-folds-correctly`: a predicate that reported only the
    // unfolded ones would be the old blindness with an extra step.
    //
    // Its four discriminations carry as much weight as its red proofs. The
    // obvious wider predicate matches 9 sites in this tree and 7 of them
    // legitimately need no fold, which would make the ledger mostly exceptions —
    // and a ledger that is mostly exceptions teaches people to add entries
    // rather than to think. Requiring the run collapse is what removes them, and
    // each discrimination below is one of those live sites.
    script: 'backend/scripts/check-diacritic-folds.ts',
    npmScript: 'check:diacritic-folds',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-diacritic-folds.test.ts',
    vacuousGuard: 'exit-2',
    // Walks four whole packages — `admin`, `backend`, `storefront`, `packages`.
    // It touches the module tree without being a walk *of* it: its population is
    // never derived from module ids, so a moved tree leaves it no residue to
    // read as the tree. Its emptiness guard is the anchored helper itself.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'nfd-decomposition': top(
        () =>
          diacriticAnalyze(
            naiveFold('NFD', '/\\p{Diacritic}/gu'),
            'admin/src/modules/cms/components/PageBuilderDrawer.tsx',
          ).filter((f) => f.kind === 'decomposition').length,
      ),
      // A second spelling of the same defect: a check grepping only for `NFD`
      // reads `product_feeds/api.ts` clean.
      'nfkd-decomposition': top(
        () =>
          diacriticAnalyze(
            naiveFold('NFKD', '/\\p{Diacritic}/gu'),
            'admin/src/modules/product_feeds/api.ts',
          ).filter((f) => f.kind === 'decomposition').length,
      ),
      'diacritic-property-strip': top(
        () =>
          diacriticAnalyze(
            naiveFold('NFD', '/\\p{Diacritic}/gu'),
            'admin/src/components/ui/combobox.tsx',
          ).filter((f) => f.kind === 'diacritic-strip').length,
      ),
      'combining-range-strip': top(
        () =>
          diacriticAnalyze(
            naiveFold('NFD', '/[\\u0300-\\u036f]/g'),
            'admin/src/modules/newsletter/pages/TagsPage.tsx',
          ).filter((f) => f.kind === 'diacritic-strip').length,
      ),
      // The range written as the characters themselves. The file that spells it
      // this way contains no backslash-u at all, so an escape-only rule reads
      // it clean.
      'raw-combining-range-strip': top(
        () =>
          diacriticAnalyze(
            naiveFold('NFD', `/${RAW_COMBINING_RANGE}/g`),
            'admin/src/lib/thing.ts',
          ).filter((f) => f.kind === 'diacritic-strip').length,
      ),
      'regexp-built-from-a-string': top(
        () =>
          diacriticAnalyze(
            "const marks = new RegExp('\\\\p{Diacritic}', 'gu');",
            'admin/src/lib/thing.ts',
          ).filter((f) => f.kind === 'diacritic-strip').length,
      ),
      // No proximity window, on purpose: a fold split over two functions would
      // escape one, and each half alone is still a second implementation.
      'strip-with-no-decomposition': top(
        () =>
          diacriticAnalyze(
            "export const strip = (v: string) => v.replace(/\\p{Diacritic}/gu, '');",
            'admin/src/lib/marks.ts',
          ).length,
      ),
      // The predicate reads literal nodes, so the four files that quote the
      // wrong one-liner to explain why they do not use it are out of the
      // population by construction. Exactly the code line comes back.
      'quoted-in-a-comment-is-not-a-fold': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'admin/src/components/AppShell.tsx',
              [
                '/**',
                " * `normalize('NFD').replace(/\\p{Diacritic}/gu, '')` is wrong — `ł` does",
                " * not decompose, and `NFKD` with `[\\u0300-\\u036f]` is no better.",
                ' */',
                'export const a = 1;',
              ].join('\n'),
            ),
            foldSource('admin/src/lib/thing.ts', naiveFold('NFD', '/\\p{Diacritic}/gu')),
          ],
          ['admin/src/lib/thing.ts'],
        ),
      ),
      // `NFC` and `NFKC` compose; they never expose a combining mark to strip,
      // so they are outside the rule rather than exempt from it.
      'composing-form-is-not-a-fold': top(() =>
        exactlyFoldPaths(
          [
            foldSource('admin/src/lib/a.ts', "const a = v.normalize('NFC').normalize('NFKC');"),
            foldSource('admin/src/lib/b.ts', "const b = v.normalize('NFD');"),
          ],
          ['admin/src/lib/b.ts'],
        ),
      ),
      // Issue #197's lesson: the exemption is one exact path, so a second file
      // named `text-normalization.ts` cannot appoint itself the owner of the
      // fold — which is the precise failure this check exists to prevent.
      'helper-excluded-by-path-not-by-name': top(() =>
        exactlyFoldPaths(
          [
            foldSource(SHARED_FOLD_HELPER, naiveFold('NFD', '/\\p{Diacritic}/gu')),
            foldSource(
              'admin/src/modules/cms/text-normalization.ts',
              naiveFold('NFD', '/\\p{Diacritic}/gu'),
            ),
          ],
          ['admin/src/modules/cms/text-normalization.ts'],
        ),
      ),
      // `backend/`, `packages/` and `storefront/` were out until issue #240,
      // for one stated reason: none of them could import a fold that lived in
      // `admin/src`. `foldDiacritics` in `@endora-commerce/contracts` is reachable from all
      // three, so all three are in — and a narrowing shows up here as a red
      // test rather than as a smaller number.
      'every-package-that-can-import-the-fold-is-scanned': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'backend/src/modules/catalog/services/catalog-admin.service.ts',
              naiveFold('NFKD', '/\\p{Diacritic}/gu'),
            ),
            foldSource('packages/api-client/src/search.ts', naiveFold('NFD', '/\\p{Diacritic}/gu')),
            foldSource('storefront/lib/search.ts', naiveFold('NFD', '/\\p{Diacritic}/gu')),
            foldSource('admin/src/lib/thing.ts', naiveFold('NFD', '/\\p{Diacritic}/gu')),
          ],
          [
            'admin/src/lib/thing.ts',
            'backend/src/modules/catalog/services/catalog-admin.service.ts',
            'packages/api-client/src/search.ts',
            'storefront/lib/search.ts',
          ],
        ),
      ),
      // The two subtrees that have to be able to spell the refused shapes: the
      // checks, and the fixtures that prove each shape is still seen. Exact path
      // prefixes, not a `scripts` name rule — a module directory of that name
      // would otherwise exempt itself, which is issue #197 one level up.
      'the-checks-and-their-fixtures-are-excluded-by-path': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'backend/scripts/check-diacritic-folds.ts',
              naiveFold('NFD', '/\\p{Diacritic}/gu'),
            ),
            foldSource(
              'backend/test/unit/scripts/check-inventory.test.ts',
              naiveFold('NFD', '/\\p{Diacritic}/gu'),
            ),
            foldSource(
              'backend/src/modules/catalog/scripts/reindex.ts',
              naiveFold('NFD', '/\\p{Diacritic}/gu'),
            ),
          ],
          ['backend/src/modules/catalog/scripts/reindex.ts'],
        ),
      ),
      // The ledger's second direction: a per-file count that no longer matches.
      'stale-ledger-entry': top(
        () =>
          checkDiacriticFolds(
            [foldSource('admin/src/modules/product_feeds/api.ts', 'export const a = 1;')],
            {
              'admin/src/modules/product_feeds/api.ts': {
                findings: 2,
                reason: 'A reason that has outlived its fold.',
                retiredBy: 'issue #239',
              },
            },
          ).stale.length,
      ),
      // The vacuous-pass guard, which is the exemption itself: a helper that no
      // longer parses as a fold means the file moved or the analysis went
      // blind, and either way a green would be worthless.
      'helper-that-no-longer-folds': top(() =>
        helperIsStillTheOwner('export const normalize = (v: string) => v.toLowerCase();') ? 0 : 1,
      ),
      // ---- the third signal (issue #244) ---------------------------------
      // The two above have a population defined by the presence of the thing
      // they check, so a site that folds nothing matches nothing and reports
      // clean. This one keys on the slug builder, which is written either way.
      //
      // `cms-template-layout.ts` as it stood on `master` for a year: no fold
      // step at all, so `Żółw` produced `w` and neither older signal saw it.
      'slug-run-without-a-fold': top(
        () =>
          diacriticAnalyze(
            "export const code = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');",
            'admin/src/modules/cms/components/cms-template-layout.ts',
          ).filter((f) => f.kind === 'slug-run').length,
      ),
      // **The load-bearing one.** `BlogPostEditor` folded correctly through the
      // admin `normalize` and was still a ninth private copy of the generator.
      // If this came back 0 the signal would be keyed on the missing fold —
      // which is unobservable, and is the whole of issue #244.
      'slug-run-that-folds-correctly': top(
        () =>
          diacriticAnalyze(
            handRolledSlug('normalize', '/[^a-z0-9]+/g'),
            'admin/src/modules/blog/pages/BlogPostEditor.tsx',
          ).filter((f) => f.kind === 'slug-run').length,
      ),
      // `pim_ergonode`'s `sanitiseSourceCode`: the class carries no quantifier,
      // so the run is collapsed by a second `.replace` later in the same chain.
      // A predicate reading one expression node in isolation clears it.
      'slug-run-collapsed-in-a-second-move': top(
        () =>
          diacriticAnalyze(
            "export const k = (v: string) => v.replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_');",
            'packages/modules/pim_ergonode/src/backend/services/key-derivation.ts',
          ).filter((f) => f.kind === 'slug-run').length,
      ),
      // `[^\w]+` names the same ASCII set without writing a range, so a
      // class-range grep reads it clean while it deletes `ł` just the same.
      'slug-run-written-with-the-w-shorthand': top(
        () =>
          diacriticAnalyze(
            handRolledSlug('fold', '/[^\\w]+/g'),
            'storefront/lib/slug.ts',
          ).filter((f) => f.kind === 'slug-run').length,
      ),
      // The seven sanitisers the wider predicate would have pulled in, and the
      // reason this ledger is not mostly exceptions. Written as
      // discriminations, one per rule that clears them, because "no finding" is
      // green when the check is blind.
      //
      // A one-for-one substitution preserves length and position — identifier
      // grammar, not slug grammar. `FieldProtectionToggle`'s DOM id.
      'one-for-one-substitution-is-not-a-slug': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'admin/src/modules/pim_ergonode/components/FieldProtectionToggle.tsx',
              "export const id = (p: string) => `x-${p}`.replace(/[^a-zA-Z0-9_-]/g, '-');",
            ),
            foldSource('admin/src/lib/slug.ts', handRolledSlug('fold', '/[^a-z0-9]+/g')),
          ],
          ['admin/src/lib/slug.ts'],
        ),
      ),
      // A quantified run replaced by nothing is a compaction: there is no
      // delimiter in the output for it to be a slug. `autopay`'s hash seed.
      'deleting-the-run-is-not-a-slug': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'backend/src/modules/autopay/services/autopay-hash.ts',
              "export const c = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '');",
            ),
            foldSource('admin/src/lib/slug.ts', handRolledSlug('fold', '/[^a-z0-9]+/g')),
          ],
          ['admin/src/lib/slug.ts'],
        ),
      ),
      // A Unicode-aware class collapses a run and is **not** the defect: `ł` is
      // a letter, so it survives. Reporting it would report the correct answer.
      'unicode-aware-class-is-not-the-defect': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'storefront/lib/heading-id.ts',
              "export const h = (v: string) => v.replace(/[^\\p{L}\\p{N}]+/gu, '-');",
            ),
            foldSource('admin/src/lib/slug.ts', handRolledSlug('fold', '/[^a-z0-9]+/g')),
          ],
          ['admin/src/lib/slug.ts'],
        ),
      ),
      // The stated bound of the window: one call chain, no further, in the
      // idiom of `check-port-catches` following a gate one hop through `this`.
      // A bound that is asserted is a bound a widening has to delete on purpose.
      'a-collapse-split-across-statements-is-out-of-the-window': top(() =>
        exactlyFoldPaths(
          [
            foldSource(
              'backend/src/modules/x/two-statements.ts',
              'export function k(v: string): string {\n' +
                "  const c = v.replace(/[^a-z0-9_]/g, '_');\n" +
                "  return c.replace(/_{2,}/g, '_');\n" +
                '}',
            ),
            foldSource('admin/src/lib/slug.ts', handRolledSlug('fold', '/[^a-z0-9]+/g')),
          ],
          ['admin/src/lib/slug.ts'],
        ),
      ),
      // The slug ledger's second direction, and its own: an entry over a file
      // that no longer builds a slug fails, and a fold filed in the slug ledger
      // is not excused by it.
      'stale-slug-ledger-entry': top(
        () =>
          checkDiacriticFolds(
            [foldSource('admin/src/lib/slug.ts', 'export const a = 1;')],
            {},
            {
              'admin/src/lib/slug.ts': {
                findings: 1,
                reason: 'A reason that has outlived its slug builder.',
                retiredBy: 'issue #244',
              },
            },
          ).stale.length,
      ),
      // The exemption is one exact path for the generator exactly as it is for
      // the fold (issue #197): a copy of `slugify` elsewhere is a violation
      // however it is named.
      'the-shared-generator-is-excluded-by-path-not-by-name': top(() =>
        exactlyFoldPaths(
          [
            foldSource(SHARED_FOLD_HELPER, handRolledSlug('foldDiacritics', '/[^a-z0-9]+/g')),
            foldSource(
              'admin/src/lib/text-normalization.ts',
              handRolledSlug('foldDiacritics', '/[^a-z0-9]+/g'),
            ),
          ],
          ['admin/src/lib/text-normalization.ts'],
        ),
      ),
      // The guard's third shape: a helper that still folds but no longer holds
      // the generator. `slugify` is what every `slug-run` message tells the
      // author to import, so its absence makes the printed remedy nonexistent.
      'helper-that-folds-but-no-longer-slugifies': top(() =>
        helperIsStillTheOwner(
          "export const f = (v: string) => v.normalize('NFD').replace(/\\p{Diacritic}/gu, '');",
        )
          ? 0
          : 1,
      ),
    },
  },
  {
    // Ran in no job until issue #116. The admin SPA carries 274 findings, so
    // `--strict` would have failed the build on standing debt rather than on a
    // regression; it runs against a per-file baseline instead, two-way like
    // every other ledger here.
    script: 'backend/scripts/i18n-hardcoded-strings.ts',
    npmScript: 'i18n:hardcoded',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/i18n-hardcoded-strings.test.ts',
    vacuousGuard: 'exit-2',
    // Walks the admin SPA.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'jsx-text': top(
        () =>
          hardcodedAnalyze(
            'export const A = () => <Button>Save changes</Button>;\n',
            '/repo/admin/src/a.tsx',
          ).filter((f) => f.kind === 'jsx-text').length,
      ),
      'jsx-attr': top(
        () =>
          hardcodedAnalyze(
            'export const A = () => <input placeholder="Search orders" />;\n',
            '/repo/admin/src/a.tsx',
          ).filter((f) => f.kind === 'jsx-attr').length,
      ),
    },
  },
  {
    // Five rules in the script's header, five proofs. The route-segment rule had
    // no red fixture anywhere until issue #130; the class-scope rule arrived
    // with feature 081 and with its own.
    script: 'scripts/check-naming.sh',
    npmScript: 'check:naming',
    job: 'quality:static',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
    // Three of the five rules do walk the module tree, and since feature 080's
    // T012 the script **resolves** that root from the generated manifest index
    // rather than spelling it: a tree that moved is followed, one that is gone
    // is exit 2, and one that resolves twice is exit 2 as well. It stays
    // `not-a-module-walk` here for the reason the read-size sweep below states
    // in full — `moved-module-tree.test.ts` spawns tsx scripts over a fixture
    // backend and a shell check needs a git work tree, which the backend image
    // has not got. Its residue proofs are in `shell-checks.test.ts`, over a
    // fixture whose git is faked.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'module-folder': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          fixture.write('backend/src/modules/BadName/thing.ts', 'export const a = 1;\n');
          fixture.lists(['backend/src/modules/BadName/thing.ts']);
        }),
      ),
      'migration-identifier': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          fixture.write(
            'backend/src/modules/orders/migrations/20260901T000000_orders_add.ts',
            "export class M { up() { this.addSql(createTable('orderItems')); } }\n",
          );
          fixture.lists(['backend/src/modules/orders/migrations/20260901T000000_orders_add.ts']);
        }),
      ),
      'zod-contract-key': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          fixture.write(
            'packages/contracts/src/orders.ts',
            'export const s = z.object({\n  order_id: z.string(),\n});\n',
          );
          fixture.lists(['packages/contracts/src/orders.ts']);
        }),
      ),
      'route-segment': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          fixture.write(
            'backend/src/modules/orders/routes.admin.ts',
            "app.get('/api/v1/orderItems', handler);\n",
          );
          fixture.lists(['backend/src/modules/orders/routes.admin.ts']);
        }),
      ),
      // The fifth rule reads the filesystem rather than the listing, so the
      // fixture is a file on disk and no `lists()` call goes with it.
      'migration-class-scope': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          fixture.write(
            'backend/src/modules/orders/migrations/20270101T000000_orders_probe.ts',
            'export class Migration20270101T000000CatalogProbe extends Migration {}\n',
          );
        }),
      ),
      // Issue #244's shape, and the one the pre-existing floors are green on:
      // a listing that is non-empty and misses the module the index registers.
      'short-listing': top(() =>
        shellRefusal('check-naming.sh', (fixture) => {
          fixture.listsExactly(['backend/src/kernel/thing.ts']);
        }),
      ),
      // Feature 080, T012 — the two shapes the resolved root refuses. Both
      // fixtures are trees, entering above the resolution: it runs before the
      // first rule, so a proof that handed the script a root would be proving
      // the rules and not the resolution.
      'module-root-unresolvable': top(() =>
        shellRefusal('check-naming.sh', (fixture) => {
          fixture.removeModuleTree();
          fixture.lists(['backend/src/kernel/thing.ts']);
        }),
      ),
      'module-root-ambiguous': top(() =>
        shellRefusal('check-naming.sh', (fixture) => {
          fixture.write(
            'backend/src/legacy-modules/_lifecycle/manifest-index.generated.ts',
            "import { manifest as manifest0 } from '../orders/manifest.js';\n",
          );
        }),
      ),
      // And the direction a refusal cannot prove: the tree **moved**, and every
      // rule went on judging it there. Without this one, a resolution that
      // refused everything would pass the two above.
      'module-root-followed': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          const moved = fixture.moveModuleTree('domain_modules');
          fixture.write(`${moved}/BadName/thing.ts`, 'export const a = 1;\n');
          fixture.listsExactly([
            `${moved}/orders/order-service.ts`,
            `${moved}/BadName/thing.ts`,
          ]);
        }),
      ),
      // And the population `module-root-ambiguous` was refusing on every local
      // run: a checkout nested inside this one, which is the normal state of a
      // machine whose agents work in `git worktree`s created under the
      // repository directory.
      //
      // A red rather than a pass, and the finding is planted in the **outer**
      // tree with the nested one left clean, so the proof discriminates in both
      // directions at once: exit 2 if the prune is missing, exit 0 if the prune
      // resolved the nested root instead, and this finding only if the outer
      // root is the one every rule ran against. A proof that planted findings
      // in both trees would report the same 1 for two of those three.
      'nested-checkout-pruned': top(() =>
        shellRed('check-naming.sh', (fixture) => {
          fixture.nestCheckout('.claude/worktrees/agent-x');
          fixture.write('backend/src/modules/OuterBadName/thing.ts', 'export const a = 1;\n');
        }),
      ),
      // The prune is not a fallback. With this checkout's own module tree gone
      // and a nested one standing, the answer is still "there is no index
      // here" — the alternative is every rule at work on another branch's tree,
      // reporting the verdict as this repository's.
      'nested-checkout-not-a-fallback': top(() =>
        shellRefusal('check-naming.sh', (fixture) => {
          fixture.removeModuleTree();
          fixture.nestCheckout('.claude/worktrees/agent-x');
          fixture.lists(['backend/src/kernel/thing.ts']);
        }),
      ),
    },
  },
  {
    // Two scopes, and only two: source-code comments and `docs/docs/**` pages.
    script: 'scripts/check-language.sh',
    npmScript: 'check:language',
    job: 'quality:static',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
    // Its population is the git listing, which the empty-listing guard covers.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      'source-comment': top(() =>
        shellRed('check-language.sh', (fixture) => {
          // A template literal, not a quoted string: this file is itself scanned
          // by the check, and its citation blanking strips a backticked run.
          fixture.write(
            'backend/src/modules/orders/order-service.ts',
            `// Zwraca zamówienie klienta.\nexport const a = 1;\n`,
          );
        }),
      ),
      'docs-page': top(() =>
        shellRed('check-language.sh', (fixture) => {
          fixture.write('docs/docs/intro.md', `# Wstęp\n\nTo jest opis modułu.\n`);
        }),
      ),
      // Issue #244. Both of this check's scopes are read out of the same
      // listing, so a listing short of a registered module is a scan of a
      // residue — with the two emptiness guards above green on it.
      'short-listing': top(() =>
        shellRefusal('check-language.sh', (fixture) => {
          fixture.listsExactly(['backend/src/kernel/thing.ts']);
        }),
      ),
      // The four shapes this script gained when its module root stopped being
      // spelled and started being resolved, the same way `check-naming.sh`
      // resolves it. They are one job and one pair of modes; a population
      // derived two ways is two answers waiting to disagree.
      'module-root-unresolvable': top(() =>
        shellRefusal('check-language.sh', (fixture) => {
          fixture.removeModuleTree();
          fixture.lists(['backend/src/kernel/thing.ts']);
        }),
      ),
      'module-root-ambiguous': top(() =>
        shellRefusal('check-language.sh', (fixture) => {
          fixture.write(
            'backend/src/legacy-modules/_lifecycle/manifest-index.generated.ts',
            "import { manifest as manifest0 } from '../orders/manifest.js';\n",
          );
        }),
      ),
      // The direction a pair of refusals cannot prove: the tree moved, and the
      // scan went on judging it there. Red rather than green, so a resolution
      // that refused everything cannot pass this one.
      'module-root-followed': top(() =>
        shellRed('check-language.sh', (fixture) => {
          const moved = fixture.moveModuleTree('domain_modules');
          fixture.write(`${moved}/orders/order-service.ts`, `// Zwraca zamówienie.\n`);
          fixture.listsExactly([`${moved}/orders/order-service.ts`]);
        }),
      ),
      // And the nested checkout, in the same shape as `check-naming.sh`'s: the
      // Polish comment is in the outer tree and the nested tree is clean, so
      // this proof is red only if the prune left the outer scan intact. That a
      // nested tree's own comments are *not* read is the other half, and it
      // cannot be a red proof — a red map counts findings, and the claim there
      // is that a finding does not exist. It is asserted on the read count in
      // `shell-checks.test.ts`, where a pass alone would not have been enough.
      'nested-checkout-pruned': top(() =>
        shellRed('check-language.sh', (fixture) => {
          fixture.nestCheckout('.claude/worktrees/agent-x');
          fixture.write(
            'backend/src/modules/orders/order-service.ts',
            `// Zwraca zamówienie klienta.\nexport const a = 1;\n`,
          );
        }),
      ),
    },
  },
  {
    // In no job until issue #116, on the grounds that it measures an installed
    // `node_modules` — which the `quality` job installs in `before_script` and
    // always has. The reason held only for `quality:static`, whose image is
    // deliberately toolchain-free, and it was written as if it held for both.
    script: 'scripts/check-pdfmake-footprint.sh',
    npmScript: 'check:pdfmake-footprint',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
    // Its population is one installed package.
    readSize: 'reported',
    residueGuard: 'not-a-module-walk',
    red: {
      // Both install layouts, because the repository's own is the hoisted one:
      // a candidate glob that stopped matching it would measure the other or
      // nothing at all.
      'top-level-install': top(() =>
        shellRed('check-pdfmake-footprint.sh', (fixture) => {
          fixture.installPdfmake(40 * 1024 * 1024);
        }),
      ),
      'pnpm-hoisted-install': top(() =>
        shellRed('check-pdfmake-footprint.sh', (fixture) => {
          fixture.installPdfmake(40 * 1024 * 1024, 'hoisted');
        }),
      ),
    },
  },
  {
    // Feature 080 (T043). The gate it guards — `release:changeset` — is the
    // changesets CLI's own command, which is why AGENTS.md records that it is
    // deliberately not a `check-*` script. That stays true of the *question*
    // and was read as covering the *configuration*: measured, with a branch
    // that changes `packages/` and carries no changeset, the gate exits 1 at
    // `privatePackages.version: true`, exits 0 at `false` and exits 0 with the
    // block deleted, which is the `@changesets/config@4` default. Four lines
    // of apparent boilerplate that nothing in the tree read.
    script: 'backend/scripts/check-release-intent.ts',
    npmScript: 'check:release-intent',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-release-intent.test.ts',
    vacuousGuard: 'exit-2',
    // Its population is the workspace: the config, `pnpm-workspace.yaml`, one
    // manifest per member and the changeset files.
    readSize: 'reported',
    // The members it reads will *include* the module packages when they land,
    // but the floor is per `pnpm-workspace.yaml` entry rather than per
    // registered module: what this check can lose is a whole family glob, and
    // the manifest index would not report that.
    residueGuard: 'not-a-module-walk',
    red: {
      // The headline, and the one shape whose absence is worth the whole file.
      'version-disabled': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          config['privatePackages'] = { version: false, tag: false };
        }),
        'version-disabled',
      )),
      // The same value written the way it actually arrives — by deletion.
      'version-disabled-by-omission': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          delete config['privatePackages'];
        }),
        'version-disabled',
      )),
      // D-160.5: everything stays private through Wave 4, and this is what
      // makes the tag decision land in the merge request that changes it.
      'publishable-package': top(() =>
        releaseIntentFindings(
          { 'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0" }' },
          'publishable-package',
        ),
      ),
      'tag-without-publication': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          config['privatePackages'] = { version: true, tag: true };
        }),
        'tag-without-publication',
      )),
      // The 67-package failure mode, written as it would arrive: one `ignore`
      // entry under the new scope, and every module package stops needing a
      // changeset while the gate goes on exiting 0.
      'ignored-family-member': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          config['ignore'] = ['host', '@fx/*'];
        }),
        'ignored-family-member',
      )),
      'unignored-application': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          config['ignore'] = [];
        }),
        'unignored-application',
      )),
      // A path written where a name belongs. `ignore` is glob-matched against
      // names, so this matches nothing at all.
      'stale-ignore-entry': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          config['ignore'] = ['host', 'packages/*'];
        }),
        'stale-ignore-entry',
      )),
      'stale-group-member': top(() => releaseIntentFindings(
        releaseIntentConfiguredAs((config) => {
          config['linked'] = [['@fx/alpha', '@fx/gone']];
        }),
        'stale-group-member',
      )),
      // The reconciliation: written intent against derived classification.
      'unversionable-changeset': top(() =>
        releaseIntentFindings(
          { '.changeset/x.md': '---\n"host": minor\n---\n\nsomething\n' },
          'unversionable-changeset',
        ),
      ),
      // Issue #215 over this population. Moving the library tree does not empty
      // the walk — the four application manifests are still there and every
      // predicate still answers over them — so the floor is per workspace
      // entry, and it lives inside the analysis rather than in the printing.
      'short-walk-refusal': top(() =>
        releaseIntentRefusal(
          { 'packages/alpha/package.json': null, 'packages/beta/package.json': null },
          'residue of its population',
        ),
      ),
      // A pattern grammar it does not implement must be a refusal: reported as
      // matching nothing, `@(a|b)` would turn an ignored application into an
      // `unignored-application` finding and an over-broad extglob into silence.
      'unreadable-ignore-pattern': top(() => releaseIntentRefusal(
        releaseIntentConfiguredAs((config) => {
          config['ignore'] = ['{backend,admin}'];
        }),
        'glob grammar',
      )),
      // The `--since` finding, and the one the CLI structurally cannot produce:
      // a package whose `tsconfig.build.json` compiles an ignored application's
      // sources. The fixture is the pair of tsconfigs — `include` in the
      // extended one, exactly as !891 writes it — so the derivation runs.
      'unattributed-published-change': top(() =>
        publishedSurfaceFindings(
          HOST_SOURCED_PACKAGE,
          {
            baseline: 'origin/master',
            containedInBaseline: false,
            changedPaths: ['apps/host/src/kernel/settings/settings-cache.ts'],
            addedChangesets: [],
          },
          'unattributed-published-change',
        ),
      ),
      // A build configuration it cannot read must be a refusal: read as absent,
      // it says the package publishes nothing outside its own directory, which
      // is the answer that leaves the gate exactly as quiet as it was.
      'unreadable-build-configuration': top(() => {
        const tree = releaseIntentCheckout({ 'packages/alpha/tsconfig.build.json': null });
        const result = checkPublishedSurfaceIntent(RELEASE_INTENT_ROOT, tree.fs, tree.listChangesets, {
          baseline: 'origin/master',
          containedInBaseline: false,
          changedPaths: ['apps/host/src/a.ts'],
          addedChangesets: [],
        });
        return 'reason' in result && result.reason.includes('could not be read') ? 1 : 0;
      }),
      // Pipeline 11491, as a discrimination rather than as one assertion. An
      // empty diff is two facts, and the refusal belongs to exactly one of them:
      // a branch with a real fork point that changes no file is still exit 2 —
      // turning that into a pass is the shape issue #113 exists for — while a
      // branch the baseline already contains adds nothing to it by construction
      // and gets a verdict. Proving only the first would be satisfied by a
      // check that refuses both, which is the failure this repairs; proving only
      // the second would be satisfied by one that refuses neither, which is the
      // failure it must not become. So the fixture drives the same empty diff
      // twice, differing in one field, and both answers have to be right.
      'empty-diff-from-a-real-fork-point': top(() => {
        const emptyDiff = (containedInBaseline: boolean): BranchDiff => ({
          baseline: 'origin/master',
          containedInBaseline,
          changedPaths: [],
          addedChangesets: [],
        });
        const answer = (containedInBaseline: boolean) => {
          const tree = releaseIntentCheckout({});
          return checkPublishedSurfaceIntent(
            RELEASE_INTENT_ROOT,
            tree.fs,
            tree.listChangesets,
            emptyDiff(containedInBaseline),
          );
        };

        const refused = answer(false);
        const contained = answer(true);
        const refusesTheForkPoint =
          'reason' in refused && refused.reason.includes('changes no file at all');
        const answersTheMergedBranch =
          'contained' in contained && contained.contained.includes('already contained');
        return refusesTheForkPoint && answersTheMergedBranch ? 1 : 0;
      }),
    },
  },
];

// --- the enumeration --------------------------------------------------------

function scriptsMatching(dir: string, pattern: RegExp, prefix: string): string[] {
  return readdirSync(join(REPO_ROOT, dir))
    .filter((name) => pattern.test(name))
    .map((name) => `${prefix}${name}`)
    .sort();
}

describe('every static check is inventoried', () => {
  const listed = new Set(CHECKS.map((c) => c.script));

  it('names every check script in the tree', () => {
    const onDisk = [
      ...scriptsMatching('backend/scripts', /^check-.*\.ts$/, 'backend/scripts/'),
      ...scriptsMatching('scripts', /^check-.*\.sh$/, 'scripts/'),
    ];
    expect(onDisk.filter((script) => !listed.has(script))).toEqual([]);
  });

  it('names nothing that has been deleted or moved', () => {
    expect(CHECKS.filter((c) => !existsSync(join(REPO_ROOT, c.script))).map((c) => c.script)).toEqual(
      [],
    );
  });

  it('covers every check:* package script', () => {
    const backendScripts = JSON.parse(read('backend/package.json')) as {
      scripts: Record<string, string>;
    };
    const rootScripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const declared = [
      ...Object.keys(backendScripts.scripts),
      ...Object.keys(rootScripts.scripts),
    ].filter((name) => name.startsWith('check:'));
    const inventoried = new Set(CHECKS.map((c) => c.npmScript));
    expect(declared.filter((name) => !inventoried.has(name))).toEqual([]);
  });
});

describe('every check can go red', () => {
  // The heart of this file. Each proof runs the check's own analysis over an
  // input the repository does not contain: a check whose reach silently
  // narrows — a regex that stops matching, a walk scoped to a filename, an
  // alias it cannot follow — fails here, in the suite a developer runs, rather
  // than at the next incident.
  for (const check of CHECKS) {
    for (const [shape, proof] of Object.entries(check.red)) {
      it(`${check.script} reports a violation on a synthetic ${shape}`, () => {
        expect(proof.prove()).toBeGreaterThan(0);
      });
    }
  }
});

describe('every red proof enters at the top of the analysis', () => {
  // Issue #130: a proof handed a value the check normally *computes* leaves
  // every stage above it unproven, and that is precisely where the last two
  // defects sat. `PROOFS_ENTERING_BELOW` is the two-way ledger for the
  // exceptions, and it is empty.
  const drift = lowEntryDrift(CHECKS, PROOFS_ENTERING_BELOW);

  it('has no proof entering below the top that the ledger does not account for', () => {
    expect(drift.unledgered).toEqual([]);
  });

  it('has no ledger entry that no longer describes one', () => {
    expect(drift.stale).toEqual([]);
  });

  it('records how many shapes each check proves, so widening a check widens its proof', () => {
    // A check with a single proof is a claim that it refuses a single shape.
    // Recorded as a count so widening a check without widening its proof shows
    // up here as a diff rather than as nothing.
    const shapes = Object.fromEntries(
      CHECKS.map((check) => [check.script, Object.keys(check.red).length]),
    );
    expect(shapes).toEqual({
      // Four findings and the four vacuous reasons, plus both directions of the
      // route count — the ratchet's whole claim is that it fails either way.
      'backend/scripts/check-admin-registrations.ts': 9,
      // Two directions of a wrong code, three ways a target cannot be resolved,
      // and the ledger's stale direction.
      'backend/scripts/check-action-route-permissions.ts': 6,
      'backend/scripts/check-channel-resolution.ts': 5,
      // Five, plus D-89's five: `em.create` joining the vocabulary, the two
      // narrowings that keep it from manufacturing findings, the field
      // assignment the header says in writing it cannot see, and the staleness
      // half's new subtraction.
      'backend/scripts/check-command-coverage.ts': 10,
      'backend/scripts/check-container-imports.ts': 5,
      // Two decomposing forms, four spellings of the strip, the strip standing
      // alone, five exclusions proven as discriminations, the ledger's stale
      // direction, and the guard that is the exemption itself. The population
      // widened to the whole tree when the fold became reachable from it, so
      // one discrimination turned into two: the packages that are now in, and
      // the two subtrees that stay out because spelling the refused shape is
      // their job.
      //
      // Plus issue #244's eleven, for the third signal: four shapes of a slug
      // run (no fold at all, a correct fold, a two-move collapse, the `\w`
      // shorthand), four discriminations that are the honest population itself
      // (a one-for-one substitution, a deleted run, a Unicode-aware class, a
      // collapse split across statements), the second ledger's stale direction,
      // the generator's path-anchored exemption, and the guard's third shape.
      // The four discriminations are why the count grew by eleven rather than
      // four: this predicate's whole claim is that its ledger is not a list of
      // exceptions, and that claim is only worth what its negative proofs are.
      'backend/scripts/check-diacritic-folds.ts': 25,
      // Three snippet shapes, the discovery that enrols a document, and
      // T010's root floor — the population one level above the discovery.
      'backend/scripts/check-doc-snippets.ts': 5,
      // The two in-tree shapes — none and more than one — plus T034's two: a
      // package's persisted entity is in the population, and a package that
      // could not be enumerated stops the run instead of being credited with
      // none. Without the second, package awareness would be a map that can
      // answer "no owner" in silence, which is the defect it exists to remove.
      'backend/scripts/check-entity-tenant-classification.ts': 4,
      // Three timer shapes plus D-68's four boot-hook ones. The count is the
      // point: the check grew a construct, so its proof had to grow with it.
      'backend/scripts/check-entry-presence.ts': 7,
      // Five, plus issue #237's five: the two site classes a file-level
      // population could not hold (a pub/sub handler, a process-lifecycle
      // handler), the two discriminations that are the granularity itself — an
      // unscoped site reported while its sibling stays scoped, at site level and
      // at file level — and the ledger's stale direction, which a per-site key
      // can break without breaking anything else.
      'backend/scripts/check-entry-scope.ts': 10,
      // P1's two — a code missing in both languages and in one — plus P2's
      // three kinds (feature 082, D-127). The fourth fixture D-127 requires is
      // the discrimination one, which asserts **zero** findings and therefore
      // cannot be a red proof; it is in the companion test.
      // Plus T010's one: the population floor under the bundle walk, which is
      // a refusal rather than a finding and fires before either predicate runs.
      'backend/scripts/check-error-translations.ts': 6,
      // Three shapes the read reaches the fallback through, four fabrications
      // the fallback performs; the two axes are independent, so the count is
      // their union rather than their product. Plus issue #275's five: three
      // binding shapes the pass could not see (array, object, destructuring
      // assignment) and two builder dialects that name no read where the walk
      // was looking. The binding axis is a third one, orthogonal to both the
      // others — the two live sites it hid were `execute` reads, in a dialect
      // the check had recognised since the day it landed.
      'backend/scripts/check-fixture-substitution.ts': 11,
      'backend/scripts/check-harness-teardown.ts': 8,
      'backend/scripts/check-kernel-boundary.ts': 3,
      // Two spellings of the lock claim, the one that never writes the word,
      // the converse, and the derivation that has to move with the manifests.
      // Plus issue #279's one for the source the population was missing: a
      // claim in a published contract, entering as a tree because the other
      // five enter below the walk that decides which files are read at all.
      'backend/scripts/check-lock-claims.ts': 6,
      // Thirteen, plus D-77's three permanence shapes: the flag removes an
      // entry from `ledger-size`, so a check that stopped refusing an
      // unjustified one would let the residue be lowered by declaration. Plus
      // D-87's nine for the second predicate — five shapes it must see and four
      // it must not, the four proven as discriminations because "no finding"
      // cannot go red on its own. Plus issue #187's six for the builder path,
      // every one of them asserting `syntax: 'builder'`, because a proof that
      // only named the table would go green off the statement path it is not
      // testing. Plus issue #217's one: a shard that declares its own entry
      // type, which is what kept the three permanence shapes above from ever
      // running over 29 of the 33 shards. Plus issue #267's three: the key
      // answers "is this file already known to reach that target" and not "how
      // much", so a count too low, a count too high and a count that is no
      // number are the three ways an entry can stop describing its own file.
      // Plus T034's two for the third owner-map source: a table an installed
      // package owns is a finding, and a package may not take a core table's
      // attribution away from the module that owns it. Plus feature 080's one:
      // a module that has become a package is reached by a bare specifier, and
      // the shape was invisible for as long as the header said no such package
      // existed. Plus D-171's three: a subpath whose emitted module exports
      // nothing is contract surface and not debt, the same subpath counts again
      // the moment a runtime binding appears on it, and a declared subpath whose
      // emitted module cannot be read is refused rather than exempted — the one
      // direction in which issue #113's silence grants standing instead of
      // withholding it.
      'backend/scripts/check-module-boundary.ts': 50,
      // Six shapes it must see — including a NUL past git's own 8000-byte
      // window, which is what an implementation copying git's heuristic would
      // stop seeing — and two exclusions proven as discriminations. Plus issue
      // #248's two, one per anchoring, which are the only proofs here that
      // enter as a tree on disk rather than as bytes: a directory exclusion is
      // a decision the walk takes, and a record list is its output.
      'backend/scripts/check-nul-bytes.ts': 11,
      // Three ways an artefact can be wrong, plus the fourth verdict's four
      // (feature 080, T030a): the leak, the two discriminations it must not get
      // backwards — a workspace member is not a foreign package, a core-tree
      // entry is not either — and the containment floor.
      'backend/scripts/check-overlay-determinism.ts': 7,
      // Five, plus D-88's four: two shapes the backward hop now refuses and two
      // it must not follow. The last two are the limit — a free function in
      // another file, and a class method shadowing a module-scoped alias — and
      // a limit nothing proves is a limit that quietly moves. Plus issue #278's
      // three, which are about *visibility* rather than reach: the two
      // collisions the scoping rules now refuse, and — pointing the other way —
      // the call-bound local that must go on being a finding, because "the
      // analysis cannot follow this" is not "this is not a port".
      'backend/scripts/check-port-catches.ts': 13,
      // Plus T034's one: a name an installed package owns is an undeclared
      // edge, not the consumer's wiring bug the short map reported. Plus the
      // 2026-08-25 ruling's three for the `refuses-without` rail: a refusal
      // claimed over a name nothing gates, one claimed beside the bind that
      // makes it false, and one carrying nothing for the operator to read —
      // the last two entering through `ModuleManifestSchema` rather than
      // `defineModuleManifest`, which is the only route they have.
      'backend/scripts/check-port-dependencies.ts': 23,
      // Two for the optional-method rule: the published port and the interface
      // widening one, which is exactly where it bites. Plus issue #192's three
      // for the container-name signal — the two shapes a wrong name takes, and
      // the ledger's stale direction. The name signal's second shape asserts the
      // documented name's *registration kind*, not just the finding: "the
      // contract points at an ungated registration" is the defect, and a proof
      // that dropped that field would go green on a check that had stopped
      // telling plain from gated.
      // Five, plus D-98.2's three: the finding, the cradle-versus-`lazyPort`
      // discrimination — counted as a proof of its own because a signal that
      // reported the contribution seams would be turned off within a week, and
      // one that saw neither shape would read identically green — and the
      // resolution ledger's stale direction.
      // Four findings, the ledger's two stale directions, and the two refusals.
      // The refusals are proofs rather than bookkeeping: both make the published
      // surface come back **short**, which is the direction that reports *more*
      // findings, so neither would ever be noticed as a defect — an author would
      // read the extra finding as real and widen the barrel to clear it.
      'backend/scripts/check-platform-surface.ts': 9,
      // Plus D-171.1's two: the condition consumer-side declaration is
      // licensed against, and the discrimination that keeps it from firing on
      // the correct case. The second is a proof of its own because a signal
      // that reported every provider — or none — reads identically green on the
      // tree, which today declares four module ports and refuses none of them.
      'backend/scripts/check-port-shape.ts': 10,
      // Eight findings, plus the two refusals that are decisions rather than
      // printing: the short walk (issue #215 over a workspace, where losing the
      // library glob leaves four application manifests answering every
      // question) and a pattern grammar it does not implement. `version-disabled`
      // gets two, because the value that produces the defect arrives twice —
      // written as `false`, and by deleting a block that reads as boilerplate.
      // Plus D-162's two for `--since`: the ninth finding, and the build
      // configuration it could not read, which read as absent would say the
      // package publishes nothing outside its own directory. The fourteenth is
      // pipeline 11491's discrimination — an empty diff from a real fork point
      // is still a refusal, and an already-merged branch is a verdict — driven
      // as one proof because either half alone is satisfied by a check that
      // answers both the same way.
      'backend/scripts/check-release-intent.ts': 14,
      // Three spellings of a whole-table wipe, plus the baseline's second
      // direction.
      'backend/scripts/check-shared-table-wipes.ts': 4,
      // Three findings — the composed singleton reached two ways it is derived
      // (the container and the ORM's entities array), the reach that names no
      // binding, and T061a's chain parent, which carries two of its own because
      // the shape has two halves that fail differently: the transitive reach,
      // and the reach sitting in a helper whose own closure loads no artefact.
      // Plus the ledger's stale direction, plus the refusal that keeps the
      // chain population honest, plus one control per conjunct and one for the
      // narrowing. The controls are counted shapes rather than companion-test
      // detail because the conjunction *is* the rule: this check clears every
      // reach into a package's source that its run prints as `sites=`, bar the
      // handful it refuses, and a proof set that only showed the refusal would
      // not show it is the right check.
      'backend/scripts/check-singleton-identity.ts': 10,
      // Three spellings of a bare subscription, plus the two queue-consumer
      // shapes: a factory call whose value goes nowhere, and a `new Worker` the
      // module keeps to itself.
      'backend/scripts/check-subscribe-seam.ts': 5,
      // Two shapes, two scopes, and the ledger's stale direction.
      'backend/scripts/check-transaction-context.ts': 5,
      'backend/scripts/i18n-hardcoded-strings.ts': 2,
      // Four rules, the fifth (migration class scope) that reads the
      // filesystem, and issue #244's short listing — the shape every one of
      // this script's other floors is green on. Plus feature 080's three for
      // the resolved module root: the two shapes it refuses, and the moved tree
      // it follows, which is the one a pair of refusals cannot prove. Plus two
      // for the nested checkout: the outer root resolved past one, and the
      // refusal that must survive it rather than fall back to it.
      'scripts/check-naming.sh': 11,
      // Two scopes, the short listing both of them are read out of, and the
      // four this script gained when its module root stopped being spelled:
      // the two refusals, the moved tree, and the nested checkout.
      'scripts/check-language.sh': 7,
      'scripts/check-pdfmake-footprint.sh': 2,
    });
  });
});

describe('every check refuses a vacuous pass', () => {
  // A check may spell the refusal itself or delegate it to
  // `scripts/lib/module-population.ts`, which loads the registry, compares it
  // with the walk and exits 2 (issue #215). Nine do delegate: nine copies of an
  // exit-2 guard would be nine chances to write the one that returns, and a
  // guard written wrong is invisible by construction — the check reports green
  // either way. So the text below accepts the delegation by name, and the
  // behaviour is pinned in `moved-module-tree.test.ts` rather than here.
  const DELEGATED = /refuseVacuousModulePopulation|vacuousModulePopulation/;

  for (const check of CHECKS) {
    it(`${check.script} carries the guard the inventory claims`, () => {
      const source = read(check.script);
      // Presence, not behaviour: the behavioural half is the companion test,
      // which runs the check over an input it never read and reads the exit code.
      expect(source, `${check.script} names no vacuous-pass guard`).toMatch(
        /vacuous|Vacuous/,
      );
      if (check.vacuousGuard === 'exit-2') {
        expect(source, `${check.script} should exit 2, not 0 or 1`).toMatch(
          new RegExp(`exit\\(2\\)|exit 2|${DELEGATED.source}`),
        );
      }
      if (check.residueGuard === 'derived-population') {
        expect(
          source,
          `${check.script} walks the module tree, so it must derive its expected ` +
            'population from the manifest index rather than test the walk for emptiness',
        ).toMatch(DELEGATED);
      }
    });
  }
});

describe('a check whose population is the module tree proves it read the tree', () => {
  // Issue #215's two-way link. The behavioural proof is a spawn over a fixture
  // backend whose module sources are gone and whose registry still lists them;
  // it is expensive enough to live in one file, and that file is exactly what a
  // future edit would delete without noticing. Both directions therefore fail
  // here: a check marked `derived-population` and absent from the proof file,
  // and a script the proof file names that the inventory does not mark.
  const PROOF_FILE = 'backend/test/unit/scripts/moved-module-tree.test.ts';
  const proof = read(PROOF_FILE);
  const basenameOf = (script: string): string => script.slice(script.lastIndexOf('/') + 1);

  it('has a moved-tree proof for every check whose population is the module tree', () => {
    const unproven = CHECKS.filter((c) => c.residueGuard === 'derived-population')
      .map((c) => basenameOf(c.script))
      .filter((name) => !proof.includes(`'${name}'`));
    expect(unproven, `${PROOF_FILE} does not spawn: ${unproven.join(', ')}`).toEqual([]);
  });

  it('marks every check that proof file spawns', () => {
    const spawned = [...proof.matchAll(/script: '(check-[a-z-]+\.ts)'/g)].map((m) => m[1]!);
    const marked = new Set(
      CHECKS.filter((c) => c.residueGuard === 'derived-population').map((c) =>
        basenameOf(c.script),
      ),
    );
    const unmarked = spawned.filter((name) => !marked.has(name));
    expect(unmarked, `proven in ${PROOF_FILE} but unmarked here: ${unmarked.join(', ')}`).toEqual(
      [],
    );
  });
});

/**
 * Checks that do not yet print what they read, with what it would take.
 *
 * **Two-way**, and empty: all twenty-seven print a read line today. An entry
 * here is a check whose green still cannot be told from a check that read
 * nothing, which is the family issue #244 closes — so an entry is a statement
 * that one member of the family is still live, not a to-do.
 */
const READ_SIZE_DEFERRED: Readonly<Record<string, string>> = {};

describe('every check says how much it read (issue #244)', () => {
  // The other half of "a green means something". The rest of this file proves
  // each check can still see a violation; none of it can tell a clean tree from
  // a population that quietly emptied — and that is what the last seven defects
  // were. Each check therefore prints its input size in one grammar, and
  // `test/helpers/check-read-sizes.ts` records what that line says on this
  // tree. The behavioural half — spawning each check and comparing — is
  // `check-read-size.test.ts`, for the same reason the moved-tree proof is its
  // own file: twenty-seven spawns are too slow to sit in a file a developer
  // runs constantly.
  const RECORDS_FILE = 'backend/test/helpers/check-read-sizes.ts';
  const RATCHET_FILE = 'backend/test/unit/scripts/check-read-size.test.ts';
  const reported = CHECKS.filter((check) => check.readSize === 'reported');

  it('has a recorded read size for every check that reports one', () => {
    const unrecorded = reported
      .map((check) => check.script)
      .filter((script) => !(script in RECORDED_READ_SIZES));
    expect(unrecorded, `${RECORDS_FILE} records nothing for: ${unrecorded.join(', ')}`).toEqual([]);
  });

  it('records nothing for a check the inventory does not name', () => {
    const listed = new Set(CHECKS.map((check) => check.script));
    expect(Object.keys(RECORDED_READ_SIZES).filter((script) => !listed.has(script))).toEqual([]);
  });

  it('names the shared reporter in the script itself', () => {
    // Presence, not behaviour: a private `console.log` that happened to spell
    // the grammar would drift from it, and the point of a shared reporter is
    // that the ratchet parses one shape for twenty-seven checks.
    const missing = reported
      .filter((check) => !/reportReadSize|read_size_report/.test(read(check.script)))
      .map((check) => check.script);
    expect(missing, `these do not call the shared reporter: ${missing.join(', ')}`).toEqual([]);
  });

  it('reconciles against the manifest index wherever the population is the module tree', () => {
    // The floor cannot be self-reported (issue #215): a check that computes its
    // own population and then prints it has said the same thing twice. Where an
    // independent derivation exists it must be named on the read line — and for
    // a module walk it always exists. The converse is deliberately not asserted:
    // the two shell checks reconcile against the same index while staying
    // `not-a-module-walk` here, because `moved-module-tree.test.ts` spawns tsx
    // scripts over a fixture backend and a shell check needs a git work tree.
    const unreconciled = CHECKS.filter((check) => check.residueGuard === 'derived-population')
      .filter((check) => !(RECORDED_READ_SIZES[check.script]?.sources ?? []).includes('manifest-index'))
      .map((check) => check.script);
    expect(unreconciled).toEqual([]);
  });

  it('has a reason for every check that discloses nothing', () => {
    const undeclared = CHECKS.filter((check) => check.readSize === 'deferred')
      .map((check) => check.script)
      .filter((script) => READ_SIZE_DEFERRED[script] === undefined);
    expect(undeclared).toEqual([]);
  });

  it('has no deferral entry for a check that discloses its read size', () => {
    const stale = Object.keys(READ_SIZE_DEFERRED).filter(
      (script) => CHECKS.find((check) => check.script === script)?.readSize !== 'deferred',
    );
    expect(stale).toEqual([]);
  });

  it('is ratcheted by a file that drives the records rather than a copy of them', () => {
    // The two-way link, in the idiom `residueGuard` uses for the moved-tree
    // proof: the expensive half lives elsewhere and is exactly what a future
    // edit would delete without noticing.
    const ratchet = read(RATCHET_FILE);
    expect(ratchet).toContain('RECORDED_READ_SIZES');
    expect(ratchet).toContain('parseReadSize');
  });
});

describe('every check has a companion test that exercises it', () => {
  for (const check of CHECKS) {
    it(`${check.script} → ${check.companionTest}`, () => {
      expect(existsSync(join(REPO_ROOT, check.companionTest))).toBe(true);
      const test = read(check.companionTest);
      const basename = check.script.slice(check.script.lastIndexOf('/') + 1);
      const stem = basename.replace(/\.(ts|sh)$/, '');
      // The test must actually name the script — a file that merely sits at the
      // path proves nothing, which is the failure mode this whole file is about.
      expect(test, `${check.companionTest} never mentions ${stem}`).toContain(stem);
    });
  }
});

describe('the inventory agrees with the CI jobs', () => {
  const ci = read('.gitlab-ci.yml').split('\n');

  /**
   * The commands a job runs — the `- …` entries of its block, comments
   * dropped. Slicing the raw text between two job headers reads the prose
   * around them too, and those comments name half the checks: it made
   * `check:naming` look like part of the `quality` job because the paragraph
   * above `quality:static` mentions it.
   */
  function jobCommands(job: string): string {
    const start = ci.indexOf(`${job}:`);
    if (start === -1) return '';
    const rest = ci.slice(start + 1);
    const end = rest.findIndex((line) => /^\S/.test(line));
    return rest
      .slice(0, end === -1 ? rest.length : end)
      .filter((line) => line.trim().startsWith('- '))
      .join('\n');
  }

  const qualityBlock = jobCommands('quality');
  const staticBlock = jobCommands('quality:static');

  const mentions = (block: string, check: CheckEntry): boolean => {
    const basename = check.script.slice(check.script.lastIndexOf('/') + 1);
    return block.includes(basename) || (check.npmScript !== null && block.includes(check.npmScript));
  };

  it('reads a quality job and a quality:static job out of the pipeline', () => {
    expect(qualityBlock.length).toBeGreaterThan(300);
    expect(staticBlock.length).toBeGreaterThan(50);
  });

  for (const check of CHECKS) {
    it(`${check.script} runs in ${check.job}`, () => {
      expect(mentions(qualityBlock, check), 'quality job').toBe(check.job === 'quality');
      expect(mentions(staticBlock, check), 'quality:static job').toBe(check.job === 'quality:static');
    });
  }
});
