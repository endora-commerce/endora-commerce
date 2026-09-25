import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTableOwners,
  scanModuleBoundaryTree,
} from '../../../scripts/check-module-boundary.js';
import {
  closureOf,
  type DeclaredDependencies,
} from '../../../scripts/lib/manifest-dependencies.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import { coreMigrationDirs } from '../../helpers/fk-graph.js';

/**
 * The **reverse edge** of a migration's DDL on another module's table —
 * feature 134's T118, `specs/134-paid-module-extraction/contracts/foreign-write-repair.md`
 * §10.2 item 5 and `research.md` D14 §6.
 *
 * Every other instrument that reads DDL asks *"can this migration rely on the
 * table?"* — the writer → owner edge. `fk-dependency-drift.test.ts` wants a
 * foreign key's target in the writer's closure, G4 wants the table's creator
 * there, and `check:module-boundary`'s R2 does not see `alter table` at all. So
 * `stripe` adding `payments.refunded_amount` passed all of them, while the
 * question that mattered was the other one: *can the module whose entity maps
 * this column rely on the migration that creates it?* An instance without
 * `stripe` could not insert a payment, and `stripe`'s hard uninstall dropped a
 * column a free module reads.
 *
 * The rule, over every migration of module **W** that issues a column-shaped
 * `alter table` (`add | alter | drop | rename column`) on a table whose owner
 * **O** ≠ W: a finding, **unless** W ∈ closure(O) — O can never be present
 * without W — or W is `core` — always present — or both W and O are in the
 * required set derived from `activation.nonDeactivatable`, which every
 * composition must hold.
 *
 * **No ledger** (D14 §6). Every acceptance clause is derived, so a site that
 * passes today because both modules are locked turns red on its own the day a
 * writer's lock is withdrawn; a list would license the next `stripe`.
 *
 * The owner map is `check:module-boundary`'s own (`buildTableOwners`), so the
 * two instruments cannot disagree about whose table a table is. It is
 * table-level on purpose: a column-level map would re-implement the naming
 * strategy for every property, and the table's owner already identifies the
 * module whose entity maps the column (D14 §6, rejected alternatives).
 */

/** The migration group the platform itself owns — always present. */
const CORE_WRITER = 'core';

/** One migration file, as the analysis enters it (issue #130: source text in). */
interface MigrationText {
  readonly moduleId: string;
  readonly file: string;
  readonly text: string;
}

/** A column-shaped `alter table` subcommand on some table, before ownership. */
interface ColumnDdlSite {
  readonly writer: string;
  readonly file: string;
  readonly table: string;
  readonly column: string;
  readonly subcommand: string;
}

/** A reverse edge nothing guarantees: one per file, table and column. */
interface ForeignColumnFinding {
  readonly file: string;
  readonly table: string;
  readonly column: string;
  readonly subcommands: readonly string[];
  readonly writer: string;
  readonly owner: string;
}

/** A manifest, in the two fields this rule reads. */
interface ManifestFacts {
  readonly id: string;
  readonly manifest: {
    readonly dependencies?: readonly string[];
    readonly activation?: unknown;
  };
}

/**
 * Comments are not statements. A migration's doc-block routinely quotes the
 * DDL it explains — the emptied `stripe` migration does exactly that — and a
 * recogniser that read prose would keep a repaired site red forever. Only a
 * `//` that opens a line is stripped, so a URL inside a string survives.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Joins the seams of a statement split across concatenated literals
 * (`` `alter table "x" ` + `add column …` ``), which eight init migrations use.
 * Without it the table and its subcommand are two strings and neither matches.
 */
function withoutLiteralSeams(text: string): string {
  return text.replace(/[`']\s*\+\s*[`']/g, '');
}

/**
 * `alter table [if exists] [only] "<t>" <body>`, the body ending at the
 * statement's `;` — or, for a statement written without one, before the next
 * statement starts, so a missing terminator cannot hand one table's body the
 * next statement's columns.
 */
const ALTER_TABLE_STATEMENT =
  /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?"([a-z0-9_]+)"((?:(?!\balter\s+table\b|\bcreate\s|\baddSql\b)[^;])*)/gi;

/**
 * One column-shaped subcommand, `column` keyword optional because Postgres
 * accepts `add "c"`. Wider than the spike D14 §3 measured with (`add column`
 * only). The keyword is optional without admitting a constraint: after
 * `add constraint`, `drop constraint` or `rename to` the next token is a
 * keyword rather than a quoted identifier, so none of them can match.
 */
const COLUMN_SUBCOMMAND =
  /\b(add|alter|drop|rename)\s+(?:column\s+)?(?:if\s+(?:not\s+)?exists\s+)?"([a-z0-9_]+)"/gi;

function columnDdlSites(migration: MigrationText): ColumnDdlSite[] {
  const text = withoutLiteralSeams(withoutComments(migration.text));
  const sites: ColumnDdlSite[] = [];
  for (const statement of text.matchAll(ALTER_TABLE_STATEMENT)) {
    const table = statement[1]!.toLowerCase();
    for (const sub of statement[2]!.matchAll(COLUMN_SUBCOMMAND)) {
      sites.push({
        writer: migration.moduleId,
        file: migration.file,
        table,
        column: sub[2]!,
        subcommand: sub[1]!.toLowerCase(),
      });
    }
  }
  return sites;
}

/** The locked set, derived — never written down. */
function requiredSetOf(manifests: readonly ManifestFacts[]): ReadonlySet<string> {
  return new Set(
    manifests
      .filter((entry) => {
        const activation = entry.manifest.activation as { nonDeactivatable?: unknown } | undefined;
        return activation?.nonDeactivatable === true;
      })
      .map((entry) => entry.id),
  );
}

interface ReverseEdgeResult {
  /** Column-shaped subcommands on a table another module owns — the population. */
  readonly foreignSites: readonly (ColumnDdlSite & { readonly owner: string })[];
  readonly findings: readonly ForeignColumnFinding[];
}

/**
 * The whole analysis, from source text and manifests to findings.
 *
 * `owners` is the table → owner id map; the real run builds it with
 * `buildTableOwners` over the tree's schema sources, and every red proof below
 * builds it the same way from entity text, so the map is proven and not handed
 * in (issue #130).
 */
function reverseEdgeAnalysis(input: {
  readonly migrations: readonly MigrationText[];
  readonly owners: ReadonlyMap<string, { readonly id: string }>;
  readonly manifests: readonly ManifestFacts[];
}): ReverseEdgeResult {
  const dependencies: DeclaredDependencies = new Map(
    input.manifests.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
  );
  const required = requiredSetOf(input.manifests);

  const foreignSites: (ColumnDdlSite & { owner: string })[] = [];
  for (const migration of input.migrations) {
    for (const site of columnDdlSites(migration)) {
      const owner = input.owners.get(site.table)?.id;
      if (owner === undefined || owner === site.writer) continue;
      foreignSites.push({ ...site, owner });
    }
  }

  const grouped = new Map<string, ForeignColumnFinding & { subcommands: string[] }>();
  for (const site of foreignSites) {
    if (site.writer === CORE_WRITER) continue;
    if (closureOf(site.owner, dependencies).has(site.writer)) continue;
    if (required.has(site.writer) && required.has(site.owner)) continue;
    const key = JSON.stringify([site.file, site.table, site.column]);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        file: site.file,
        table: site.table,
        column: site.column,
        subcommands: [site.subcommand],
        writer: site.writer,
        owner: site.owner,
      });
    } else if (!existing.subcommands.includes(site.subcommand)) {
      existing.subcommands.push(site.subcommand);
    }
  }
  const findings = [...grouped.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.table.localeCompare(b.table) ||
      a.column.localeCompare(b.column),
  );
  return { foreignSites, findings };
}

/**
 * States in which "no finding" would be a statement about the walk rather than
 * about the tree (issue #113). Zero matched sites is one: 22 `add column` sites
 * on foreign tables, in 9 files, existed when this guard was written (D14 §3 as
 * corrected by D15), so a recogniser that matches none has broken, not been
 * satisfied.
 */
function reverseEdgeRefusals(input: {
  readonly migrations: readonly MigrationText[];
  readonly owners: ReadonlyMap<string, unknown>;
  readonly manifests: readonly ManifestFacts[];
  readonly result: ReverseEdgeResult;
}): readonly string[] {
  const found: string[] = [];
  if (input.migrations.length === 0) found.push('no migration source was read at all');
  if (input.owners.size === 0) found.push('the table → owner map resolved no table');
  if (requiredSetOf(input.manifests).size === 0) {
    found.push(
      'no manifest declares `activation.nonDeactivatable`, so the required-set clause ' +
        'could accept nothing — a manifest read that lost the activation block',
    );
  }
  if (input.result.foreignSites.length === 0) {
    found.push(
      'the recogniser matched zero column-shaped `alter table` sites on another module’s ' +
        'table — a sweep with nothing to classify reports clean for a reason that says ' +
        'nothing about the corpus',
    );
  }
  return found;
}

function describeForeignColumnFinding(finding: ForeignColumnFinding): string {
  return (
    `${finding.file}: \`${finding.writer}\` issues ${finding.subcommands.join('/')} column ` +
    `"${finding.table}"."${finding.column}" on a table \`${finding.owner}\` owns — and ` +
    `\`${finding.owner}\` can be present without \`${finding.writer}\` (not in its dependency ` +
    'closure, not `core`, not both `nonDeactivatable`)'
  );
}

// ─── The real tree ────────────────────────────────────────────────────────────

const LAYOUT = await requireModuleLayout('[foreign-column-ddl]');
const SCAN = await scanModuleBoundaryTree(LAYOUT);
const REAL_OWNERS = buildTableOwners(
  SCAN.input.schema,
  SCAN.input.packageTables,
  SCAN.input.hostResidentModules,
).owners;

/**
 * Every migration file in the checkout, attributed to the module that ships it.
 * Same walk as `readMigrationSources` in `helpers/instance-migration-order.ts`:
 * the `core` group's directories, then each registered module's own.
 */
function readRealMigrations(): MigrationText[] {
  const directories: Array<{ directory: string; moduleId: string }> = coreMigrationDirs(
    LAYOUT.srcRoot,
  )
    .filter((directory) => existsSync(directory))
    .map((directory) => ({ directory, moduleId: CORE_WRITER }));
  for (const moduleId of LAYOUT.registeredIds) {
    const root = LAYOUT.moduleDirectoryOf(moduleId);
    if (root === null) continue;
    for (const candidate of [join(root, 'src', 'migrations'), join(root, 'migrations')]) {
      if (existsSync(candidate)) directories.push({ directory: candidate, moduleId });
    }
  }
  const found: MigrationText[] = [];
  for (const { directory, moduleId } of directories) {
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const file = join(directory, name);
      found.push({ moduleId, file: LAYOUT.keyOf(file), text: readFileSync(file, 'utf8') });
    }
  }
  return found;
}

const REAL_MIGRATIONS = readRealMigrations();
const REAL_MANIFESTS: readonly ManifestFacts[] = DISCOVERED_MANIFESTS;
const REAL = reverseEdgeAnalysis({
  migrations: REAL_MIGRATIONS,
  owners: REAL_OWNERS,
  manifests: REAL_MANIFESTS,
});

describe('the reverse edge of a migration’s column DDL on another module’s table (T118)', () => {
  it('has something to classify', () => {
    expect(
      reverseEdgeRefusals({
        migrations: REAL_MIGRATIONS,
        owners: REAL_OWNERS,
        manifests: REAL_MANIFESTS,
        result: REAL,
      }),
    ).toEqual([]);
  });

  it('finds no column a module maps that a module it can be present without creates', () => {
    expect(
      REAL.findings.map(describeForeignColumnFinding),
      'a module’s migration changes a column on a table another module owns, and the ' +
        'owner can be installed or active without the writer. The owner then maps a column ' +
        'whose existence depends on a module it did not declare. The repair is the owner’s ' +
        '(foreign-write-repair.md §10.2): the owner ships `add column if not exists` with a ' +
        'no-op `down()` where the table outlives it, and the writer’s migration keeps its ' +
        'class name with both bodies emptied. There is no ledger.',
    ).toEqual([]);
  });
});

// ─── Red proofs: source text and manifests in (issue #130) ───────────────────

/** Two modules' entities; the owner map is built from them, not handed in. */
const FIXTURE_SCHEMA: ReadonlyMap<string, string> = new Map([
  [
    'modules/owner/entities/thing.entity.ts',
    "@Entity({ tableName: 'owner_things' })\nexport class Thing {}",
  ],
  [
    'modules/writer/entities/extra.entity.ts',
    "@Entity({ tableName: 'writer_extras' })\nexport class Extra {}",
  ],
]);
const FIXTURE_OWNERS = buildTableOwners(FIXTURE_SCHEMA).owners;

const WRITER_MIGRATION: MigrationText = {
  moduleId: 'writer',
  file: 'modules/writer/migrations/20260901T000000_writer_owner_column.ts',
  text:
    "import { Migration } from '@mikro-orm/migrations';\n" +
    'export class Migration20260901T000000WriterOwnerColumn extends Migration {\n' +
    '  override async up(): Promise<void> {\n' +
    '    this.addSql(`alter table "owner_things" add column "extra" numeric(14,2) not null default \'0\';`);\n' +
    '  }\n' +
    '  override async down(): Promise<void> {\n' +
    '    this.addSql(`alter table "owner_things" drop column "extra";`);\n' +
    '  }\n' +
    '}\n',
};

function manifest(
  id: string,
  options: { dependencies?: string[]; locked?: boolean } = {},
): ManifestFacts {
  return {
    id,
    manifest: {
      dependencies: options.dependencies ?? [],
      activation: options.locked
        ? { nonDeactivatable: true, reason: 'fixture' }
        : { setting: `${id}.enabled` },
    },
  };
}

function fixtureFindings(
  manifests: readonly ManifestFacts[],
  migration: MigrationText = WRITER_MIGRATION,
): readonly ForeignColumnFinding[] {
  return reverseEdgeAnalysis({ migrations: [migration], owners: FIXTURE_OWNERS, manifests })
    .findings;
}

describe('the reverse-edge guard can fail (T118 red proofs)', () => {
  it('reds an optional writer outside the owner’s closure, naming file, table, column, W and O', () => {
    const found = fixtureFindings([
      manifest('owner'),
      manifest('writer', { dependencies: ['owner'] }),
    ]);
    expect(found).toEqual([
      {
        file: WRITER_MIGRATION.file,
        table: 'owner_things',
        column: 'extra',
        subcommands: ['add', 'drop'],
        writer: 'writer',
        owner: 'owner',
      },
    ]);
    expect(describeForeignColumnFinding(found[0]!)).toContain('owner_things');
  });

  it('greens the same site when the writer is in the owner’s closure', () => {
    expect(
      fixtureFindings([manifest('owner', { dependencies: ['writer'] }), manifest('writer')]),
    ).toEqual([]);
  });

  it('greens it transitively through the closure', () => {
    expect(
      fixtureFindings([
        manifest('owner', { dependencies: ['middle'] }),
        manifest('middle', { dependencies: ['writer'] }),
        manifest('writer'),
      ]),
    ).toEqual([]);
  });

  it('greens both required, then reds when the writer’s lock is withdrawn', () => {
    expect(
      fixtureFindings([manifest('owner', { locked: true }), manifest('writer', { locked: true })]),
    ).toEqual([]);
    expect(
      fixtureFindings([manifest('owner', { locked: true }), manifest('writer')]).map(
        (finding) => finding.writer,
      ),
    ).toEqual(['writer']);
  });

  it('greens `core` as the writer', () => {
    expect(
      fixtureFindings([manifest('owner')], {
        ...WRITER_MIGRATION,
        moduleId: CORE_WRITER,
        file: 'migrations/20260901T000000_core_owner_column.ts',
      }),
    ).toEqual([]);
  });

  it('ignores a module altering its own table', () => {
    expect(
      fixtureFindings([manifest('owner'), manifest('writer')], {
        ...WRITER_MIGRATION,
        text: 'this.addSql(`alter table "writer_extras" add column "x" text;`);',
      }),
    ).toEqual([]);
  });

  it('reads all four subcommands, a concatenated statement and an optional `column` keyword', () => {
    const text =
      'this.addSql(`alter table "owner_things" ` +\n  `alter column "a" type text;`);\n' +
      'this.addSql(`alter table "owner_things" rename column "b" to "c";`);\n' +
      'this.addSql(`alter table if exists "owner_things" add "d" text, drop column if exists "e";`);\n' +
      'this.addSql(`alter table "owner_things" add constraint "k" unique ("f");`);\n';
    expect(
      fixtureFindings([manifest('owner'), manifest('writer')], { ...WRITER_MIGRATION, text }).map(
        (finding) => `${finding.subcommands.join('/')} ${finding.column}`,
      ),
    ).toEqual(['alter a', 'rename b', 'add d', 'drop e']);
  });

  it('reads no statement quoted in a comment — an emptied migration’s doc-block', () => {
    const text =
      '/**\n * Used to run `alter table "owner_things" add column "extra" numeric;`.\n */\n' +
      '// alter table "owner_things" drop column "extra";\n' +
      'export class Migration20260901T000000WriterOwnerColumn extends Migration {}\n';
    expect(
      fixtureFindings([manifest('owner'), manifest('writer')], { ...WRITER_MIGRATION, text }),
    ).toEqual([]);
  });

  it('refuses a sweep that matched zero foreign column sites', () => {
    const manifests = [manifest('owner', { locked: true }), manifest('writer')];
    const migrations = [{ ...WRITER_MIGRATION, text: 'export class Nothing {}' }];
    const result = reverseEdgeAnalysis({ migrations, owners: FIXTURE_OWNERS, manifests });
    expect(result.findings).toEqual([]);
    expect(reverseEdgeRefusals({ migrations, owners: FIXTURE_OWNERS, manifests, result })).toEqual([
      expect.stringContaining('matched zero column-shaped'),
    ]);
  });
});
