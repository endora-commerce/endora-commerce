import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChannelMemberEntityTypeSchema } from '@endora-commerce/contracts';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';
import { coreModuleDependencies } from '../../../src/db/configured-migrations.js';
import { BASELINE_THROUGH, type MigrationRegistryEntry } from '@endora-commerce/platform/db';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
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
   * The eight `core:` entries are the platform's own corpus. Five of them are
   * the sales-channel bridges' far sides, named inside a `create table` as
   * `references "<t>"`, which is the shape that made this rule's own ruling
   * count six where there are fourteen.
   */
  const OPEN_SITES = [
    'api_keys:Migration20260724T173916ApiKeysDistributorBinding names webhooks.api_keys',
    'assets_library:Migration20260505T102206AssetsLibraryInit names cms.cms_pages',
    'core:Migration20260430T170044CoreSalesChannelsPromote names cms.cms_pages',
    'core:Migration20260430T170044CoreSalesChannelsPromote names organizations.customer_accounts',
    'core:Migration20260430T170044CoreSalesChannelsPromote names organizations.organizations',
    'core:Migration20260430T170044CoreSalesChannelsPromote names quote_requests.quote_requests',
    'core:Migration20260430T170044CoreSalesChannelsPromote names taxes.promotions',
    'core:Migration20260430T170044CoreSalesChannelsPromote names taxes.taxes',
    'core:Migration20260717T134752CoreTenantScopeIndexes names analytics.analytics_events',
    'core:Migration20260717T134752CoreTenantScopeIndexes names newsletter.newsletter_subscribers',
    'customer_accounts:Migration20260611T140403CustomerAccountsLifecycle names price_lists.customer_groups',
    'orders:Migration20260724T193611OrdersOrderPlacementIntents names webhooks.api_keys',
    'organizations:Migration20260611T140349OrganizationsConsolidation names inventory.warehouses',
    'transactional_emails:Migration20260801T111001TransactionalEmailsEmailDefaultsReseed names newsletter.newsletter_email_blocks',
  ];

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

  it('names the closure that would have to hold the creator', () => {
    // T1-C's record, over the real corpus: a line is what a reviewer counts,
    // and the finding carries what a repairer needs.
    const found = closureViolations(SOURCES, MODULE_DEPENDENCIES);
    const assets = found.find((violation) => violation.moduleId === 'assets_library');
    expect(assets).toBeDefined();
    expect(assets!.table).toBe('cms_pages');
    expect(assets!.creatorModuleIds).toEqual(['cms']);
    expect(assets!.closure).not.toContain('cms');
  });

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
   * It passes today on the **first** disjunct: the platform's frozen promote
   * migration creates all nine bridges. `specs/120-…`' Phase 2 moves each
   * `create table` to the module that owns the far side, which falsifies that
   * disjunct for every member at once, and only a registration contributed by
   * the creating module supplies the second. That is why Phase 4 merges before
   * Phase 2 — and why this assertion has to be able to go red, which the
   * fixture below is the proof of.
   *
   * **Phase 4 has landed, so the contributions are now real** and the guard is
   * green for nine members on the first disjunct and zero on the second. That
   * is the state Phase 2 inverts, one member at a time, without this file
   * changing.
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

  it('holds today on the platform creating each bridge, and not yet on a contribution', () => {
    // Said out loud because it is the invariant Phase 2 moves: nine members pass
    // because `core` creates the table, and none of them needs its contribution
    // yet. Removing the contributions therefore changes nothing **today** —
    // and, after Phase 2 moves the first `create table`, changes everything,
    // which is what makes the registry non-droppable.
    expect(
      bridgeOwnershipViolations({
        bridges: CHANNEL_BRIDGES.bridges,
        sources: SOURCES,
        contributions: NO_CONTRIBUTIONS,
      }),
    ).toEqual([]);
    expect(CHANNEL_BRIDGES.contributions.size).toBe(CHANNEL_VOCABULARY.length);
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

  it('reds when one bridge is created by its far side and contributed by nobody', () => {
    // Phase 2's first move, over the **real** corpus and entering where the real
    // walk enters: the promote migration's own text with the `cms` bridge's
    // creation taken out of it, re-read by the recogniser, plus the far-side
    // migration Phase 2 will scaffold. Both disjuncts are then false.
    //
    // It cannot pass vacuously. If the excision matched nothing the platform
    // still creates the table, the first disjunct still holds, and this reports
    // zero findings against an expectation of one.
    const promote = SOURCES.find(
      (source) => source.name === 'Migration20260430T170044CoreSalesChannelsPromote',
    );
    expect(promote, 'the platform migration this fixture edits is not in the corpus').toBeDefined();
    expect(promote!.creates).toContain('sales_channel_cms_pages');
    const excised = migrationSourceOf({
      moduleId: 'core',
      file: promote!.file,
      text: readFileSync(promote!.file, 'utf8').replaceAll(
        'create table "sales_channel_cms_pages"',
        'create table "sales_channel_cms_pages_left_behind"',
      ),
    });
    expect(excised!.creates).not.toContain('sales_channel_cms_pages');

    const moved = SOURCES.filter((source) => source.name !== promote!.name)
      .concat(excised!)
      .concat(
        fixture(
          'cms',
          'Migration20260902T090000CmsSalesChannelCmsPages',
          'create table if not exists "sales_channel_cms_pages" ("sales_channel_id" uuid not null);',
        ),
      );
    const found = bridgeOwnershipViolations({
      bridges: CHANNEL_BRIDGES.bridges,
      sources: moved,
      contributions: NO_CONTRIBUTIONS,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('cms-page');
    expect(found[0]).toContain('contributed by nobody');
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
