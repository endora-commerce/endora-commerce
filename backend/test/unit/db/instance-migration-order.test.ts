import { describe, expect, it } from 'vitest';
import { ChannelMemberEntityTypeSchema } from '@endora-commerce/contracts';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';
import { coreModuleDependencies } from '../../../src/db/configured-migrations.js';
import { BASELINE_THROUGH, type MigrationRegistryEntry } from '@endora-commerce/platform/db';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import {
  buildTableOwners,
  collectSchemaFiles,
  schemaKeyOf,
  sourcesOf,
} from '../../../scripts/check-module-boundary.js';
import { loadPackageDeclarations } from '../../../scripts/lib/package-declarations.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { TABLE_OWNER_OVERRIDES } from './table-owner-overrides.js';
import {
  bridgeOwnershipViolations,
  closureViolations,
  compareOrders,
  describeClosureViolation,
  forwardReferences,
  instanceEntries,
  instanceOrder,
  legacyBaselineOf,
  channelBridgesFrom,
  migrationSourceOf,
  parseChannelBridgeDeclarations,
  readChannelBridgeDeclarations,
  readMigrationSources,
  totalBridgeMaps,
  describeOwnerMapDisagreement,
  ownerMapDisagreements,
  ownerMapRefusals,
  reconcileBaseline,
  refusals,
  repositoryOrder,
  stampOf,
  type ChannelBridge,
  type ChannelBridgeDeclaration,
  type MigrationSource,
} from '../../helpers/instance-migration-order.js';

/**
 * FR-019 — the migration order an instance computes is the order this
 * repository computes.
 *
 * Normative:
 * `specs/110-instance-repository/contracts/instance-migration-order.md`. §3 is
 * this file, assertion by assertion; the analysis is
 * `test/helpers/instance-migration-order.ts`, so every fixture below enters at
 * the top of it — a registry and a manifest graph — and never as a pre-computed
 * order (issue #130).
 *
 * ## What was wrong, and what this file was red on
 *
 * `isBaseline` decided membership of the frozen historical prefix as
 * `origin === 'core' && timestamp <= BASELINE_THROUGH`. Both conditions are
 * individually right. Their conjunction encodes *"came out of this
 * repository's build"* and was being used to mean *"is one of the migrations
 * whose order is history"* — two things that coincide exactly while every
 * module is compiled into the application and come apart completely the moment
 * a module is installed, because a package's entries are tagged
 * `origin: 'external'` deliberately.
 *
 * On `master@fdcef45ea`, with the real registry and the real manifest graph:
 * the prefix fell from **112** entries to **11**, **181 of 182** positions
 * moved, the first divergence was at index **1**, and six migrations — three of
 * them `core`'s — landed before the migration that creates a table they touch.
 * `Migration20260505T102206AssetsLibraryInit` moved from position 33 to 19,
 * ahead of the `cms` migration that creates the table it indexes, which is the
 * `relation "cms_pages" does not exist` this file's G3 measures.
 *
 * The repair is R1.1: the prefix is a **published, generated list of class
 * names** carried by `@endora-commerce/platform`, and membership is by
 * **identity**. G1 is what says it worked, and it needs no SQL, no owner map
 * and no database.
 *
 * ## Why the legacy predicate is still driven here
 *
 * Because after the repair `orderMigrations` reads no origin at all, so the two
 * regimes are one function over inputs that differ in a field nothing consults
 * — and a guard comparing that against itself proves nothing. The first
 * assertion in G1 therefore keeps the *unrepaired* predicate as an input
 * (`legacyBaselineOf`) and measures the divergence it produces, over the real
 * artefacts. That is what makes the second assertion mean something: the two
 * regimes are demonstrably distinguishable, and they agree because of the
 * repair rather than because nothing could tell them apart.
 */

const MODULE_DEPENDENCIES = coreModuleDependencies();
const SOURCES = await readMigrationSources();
const CHANNEL_VOCABULARY = [...ChannelMemberEntityTypeSchema.options];
const BRIDGE_DECLARATIONS = await readChannelBridgeDeclarations();
const CHANNEL_BRIDGES = channelBridgesFrom(BRIDGE_DECLARATIONS);

const REAL = {
  entries: MIGRATION_REGISTRY,
  moduleDependencies: MODULE_DEPENDENCIES,
  baseline: BASELINE_MIGRATIONS,
} as const;

/** Builds a class whose `.name` is exactly the supplied migration name. */
function migrationClass(name: string): MigrationRegistryEntry['cls'] {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationRegistryEntry['cls'];
}

function entry(moduleId: string, name: string, origin?: 'core' | 'external'): MigrationRegistryEntry {
  return { moduleId, cls: migrationClass(name), ...(origin ? { origin } : {}) };
}

describe('instance migration order — the run refuses rather than reporting a vacuous pass', () => {
  it('has something to measure: a frozen prefix, a graph with edges, and every source read', () => {
    expect(
      refusals({ ...REAL, sources: SOURCES }),
      'this guard reported over a population one of whose halves is empty',
    ).toEqual([]);
  });

  it('refuses a registry with no entry at or below the watermark', () => {
    // Red proof for the fifth row of §3's table. An empty prefix makes G1 and
    // G2 vacuously true — the orders agree because neither has a baseline, and
    // the list reconciles against nothing.
    const late = [entry('orders', 'Migration20270101T090000OrdersInit')];
    const found = refusals({
      entries: late,
      moduleDependencies: new Map([['core', []], ['orders', ['catalog']], ['catalog', []]]),
      baseline: [],
      sources: [
        { name: late[0]!.cls.name, moduleId: 'orders', file: 'x.ts', creates: [], references: [], namedTables: [] },
      ],
    });
    expect(found.join('\n')).toContain('at or below the watermark');
    expect(found.join('\n')).toContain('published baseline list is empty');
  });

  it('refuses a graph in which nothing declares anything', () => {
    const entries = [entry('orders', 'Migration20260701T090000OrdersInit')];
    const found = refusals({
      entries,
      moduleDependencies: new Map([['core', []], ['orders', []]]),
      baseline: [entries[0]!.cls.name],
      sources: [
        { name: entries[0]!.cls.name, moduleId: 'orders', file: 'x.ts', creates: [], references: [], namedTables: [] },
      ],
    });
    expect(found.join('\n')).toContain('no module declares a dependency');
  });

  it('refuses a source walk that did not reach every registered migration', () => {
    const entries = [entry('orders', 'Migration20260701T090000OrdersInit')];
    const found = refusals({
      entries,
      moduleDependencies: new Map([['core', []], ['orders', ['catalog']], ['catalog', []]]),
      baseline: [entries[0]!.cls.name],
      sources: [],
    });
    expect(found.join('\n')).toContain('did not reach 1 registered migration');
  });
});

describe('G1 — the two regimes produce one order', () => {
  it('would differ under the unrepaired predicate — the defect, kept measurable', () => {
    // The input that makes the assertion below mean something: the same corpus,
    // ordered under `origin === 'core' && stamp <= watermark`, computed per
    // regime exactly as `isBaseline` computed it.
    const repositoryLegacy = legacyBaselineOf(MIGRATION_REGISTRY);
    const instanceLegacy = legacyBaselineOf(instanceEntries(MIGRATION_REGISTRY));

    expect(repositoryLegacy.length).toBe(BASELINE_MIGRATIONS.length);
    expect(
      instanceLegacy.length,
      'the instance regime no longer empties the frozen prefix — the defect this ' +
        'guard reproduces is gone, and with it the reason to trust the assertion below',
    ).toBeLessThan(repositoryLegacy.length / 2);

    const divergence = compareOrders(
      repositoryOrder({ ...REAL, baseline: repositoryLegacy }),
      instanceOrder({ ...REAL, baseline: instanceLegacy }),
    );
    expect(divergence.identical).toBe(false);
    expect(divergence.differingPositions).toBeGreaterThan(100);
  });

  it('orders an instance exactly as it orders this repository', () => {
    const repository = repositoryOrder(REAL);
    const instance = instanceOrder(REAL);
    const divergence = compareOrders(repository, instance);

    expect(
      divergence.identical,
      divergence.identical
        ? ''
        : `position ${divergence.firstIndex} holds "${divergence.first?.repository}" in this ` +
          `repository and "${divergence.first?.instance}" in an instance; ` +
          `${divergence.differingPositions} of ${repository.length} positions differ. The ` +
          'frozen historical prefix is entered by identity (R1.1) — a decision taken on ' +
          '`origin` is a decision that stops being true when a module is installed.',
    ).toBe(true);
    expect(instance).toEqual(repository);
    expect(repository.length).toBe(MIGRATION_REGISTRY.length);
  });

  it('emits the published list first, in the order the list holds it', () => {
    // R1.1's other half: the list is *ordered*, and the order is history's, so
    // the baseline block is emitted as the artefact holds it rather than as a
    // comparator recomputes it.
    expect(instanceOrder(REAL).slice(0, BASELINE_MIGRATIONS.length)).toEqual([
      ...BASELINE_MIGRATIONS,
    ]);
  });
});

describe('G2 — the published list and the registry reconcile, both ways (R1.7)', () => {
  it('names a migration for every entry the watermark covers, and nothing else', () => {
    const { unsupplied, unlisted } = reconcileBaseline(MIGRATION_REGISTRY, BASELINE_MIGRATIONS);
    expect(
      unsupplied,
      'the published baseline names a migration no registry entry supplies, so the frozen ' +
        'prefix an instance computes is shorter than history',
    ).toEqual([]);
    expect(
      unlisted,
      'a committed migration stamped at or below the watermark is not on the published list, ' +
        'so it joins the open block and the manifest graph reorders history',
    ).toEqual([]);
  });

  it('reports a name removed from the list', () => {
    const shortened = BASELINE_MIGRATIONS.slice(1);
    const { unlisted, unsupplied } = reconcileBaseline(MIGRATION_REGISTRY, shortened);
    expect(unlisted).toEqual([BASELINE_MIGRATIONS[0]]);
    expect(unsupplied).toEqual([]);
  });

  it('reports a name no entry supplies', () => {
    const invented = 'Migration20260424T165846CoreFoundationInitial';
    const { unsupplied, unlisted } = reconcileBaseline(MIGRATION_REGISTRY, [
      invented,
      ...BASELINE_MIGRATIONS,
    ]);
    expect(unsupplied).toEqual([invented]);
    expect(unlisted).toEqual([]);
  });

  it('holds only names stamped at or below the watermark', () => {
    expect(BASELINE_MIGRATIONS.filter((name) => stampOf(name) > BASELINE_THROUGH)).toEqual([]);
  });
});

describe('G3 — no forward table reference under the instance regime', () => {
  it('creates every table before the migration that names it', () => {
    const order = instanceOrder(REAL);
    const found = forwardReferences(order, SOURCES);
    expect(
      found.map(
        (reference) =>
          `${reference.moduleId}:${reference.migration} names ${reference.creatorModuleId}.` +
          `${reference.table}, created at ${reference.creatorAt} and named at ${reference.at}`,
      ),
      'a fresh database applying this order fails with `relation "…" does not exist`',
    ).toEqual([]);
  });

  it('reports a migration that indexes a table a later one creates', () => {
    // The shape the six had, as a fixture: `library` indexes a table `pages`
    // creates, and the graph puts `library` first because `pages` declares it.
    const sources: MigrationSource[] = [
      {
        name: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        file: 'library.ts',
        creates: ['library_assets'],
        references: ['pages_documents'],
        namedTables: ['pages_documents'],
      },
      {
        name: 'Migration20260102T000000PagesInit',
        moduleId: 'pages',
        file: 'pages.ts',
        creates: ['pages_documents'],
        references: [],
        namedTables: [],
      },
    ];
    const found = forwardReferences(
      ['Migration20260101T000000LibraryInit', 'Migration20260102T000000PagesInit'],
      sources,
    );
    expect(found).toEqual([
      {
        migration: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        table: 'pages_documents',
        creator: 'Migration20260102T000000PagesInit',
        creatorModuleId: 'pages',
        at: 0,
        creatorAt: 1,
      },
    ]);
  });

  it('says nothing about the same pair in the order that works', () => {
    const sources: MigrationSource[] = [
      {
        name: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        file: 'library.ts',
        creates: ['library_assets'],
        references: ['pages_documents'],
        namedTables: ['pages_documents'],
      },
      {
        name: 'Migration20260102T000000PagesInit',
        moduleId: 'pages',
        file: 'pages.ts',
        creates: ['pages_documents'],
        references: [],
        namedTables: [],
      },
    ];
    expect(
      forwardReferences(
        ['Migration20260102T000000PagesInit', 'Migration20260101T000000LibraryInit'],
        sources,
      ),
    ).toEqual([]);
  });
});

/**
 * A fixture migration, entering where the real walk enters: SQL text.
 *
 * Every proof below hands {@link migrationSourceOf} the statement it is about
 * rather than a hand-written {@link MigrationSource}, because the recogniser is
 * half of what these proofs are about (issue #130). A fixture carrying
 * `references: ['pages_documents']` proves nothing about a regex that has never
 * matched `references "…"`, which is exactly how D-226 came to undercount
 * itself.
 */
function fixture(moduleId: string, name: string, sql: string): MigrationSource {
  const source = migrationSourceOf({
    moduleId,
    file: `${moduleId}.ts`,
    text: `import { Migration } from '@mikro-orm/migrations';\n` +
      `export class ${name} extends Migration {\n` +
      `  override async up(): Promise<void> {\n` +
      `    this.addSql(\`${sql}\`);\n` +
      `  }\n}\n`,
  });
  if (source === null) throw new Error(`the fixture for ${name} declared no migration class`);
  return source;
}

describe('G4 — a migration names only what its own module closure guarantees (D-226)', () => {
  /**
   * The findings, as the run prints them, carried by the assertion the repair
   * drains (FR-005).
   *
   * **This list is the measurement, not a transcription of the spec.** It is
   * what makes every later merge request of
   * `specs/120-migration-closure-bridge-ownership/` reviewable: a repair is
   * judged by a line leaving this array, rather than by a reviewer re-deriving
   * 184 migrations. There is deliberately **no ledger** (FR-006) — a ledger
   * over these would license the fifteenth site, and every one of them is
   * repaired by this feature.
   *
   * The `core:` entries are the platform's own corpus.
   *
   * **Phase 2 drained the five bridge sites.** The promote migration named
   * `cms_pages`, `customer_accounts`, `organizations`, `promotions` and `taxes`
   * inside the `create table` statements of the sales-channel bridges, as
   * `references "<t>"` — the shape that made this rule's own ruling count six
   * where there were fourteen. Moving each bridge to the module that owns its
   * far side (D-226) took all five out at once and **added none**: each new
   * far-side migration names its own module's table, or one the platform
   * creates, or one its closure holds — `customer_accounts` declares
   * `organizations`, which creates the `customer_accounts` table, and
   * `promotions` declares `taxes`, which creates the `promotions` table. That
   * the count fell by exactly five is the reviewable fact; the list below is
   * what the run printed, not a transcription.
   *
   * **Phase 3 drained the remaining eight and added none**, in six shapes
   * rather than one act: five references moved to new above-watermark
   * migrations owned by the module whose closure holds the table
   * (`quote_requests`, `analytics`, `newsletter`, `cms`, and
   * `organization_warehouses` to `inventory` — the bridge rule one namespace
   * over), and **two creations moved between frozen bodies**, which is the one
   * shape D-226's own prescribed repair does not reach. `api_keys` went from
   * `webhooks`' frozen `up()` to `api_keys`' own (FR-014) and `customer_groups`
   * from `price_lists`' to `customer_accounts`' (the owner's ruling of
   * 2026-09-12): an above-watermark creation runs after the entire frozen
   * prefix, and both tables are referenced by frozen migrations, so the
   * prescribed repair would have broken a fresh database. Each creation's
   * receiving body is the one carrying the earliest reference, so nothing in
   * between moved. `api_keys` closed **two** lines, `orders` having been a
   * consequence of the misfiling rather than a site of its own.
   *
   * **Phase 5 drained the last one and the list is empty.**
   * `transactional_emails`' reseed migration `UPDATE`d `newsletter`'s
   * `newsletter_email_blocks` — the single DML member of the fourteen, and the
   * one whose repair was already written down as feature 097 Phase 4's retiring
   * condition: the two statements are removed from `up()` in place, with no
   * rename and no replacement migration (FR-019, T5-A). Both
   * `transactional_emails` ledger shards went with them (FR-020).
   *
   * **The empty array is now the assertion, and it is a stronger one than any
   * value it ever held.** An added line is a migration naming a table an
   * instance omitting the creating module cannot have — the state that made
   * `endora new instance`'s A3 red for as long as this feature ran. Repair the
   * site; never record it here.
   */
  const OPEN_SITES: readonly string[] = [];

  it('reports exactly the sites this feature repairs, and no new one', () => {
    const found = closureViolations(SOURCES, MODULE_DEPENDENCIES);
    expect(
      found.map(describeClosureViolation),
      'a migration names a table that neither its own module, nor anything in its ' +
        'transitive manifest `dependencies`, nor the platform creates. An instance that ' +
        'omits the creating module cannot migrate a fresh database. Repair the site — ' +
        'move the statement to a migration whose closure guarantees the table — and delete ' +
        'its line from this list. Never add one.',
    ).toEqual(OPEN_SITES);
  });

  /**
   * T1-C's record — *a line is what a reviewer counts, and the finding carries
   * what a repairer needs* — used to be asserted twice: once over a fixture,
   * here, and once over the real corpus, against whichever site was still open.
   * That second case named `assets_library -> cms.cms_pages` until Phase 3, then
   * `transactional_emails -> newsletter.newsletter_email_blocks` until Phase 5,
   * and its own comment said the subject moves with the corpus on purpose —
   * *"it has to name a site that is actually open"*. There is no longer one, and
   * writing a real-corpus assertion that no honest run can satisfy, or leaving a
   * site open to keep one alive, are the only two ways to keep it. So it is
   * deleted rather than adapted, and this case is where the record now lives: it
   * asserts the **whole** finding record — the migration, the module, the table,
   * every creator and the closure that does not hold one — which is the half
   * the real-corpus case was carrying.
   */
  it('reports a reference to a table only a module outside the closure creates', () => {
    const sources = [
      fixture('library', 'Migration20260101T000000LibraryInit', 'alter table "pages_documents" add column "asset_id" uuid;'),
      fixture('pages', 'Migration20260102T000000PagesInit', 'create table "pages_documents" ("id" uuid not null);'),
    ];
    const found = closureViolations(
      sources,
      new Map([
        ['library', []],
        ['pages', ['library']],
      ]),
    );
    expect(found).toEqual([
      {
        migration: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        table: 'pages_documents',
        creatorModuleIds: ['pages'],
        closure: [],
      },
    ]);
  });

  it('says nothing about the same pair once the dependency is declared', () => {
    const sources = [
      fixture('library', 'Migration20260101T000000LibraryInit', 'alter table "pages_documents" add column "asset_id" uuid;'),
      fixture('pages', 'Migration20260102T000000PagesInit', 'create table "pages_documents" ("id" uuid not null);'),
    ];
    // Transitively, and through a module that creates nothing: the closure is
    // `manifest-dependencies.ts`', so `library → typography → pages` is what
    // the ordering algorithm itself walks.
    expect(
      closureViolations(
        sources,
        new Map([
          ['library', ['typography']],
          ['typography', ['pages']],
          ['pages', []],
        ]),
      ),
    ).toEqual([]);
  });

  it('says nothing about a table the platform creates', () => {
    const sources = [
      fixture('library', 'Migration20260101T000000LibraryInit', 'alter table "settings" add column "scope" text;'),
      fixture('core', 'Migration20260102T000000CoreInit', 'create table "settings" ("id" uuid not null);'),
    ];
    expect(closureViolations(sources, new Map([['library', []]]))).toEqual([]);
  });

  it('says nothing about a table nobody in the corpus creates', () => {
    // The corpus does not create every table it names — a migration may drop or
    // probe one an earlier regime left behind. Reporting that as a closure
    // violation would file the absence of a creator as a dependency defect.
    const sources = [
      fixture('library', 'Migration20260101T000000LibraryInit', 'alter table "legacy_documents" drop column "asset_id";'),
    ];
    expect(closureViolations(sources, new Map([['library', []]]))).toEqual([]);
  });

  it('sees a table named only as a foreign-key target, which G3 does not (FR-003)', () => {
    // The measured cause of D-226's own undercount, as a proof. `ON_TABLE`
    // matches `on "<t>"` and `sqlTableAccesses` reads DML; neither matches
    // `references "<t>"`, so five of the nine bridges' far sides and
    // `customer_accounts → customer_groups` were invisible to the derivation
    // the ruling prescribed.
    const library = fixture(
      'library',
      'Migration20260101T000000LibraryInit',
      'create table "library_assets" ("id" uuid not null, "document_id" uuid not null ' +
        'constraint "library_assets_document_fk" references "pages_documents" ("id"));',
    );
    const pages = fixture(
      'pages',
      'Migration20260102T000000PagesInit',
      'create table "pages_documents" ("id" uuid not null);',
    );

    expect(library.namedTables).toContain('pages_documents');
    expect(library.references, "G3's recogniser is unchanged").not.toContain('pages_documents');
    expect(
      forwardReferences(
        ['Migration20260101T000000LibraryInit', 'Migration20260102T000000PagesInit'],
        [library, pages],
      ),
      'G3 answers a different question under a declared bound; this feature does not own it',
    ).toEqual([]);
    expect(
      closureViolations([library, pages], new Map([['library', []], ['pages', []]])).map(
        describeClosureViolation,
      ),
    ).toEqual(['library:Migration20260101T000000LibraryInit names pages.pages_documents']);
  });

  it('sees a table named only by `alter table`, which G3 does not (FR-003)', () => {
    const library = fixture(
      'library',
      'Migration20260101T000000LibraryInit',
      'alter table "pages_documents" add column "asset_id" uuid null;',
    );
    expect(library.namedTables).toContain('pages_documents');
    expect(library.references).not.toContain('pages_documents');
  });
});

describe('G4 refuses rather than reporting a vacuous clean sweep (FR-004)', () => {
  it('refuses a corpus in which no migration creates anything', () => {
    // Every reference then resolves to no creator and is skipped by the rule's
    // first silence: `closureViolations` returns `[]` honestly, over a corpus
    // whose creation arm stopped reading.
    const sources = [
      fixture('library', 'Migration20260101T000000LibraryInit', 'alter table "pages_documents" add column "asset_id" uuid;'),
    ];
    expect(closureViolations(sources, new Map([['library', []]]))).toEqual([]);
    const found = refusals({
      entries: [entry('library', 'Migration20260101T000000LibraryInit')],
      moduleDependencies: new Map([['library', ['pages']], ['pages', []]]),
      baseline: ['Migration20260101T000000LibraryInit'],
      sources,
      baselineThrough: '20260801T000000',
    });
    expect(found.join('\n')).toContain('no migration in the corpus creates a table');
  });

  it('refuses a corpus in which the recogniser classified no reference at all', () => {
    const sources = [
      fixture('pages', 'Migration20260101T000000PagesInit', 'create table "pages_documents" ("id" uuid not null);'),
    ];
    expect(closureViolations(sources, new Map([['pages', []]]))).toEqual([]);
    const found = refusals({
      entries: [entry('pages', 'Migration20260101T000000PagesInit')],
      moduleDependencies: new Map([['pages', ['library']], ['library', []]]),
      baseline: ['Migration20260101T000000PagesInit'],
      sources,
      baselineThrough: '20260801T000000',
    });
    expect(found.join('\n')).toContain('classified no table reference at all');
    expect(
      found.join('\n'),
      'the two refusals answer different questions and must stay independently reachable',
    ).not.toContain('no migration in the corpus creates a table');
  });

  it('the real corpus triggers neither', () => {
    const found = refusals({ ...REAL, sources: SOURCES }).join('\n');
    expect(found).not.toContain('no migration in the corpus creates a table');
    expect(found).not.toContain('classified no table reference at all');
  });
});

describe('G5 — a bridge table is the platform’s or its creator contributes it (FR-018)', () => {
  /**
   * The guard that makes the contribution registry (FR-015) non-droppable.
   *
   * **The disjuncts are inverted, and that is the whole of SC-004.** Until
   * `specs/120-migration-closure-bridge-ownership/` Phase 2 it passed on the
   * **first**: the platform's two frozen migrations created all nine bridges,
   * and no contribution was load-bearing. Phase 2 moved every `create table` to
   * the module that owns the far side (D-226), which falsified that disjunct for
   * every member at once, and Phase 4's registry is the only thing supplying the
   * second. It now passes for nine members on the second disjunct and none on
   * the first — so deleting the registry is no longer a change nothing notices,
   * which is what the guard exists to make true.
   *
   * That is also why Phase 4 merged **before** Phase 2: between them this
   * assertion is red, and the merge order is what kept `master` from being.
   */
  const NO_CONTRIBUTIONS: ReadonlyMap<string, string> = new Map();

  it('the platform serves no member whose table it neither creates nor is given', () => {
    expect(
      bridgeOwnershipViolations({
        bridges: CHANNEL_BRIDGES.bridges,
        sources: SOURCES,
        contributions: CHANNEL_BRIDGES.contributions,
      }),
      'a channel-membership call for this member reaches a relation an instance that omits ' +
        'the owning module does not have',
    ).toEqual([]);
  });

  it('holds on the contributions now, and on the platform creating nothing', () => {
    // The inversion, asserted rather than described. Take the contributions away
    // and **every** member fails, because the platform creates none of the nine
    // tables any more — where before Phase 2 this same call returned `[]` and
    // the registry was a thing the guard could not see the loss of.
    const withoutContributions = bridgeOwnershipViolations({
      bridges: CHANNEL_BRIDGES.bridges,
      sources: SOURCES,
      contributions: NO_CONTRIBUTIONS,
    });
    expect(withoutContributions).toHaveLength(CHANNEL_VOCABULARY.length);
    for (const finding of withoutContributions) {
      expect(finding).toContain('contributed by nobody');
    }
    expect(CHANNEL_BRIDGES.contributions.size).toBe(CHANNEL_VOCABULARY.length);

    // …and the first disjunct is the one that is now false everywhere: no
    // migration the platform owns creates a sales-channel bridge. Said over the
    // real corpus rather than over the two file names Phase 2 edited, so a
    // tenth bridge re-appearing in a third platform migration is caught here.
    const platformCreated = SOURCES.filter((source) => source.moduleId === 'core').flatMap(
      (source) => source.creates.filter((table) => table.startsWith('sales_channel_')),
    );
    expect(platformCreated).toEqual([]);
  });

  it('covers every member of the published vocabulary', () => {
    // The independent author: the enum is `@endora-commerce/contracts`', and the
    // declarations are the owning modules'. A declaration set short of the enum
    // is a member the platform can be asked for that no module claims — and one
    // *over* it is a member the vocabulary does not publish.
    expect([...CHANNEL_BRIDGES.bridges].map((bridge) => bridge.entityType).sort()).toEqual(
      [...CHANNEL_VOCABULARY].sort(),
    );
    expect(CHANNEL_BRIDGES.conflicts).toEqual([]);
  });

  it('no file anywhere in the tree declares a map total over the vocabulary (FR-015)', () => {
    // The half that is about *this* phase rather than about Phase 2, and the
    // one whose population is derived rather than listed (FR-018a). Two total
    // maps stood when D-226 was written and only one of them was in the ruling;
    // the second was found by a grep. A walk keyed on those two files would be
    // issue #244's defect arriving through its own repair.
    expect(
      totalBridgeMaps(BRIDGE_DECLARATIONS, CHANNEL_VOCABULARY),
      'the platform — or a module — knows where all nine bridges live, which is the map ' +
        'FR-015 deletes',
    ).toEqual([]);
  });

  it('finds a third total map in a file this feature has never heard of', () => {
    // The proof that the population is a **shape**. The fixture is a file named
    // in no list, in neither of the two spellings' original homes, and it enters
    // at the top of the analysis (issue #130): source text, parsed by the same
    // function the real walk calls.
    const invented = CHANNEL_VOCABULARY.map(
      (member) =>
        `  '${member}': { table: 'sc_${member.replace('-', '_')}', entityIdColumn: 'x_id' },`,
    ).join('\n');
    const declarations = parseChannelBridgeDeclarations(
      `const SOMEONES_LOOKUP = {\n${invented}\n};\n`,
      'packages/modules/reporting/src/backend/services/channel-report.service.ts',
      'reporting',
    );
    expect(declarations).toHaveLength(CHANNEL_VOCABULARY.length);
    expect(totalBridgeMaps(declarations, CHANNEL_VOCABULARY)).toHaveLength(1);
    expect(totalBridgeMaps(declarations, CHANNEL_VOCABULARY)[0]).toContain(
      'channel-report.service.ts',
    );
  });

  it('would have found either map this feature deleted (FR-015a)', () => {
    // Both spellings, reconstructed over the **real** nine rather than over a
    // list written here: the platform's keyed `BRIDGE_TABLES` and
    // `sales_channels`' explicit array, which was the copy nothing in the
    // repository could see and which a grep rather than a design found.
    const keyed = `const BRIDGE_TABLES: Record<ChannelMemberEntityType, BridgeShape> = {\n${CHANNEL_BRIDGES.bridges
      .map((bridge) => `  '${bridge.entityType}': { table: '${bridge.table}', entityIdColumn: 'x_id' },`)
      .join('\n')}\n};\n`;
    const explicit = `const BRIDGE_TABLES = [\n${CHANNEL_BRIDGES.bridges
      .map(
        (bridge) =>
          `  { entityType: '${bridge.entityType}', table: '${bridge.table}', ` +
          `entityIdColumn: 'x_id' },`,
      )
      .join('\n')}\n];\n`;
    for (const [file, text] of [
      ['packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts', keyed],
      ['packages/modules/sales_channels/src/backend/services/sales-channels.service.ts', explicit],
    ] as const) {
      const declarations = parseChannelBridgeDeclarations(text, file, 'core');
      expect(declarations, file).toHaveLength(CHANNEL_VOCABULARY.length);
      expect(totalBridgeMaps(declarations, CHANNEL_VOCABULARY), file).toHaveLength(1);
    }
  });

  it('reads both spellings, and calls neither of them a map on its own', () => {
    // The explicit spelling is what a module writes about its own bridge; the
    // keyed one is what a total map looks like. A recogniser blind to the first
    // would report every module registration as nothing at all and let G5 go
    // green over a tree where nobody contributed.
    const explicit = parseChannelBridgeDeclarations(
      "export const salesChannelBridges = [\n" +
        "  { entityType: 'cms-page', table: 'sales_channel_cms_pages', " +
        "entityIdColumn: 'cms_page_id' },\n];\n",
      'packages/modules/cms/src/backend/index.ts',
      'cms',
    );
    expect(explicit).toEqual([
      {
        entityType: 'cms-page',
        table: 'sales_channel_cms_pages',
        entityIdColumn: 'cms_page_id',
        file: 'packages/modules/cms/src/backend/index.ts',
        moduleId: 'cms',
      } satisfies ChannelBridgeDeclaration,
    ]);
    expect(totalBridgeMaps(explicit, CHANNEL_VOCABULARY)).toEqual([]);

    const keyed = parseChannelBridgeDeclarations(
      "const BRIDGE_TABLES = {\n  'cms-page': { table: 'sales_channel_cms_pages', " +
        "entityIdColumn: 'cms_page_id' },\n};\n",
      'x.ts',
      'core',
    );
    expect(keyed.map((entry) => entry.entityType)).toEqual(['cms-page']);
  });

  it('refuses a walk that classified no declaration rather than reporting over nothing', () => {
    // The vacuity this guard is one step from: with no declaration read, no file
    // is a total map, no member is uncovered and every disjunct holds. The real
    // walk raises; the pure half is what a fixture can drive.
    expect(totalBridgeMaps([], CHANNEL_VOCABULARY)).toEqual([]);
    expect(channelBridgesFrom([]).bridges).toEqual([]);
    // …which is exactly why the walk itself refuses — see
    // `readChannelBridgeDeclarations`, whose throw is the reason the emptiness
    // above can never be the state this file reports on.
    expect(BRIDGE_DECLARATIONS.length).toBeGreaterThanOrEqual(CHANNEL_VOCABULARY.length);
  });

  it('reports two authors claiming one member', () => {
    const conflicting = channelBridgesFrom([
      {
        entityType: 'tax',
        table: 'sales_channel_taxes',
        entityIdColumn: 'tax_id',
        file: 'a.ts',
        moduleId: 'taxes',
      },
      {
        entityType: 'tax',
        table: 'sales_channel_tax_rates',
        entityIdColumn: 'tax_id',
        file: 'b.ts',
        moduleId: 'billing',
      },
    ]);
    expect(conflicting.conflicts).toHaveLength(1);
    expect(conflicting.conflicts[0]).toContain('two authors claim one member');
  });

  it('reds when one module withdraws its contribution, over the real corpus', () => {
    // The red proof, re-pointed by Phase 2 and sharper for it. It used to excise
    // the `cms` bridge from the **platform's** promote migration and add a
    // fixture far-side one, because that was the move the phase had not made
    // yet. The move is made, so the fixture is the real thing: real sources,
    // real bridges, and the real contributions with exactly one taken away.
    //
    // It cannot pass vacuously in either direction. The first assertion is that
    // `cms` — and not `core` — creates the table in the corpus this run read, so
    // a Phase 2 that was reverted, or a stale `dist`, fails here rather than
    // further down. And the withdrawal must red **that** member and no other, so
    // a guard that had been widened into reporting everything is not mistaken
    // for one that is working.
    const cms = SOURCES.filter((source) => source.creates.includes('sales_channel_cms_pages'));
    expect(
      cms.map((source) => source.moduleId),
      'the cms bridge is created by its far side, which is what Phase 2 moved',
    ).toEqual(['cms']);

    const withdrawn = new Map(CHANNEL_BRIDGES.contributions);
    expect(withdrawn.delete('cms-page')).toBe(true);
    const found = bridgeOwnershipViolations({
      bridges: CHANNEL_BRIDGES.bridges,
      sources: SOURCES,
      contributions: withdrawn,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('cms-page');
    expect(found[0]).toContain('created by cms');
    expect(found[0]).toContain('contributed by nobody');
  });

  it('reds a bridge whose creation is left in the platform with no owner at all', () => {
    // The other direction of the same move, and the one a reverted Phase 2 looks
    // like: the platform creating the table again. That is **green** — it is the
    // first disjunct — so the guard cannot be what catches a revert, and saying
    // so here is the point. What it does catch is the half-move: the platform's
    // statement gone and no far-side migration written, which is a member whose
    // table nothing in the corpus builds.
    const orphaned = SOURCES.filter(
      (source) => !source.creates.includes('sales_channel_cms_pages'),
    );
    const found = bridgeOwnershipViolations({
      bridges: CHANNEL_BRIDGES.bridges,
      sources: orphaned,
      contributions: CHANNEL_BRIDGES.contributions,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('no migration in the corpus creates');
    expect(found[0]).toContain('sales_channel_cms_pages');
  });

  it('is green again once the module that creates it contributes it', () => {
    const bridges: readonly ChannelBridge[] = [
      { entityType: 'cms-page', table: 'sales_channel_cms_pages' },
    ];
    const sources = [
      fixture(
        'cms',
        'Migration20260902T090000CmsSalesChannelCmsPages',
        'create table if not exists "sales_channel_cms_pages" ("sales_channel_id" uuid not null);',
      ),
    ];
    expect(
      bridgeOwnershipViolations({ bridges, sources, contributions: new Map() }),
    ).toHaveLength(1);
    expect(
      bridgeOwnershipViolations({
        bridges,
        sources,
        contributions: new Map([['cms-page', 'cms']]),
      }),
    ).toEqual([]);
    expect(
      bridgeOwnershipViolations({
        bridges,
        sources,
        contributions: new Map([['cms-page', 'sales_channels']]),
      }),
      'a contribution from a module that does not create the table is not the second disjunct',
    ).toHaveLength(1);
  });

  it('reports a member whose table nothing in the corpus creates', () => {
    expect(
      bridgeOwnershipViolations({
        bridges: [{ entityType: 'wishlist', table: 'sales_channel_wishlists' }],
        sources: SOURCES,
        contributions: NO_CONTRIBUTIONS,
      }).join('\n'),
    ).toContain('no migration in the corpus creates');
  });

});

/**
 * **G6** (FR-011b) — `TABLE_OWNER_OVERRIDES` and `check:module-boundary`'s
 * derived owner map agree on every table they both answer for.
 *
 * Two derivations of one question — *which module owns this table* — and until
 * `specs/120-migration-closure-bridge-ownership/` nothing in the repository
 * reconciled them. The finding is not *"two entries are wrong"*; it is that a
 * relocation moves one map and not the other, and which one it moves is not a
 * thing anybody remembers. `deriveFkGraph`'s has **no creating-migration
 * fallback by design**, so it is structurally the one left behind.
 *
 * It lands at **zero findings**, and that is the argument for landing it rather
 * than against: measured over the tree Phase 2 arrived on, the two maps
 * disagreed on exactly the nine `sales_channel_*` bridges and agreed on
 * everything else — so the invariant became true with Phase 2's re-pointing and
 * this is the cheapest moment at which to lock it. **No ledger** (FR-011b): an
 * entry could only license a second map going stale.
 *
 * It asserts *agreement*, never *"the override map is derivable"*. See
 * {@link ownerMapDisagreements} for why that distinction is load-bearing.
 */
const G6_LAYOUT = await requireModuleLayout('[G6]');
const DERIVED_TABLE_OWNERS = buildTableOwners(
  sourcesOf(collectSchemaFiles(G6_LAYOUT.sourceRoots), schemaKeyOf(G6_LAYOUT)),
  (await loadPackageDeclarations()).tables,
  G6_LAYOUT.hostResidentModules,
).owners;

describe('G6 — the two table→owner maps agree (FR-011b)', () => {
  const DERIVED = DERIVED_TABLE_OWNERS;

  it('has something to reconcile', () => {
    expect(ownerMapRefusals({ overrides: TABLE_OWNER_OVERRIDES, derived: DERIVED })).toEqual([]);
  });

  it('agrees on every table the override map answers for', () => {
    expect(
      ownerMapDisagreements(TABLE_OWNER_OVERRIDES, DERIVED).map(describeOwnerMapDisagreement),
      'a table whose owner the two derivations answer differently. `deriveFkGraph` resolves ' +
        'by entity `tableName`, then by TABLE_OWNER_OVERRIDES, then fails — it has no ' +
        'creating-migration fallback — so moving a `create table` moves the derived map and ' +
        'leaves the override behind. Re-point the entry in the same merge request as the ' +
        'move. There is no ledger, and an entry here would only license the next relocation ' +
        'leaving a second map stale.',
    ).toEqual([]);
  });

  it('reds an entry re-pointed back to where Phase 2 found it', () => {
    // The red proof, entering at the top of the analysis (issue #130): a map, not
    // a pre-computed finding. `sales_channels` is where all nine bridges were
    // filed before Phase 2 moved their DDL, so this is the exact state the guard
    // exists to refuse — and the assertion names the derived owner, which is
    // what tells the next reader which of the two maps moved.
    const reverted = { ...TABLE_OWNER_OVERRIDES, sales_channel_cms_pages: 'sales_channels' };
    const found = ownerMapDisagreements(reverted, DERIVED);
    expect(found.map(describeOwnerMapDisagreement)).toEqual([
      'sales_channel_cms_pages: override says "sales_channels", derived says "cms"',
    ]);
  });

  it('reds an override for a table the derived map has no owner for', () => {
    const invented = { ...TABLE_OWNER_OVERRIDES, a_table_nobody_declares: 'cms' };
    expect(ownerMapDisagreements(invented, DERIVED).map(describeOwnerMapDisagreement)).toEqual([
      'a_table_nobody_declares: the override map says "cms" and the derived map has no owner ' +
        'for it at all',
    ]);
  });

  it('refuses an empty override map and a derived map that resolved nothing', () => {
    expect(
      ownerMapRefusals({ overrides: {}, derived: DERIVED }).join('\n'),
    ).toContain('the override map is empty');
    expect(
      ownerMapRefusals({ overrides: TABLE_OWNER_OVERRIDES, derived: new Map() }).join('\n'),
    ).toContain('resolved no table at all');
  });

  it('says nothing about a derived table the override map does not answer for', () => {
    // The half that would turn this into "the override map is derivable". The
    // derived map answers for every table in the tree; the override map answers
    // for the ones no entity claims, by hand and deliberately. Requiring an
    // entry per derived table would be a demand for a copy of the first map.
    expect(DERIVED.size).toBeGreaterThan(Object.keys(TABLE_OWNER_OVERRIDES).length);
    expect(ownerMapDisagreements({}, DERIVED)).toEqual([]);
  });
});
