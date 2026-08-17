import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  analyzeSource as channelAnalyze,
  type Violation as ChannelViolation,
} from '../../../scripts/check-channel-resolution.js';
import { analyzeSource as commandCoverageAnalyze } from '../../../scripts/check-command-coverage.js';
import { analyzeSource as containerAnalyze } from '../../../scripts/check-container-imports.js';
import {
  checkDocument,
  discoverCitingDocuments,
} from '../../../scripts/check-doc-snippets.js';
import {
  analyzeSource as classificationAnalyze,
  ENTITY_DECORATOR_HINT,
} from '../../../scripts/check-entity-tenant-classification.js';
import {
  analyzeSource as entryScopeAnalyze,
  violationsOf,
  type EntryKind,
} from '../../../scripts/check-entry-scope.js';
import { findUntranslatedErrorCodes } from '../../../scripts/check-error-translations.js';
import { checkHarnessTeardown } from '../../../scripts/check-harness-teardown.js';
import {
  analyzeClosure,
  analyzePlatformImports,
  analyzeSource as boundaryAnalyze,
  isImportViolation,
  isViolation,
  RELATION_DECORATOR_HINT,
} from '../../../scripts/check-kernel-boundary.js';
import { compareArtifact } from '../../../scripts/check-overlay-determinism.js';
import { checkPortCatches } from '../../../scripts/check-port-catches.js';
import {
  findViolations,
  ledgerReads,
  providedPortNames,
  resolvedNames,
  type PortResolution,
  type PortViolation,
} from '../../../scripts/check-port-dependencies.js';
import { buildDeactivationLedger } from '../../../src/modules/_lifecycle/services/deactivation-ledger.js';
import { checkSubscribeSeam } from '../../../scripts/check-subscribe-seam.js';
import {
  checkTimerPresence,
  type TimerConstruct,
} from '../../../scripts/check-timer-presence.js';
import { analyzeSource as hardcodedAnalyze } from '../../../scripts/i18n-hardcoded-strings.js';
import {
  lowEntryDrift,
  type ProofEntry,
  type ProvenCheck,
} from '../../helpers/check-proof-entry.js';
import { createShellCheckFixture } from '../../helpers/shell-check-fixture.js';

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

/** The fixture enters the check where a real run does: source text in, findings out. */
const top = (prove: () => number): RedProof => ({ enters: 'top', prove });

// --- fixtures the red proofs run on ----------------------------------------

const MODULE_FILE = join(BACKEND_ROOT, 'src/modules/blog/backend.ts');
const SEARCH_ENTITY = join(BACKEND_ROOT, 'src/modules/search/entities/search-phrase-record.entity.ts');
const KERNEL_FILE = join(BACKEND_ROOT, 'src/kernel/thing.ts');
const CROSS_MODULE_RELATION = [
  "import { Category } from '../../catalog/entities/category.entity.js';",
  '@Entity()',
  'export class SearchPhraseRecord {',
  '  @ManyToOne(() => Category, { fieldName: "category_id" })',
  '  category!: Category;',
  '}',
].join('\n');

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
 * A repeating timer built from `setTimeout`, in a file that opens no scope. The
 * red proof runs through `analyzeSource` rather than `violationsOf` alone
 * (issue #128): the blindness was in the **classifier**, which grepped for
 * `setInterval(` and so kept this file out of the population entirely — a
 * violation list can only stay empty for something it was never handed.
 */
const UNSCOPED_SELF_RESCHEDULING = `
  const scheduleNext = (delayMs) => { timer = setTimeout(tick, delayMs); };
  const tick = () => { void reindex().then(() => scheduleNext(60000)); };
`;

/**
 * Entry points in one synthetic file that establish no scope and are not exempt.
 *
 * `kind` is asserted, not merely counted: the classifier is what went blind in
 * issue #128, and it fails by putting a file in the wrong class as readily as by
 * dropping it.
 */
function unscopedEntryPoints(file: string, source: string, kind: EntryKind): number {
  const entry = entryScopeAnalyze(file, source);
  return violationsOf(entry === null ? [] : [entry]).filter((e) => e.kind === kind).length;
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
function handReleases(file: string, source: string, resource: string): number {
  return checkHarnessTeardown({ sources: new Map([[file, source]]) }, {}).violations.filter(
    (v) => v.resource === resource,
  ).length;
}

/** The `let h: BackendServerHandle` + `beforeAll` shape every converted file uses. */
const HANDLE_DECLARED = 'let h: BackendServerHandle;\n';

/** Ungated uncatchable entry points of one construct, in one synthetic file. */
function ungatedTimers(file: string, source: string, construct: TimerConstruct): number {
  return checkTimerPresence({ sources: new Map([[file, source]]) }, {}).violations.filter(
    (v) => v.construct === construct,
  ).length;
}

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

// --- the inventory ----------------------------------------------------------

const CHECKS: readonly CheckEntry[] = [
  {
    // Four signals in the header, so four proofs — signal 4 carries both of the
    // positions it was widened to see (D-48), which is the pair signal 3 could
    // not reach.
    script: 'backend/scripts/check-channel-resolution.ts',
    npmScript: 'channel:resolution',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-channel-resolution.test.ts',
    vacuousGuard: 'exit-2',
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
    },
  },
  {
    script: 'backend/scripts/check-entity-tenant-classification.ts',
    npmScript: null,
    job: 'quality',
    companionTest: 'backend/test/unit/tenancy/classification-check.test.ts',
    vacuousGuard: 'exit-2',
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
    },
  },
  {
    script: 'backend/scripts/check-entry-scope.ts',
    npmScript: 'check:entry-scope',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/entry-scope-check.test.ts',
    vacuousGuard: 'exit-2',
    red: {
      cli: top(() =>
        unscopedEntryPoints(
          '/repo/backend/src/modules/search/scripts/reindex.ts',
          'void main();',
          'cli',
        ),
      ),
      worker: top(() =>
        unscopedEntryPoints(
          '/repo/backend/src/modules/search/workers/index-worker.ts',
          "const worker = new Worker('search.index', handle);",
          'worker',
        ),
      ),
      'interval-setInterval': top(() =>
        unscopedEntryPoints(
          '/repo/backend/src/modules/search/plugin.ts',
          'setInterval(() => { void reindex(); }, 60000);',
          'interval',
        ),
      ),
      // The spelling the classifier could not see until issue #128.
      'interval-self-rescheduling': top(() =>
        unscopedEntryPoints(
          '/repo/backend/src/modules/search/plugin.ts',
          UNSCOPED_SELF_RESCHEDULING,
          'interval',
        ),
      ),
    },
  },
  {
    script: 'backend/scripts/check-error-translations.ts',
    npmScript: 'check:error-translations',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-error-translations.test.ts',
    vacuousGuard: 'exit-2',
    red: {
      'missing-in-both-languages': top(
        () =>
          findUntranslatedErrorCodes({
            keys: { BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' } },
            readBundle: () => ({}),
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
          }).length,
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
    red: {
      'rule-a-cross-module-relation': top(() =>
        relationViolations(CROSS_MODULE_RELATION, SEARCH_ENTITY),
      ),
      'rule-b-platform-import': top(
        () =>
          analyzePlatformImports(
            "import { blogService } from '../modules/blog/services/blog.service.js';\n",
            KERNEL_FILE,
          ).filter(isImportViolation).length,
      ),
      'rule-c-closure': top(() => {
        const sources: Record<string, string> = {
          [join(BACKEND_ROOT, 'src/kernel/index.ts')]: "export { a } from './hop.js';\n",
          [join(BACKEND_ROOT, 'src/kernel/hop.ts')]:
            "import { b } from '../modules/blog/services/blog.service.js';\n",
        };
        return analyzeClosure({
          roots: [join(BACKEND_ROOT, 'src/kernel/index.ts')],
          read: (file) => sources[file] ?? null,
        }).violations.length;
      }),
    },
  },
  {
    // `compareArtifact` is the top of what this script analyses: the rendering
    // belongs to `generate-composer.ts`, which has its own tests, and the one
    // way a broken generator could reach this check silently — rendering
    // nothing, since two empty strings compare equal — is the third proof.
    script: 'backend/scripts/check-overlay-determinism.ts',
    npmScript: 'overlay:check',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-overlay-determinism.test.ts',
    vacuousGuard: 'verdict',
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
    },
  },
  {
    // The three ways a gated port is reached, from the check's own header: its
    // own name, a module-local `lazyPort` alias, and a deps-object key — the
    // last being 121 of the tree's ~130 `lazyPort` calls.
    script: 'backend/scripts/check-port-catches.ts',
    npmScript: 'check:port-catches',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-catch-check.test.ts',
    vacuousGuard: 'exit-2',
    red: {
      'port-own-name': top(() => checkPortCatches({ sources: PORT_CATCH_TREE }, {}).violations.length),
      'local-alias': top(
        () => checkPortCatches({ sources: PORT_CATCH_ALIAS_TREE }, {}).violations.length,
      ),
      'deps-object-key': top(
        () => checkPortCatches({ sources: PORT_CATCH_DEPS_TREE }, {}).violations.length,
      ),
    },
  },
  {
    // Two analyses in one script since feature 074 — the ownership rule and the
    // deactivation-consequence ledger — and both are fed here by the **scanner**
    // rather than by a hand-built resolution list (issue #130). The blindness
    // this check has actually suffered was in `resolvedNames`: a `port(ctx,
    // name)` helper hid fourteen resolutions, several registered by nobody,
    // while the rule below them read clean.
    script: 'backend/scripts/check-port-dependencies.ts',
    npmScript: 'check:port-dependencies',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-dependency-check.test.ts',
    vacuousGuard: 'exit-2',
    red: {
      'undeclared-dependency': top(() =>
        portViolations(ORDERS_RESOLVES_AT_CALL, PAYMENT_PORTS, 'undeclared-dependency'),
      ),
      'unowned-name': top(() =>
        portViolations(ORDERS_RESOLVES_UNOWNED, PAYMENT_PORTS, 'unowned-name'),
      ),
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
            contributionPolicies: {},
            excludedNames: new Set(),
          }).unassigned.length,
      ),
    },
  },
  {
    // Three signals, and the fixture for each names only its own: a bus-shaped
    // receiver with an event name no signal 3 would match, a domain event off a
    // receiver no signal 1 would match, and a cast around a bus. Written as one
    // `eventBus.on('a.b.v1', …)` the fixture satisfies two signals at once, so
    // either could go blind behind the other.
    script: 'backend/scripts/check-subscribe-seam.ts',
    npmScript: 'check:subscribe-seam',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/subscribe-seam-check.test.ts',
    vacuousGuard: 'exit-2',
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
    },
  },
  {
    // The three constructs the header says it can see. The middle one is the
    // shape issue #128 found hiding from the sibling check.
    script: 'backend/scripts/check-timer-presence.ts',
    npmScript: 'check:timer-presence',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-timer-presence.test.ts',
    vacuousGuard: 'exit-2',
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
    // Four rules in the script's header, four proofs. The route-segment rule had
    // no red fixture anywhere until issue #130.
    script: 'scripts/check-naming.sh',
    npmScript: 'check:naming',
    job: 'quality:static',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
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
    },
  },
  {
    // Two scopes, and only two: source-code comments and `docs/docs/**` pages.
    script: 'scripts/check-language.sh',
    npmScript: 'check:language',
    job: 'quality:static',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
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
      'backend/scripts/check-channel-resolution.ts': 5,
      'backend/scripts/check-command-coverage.ts': 3,
      'backend/scripts/check-container-imports.ts': 5,
      'backend/scripts/check-doc-snippets.ts': 4,
      'backend/scripts/check-entity-tenant-classification.ts': 2,
      'backend/scripts/check-entry-scope.ts': 4,
      'backend/scripts/check-error-translations.ts': 2,
      'backend/scripts/check-harness-teardown.ts': 8,
      'backend/scripts/check-kernel-boundary.ts': 3,
      'backend/scripts/check-overlay-determinism.ts': 3,
      'backend/scripts/check-port-catches.ts': 3,
      'backend/scripts/check-port-dependencies.ts': 5,
      'backend/scripts/check-subscribe-seam.ts': 3,
      'backend/scripts/check-timer-presence.ts': 3,
      'backend/scripts/i18n-hardcoded-strings.ts': 2,
      'scripts/check-naming.sh': 4,
      'scripts/check-language.sh': 2,
      'scripts/check-pdfmake-footprint.sh': 2,
    });
  });
});

describe('every check refuses a vacuous pass', () => {
  for (const check of CHECKS) {
    it(`${check.script} carries the guard the inventory claims`, () => {
      const source = read(check.script);
      // Presence, not behaviour: the behavioural half is the companion test,
      // which runs the check over an empty input and reads the exit code.
      expect(source, `${check.script} names no vacuous-pass guard`).toMatch(/vacuous/);
      if (check.vacuousGuard === 'exit-2') {
        expect(source, `${check.script} should exit 2, not 0 or 1`).toMatch(/exit\(2\)|exit 2/);
      }
    });
  }
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
