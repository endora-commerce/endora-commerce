import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_DIGEST_LENGTH } from '@endora-commerce/test-kit/database';
import {
  MIGRATION_SOURCE_ROOTS,
  TEMPLATE_SEED_SOURCES,
  migrationSourceRoots,
  templateIdentity,
  type MigrationSourceRoot,
} from '../../template-identity.js';
import {
  configuredMigrations,
  type RegisteredMigration,
} from '../../../src/db/configured-migrations.js';

/**
 * The configured set, read once for this file.
 *
 * It is an async factory since feature 080's T033: an installed extension
 * package's migrations are discovered at runtime (D-119/D-155), so the merged
 * order cannot be a module-level constant. `configuredMigrations()` memoises,
 * so asking here and asking inside `templateIdentity()` is one answer.
 */
const configured = await configuredMigrations();
const MIGRATION_NAMES = configured.names;
const REGISTERED_MIGRATIONS = configured.registered;

/**
 * Issue #289 — what makes this run's migration template *this run's*.
 *
 * Two halves, and both are proven over a real tree rather than over a value
 * somebody handed the last function in the chain (issue #130): the digest is
 * computed from files on disk, so the fixtures here are directories, and the
 * refusals are proven by trees that are genuinely short of what they claim.
 *
 * The **origin** half is the same defect one layer out (T030b). The floor used
 * to be one comparison against one total, and the tree carries a file of slack
 * — `quote_requests/migrations/status-mapping.ts`, a helper §4 of the naming
 * convention permits — so a registered migration whose file the walk cannot
 * reach was absorbed by it: two platforms that differ in a package's migration
 * computed one digest and shared one template. Every fixture below that names
 * an origin is about that, and the helper appears in them on purpose.
 *
 * No database and no service — this is the reading half.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** A package's migrations, wherever an installed one puts them (D-106.2). */
const PACKAGE_ROOT: MigrationSourceRoot = {
  origin: 'external',
  path: 'packages',
  kind: 'module-tree',
};

const WITH_PACKAGES: readonly MigrationSourceRoot[] = [...MIGRATION_SOURCE_ROOTS, PACKAGE_ROOT];

function core(name: string): RegisteredMigration {
  return { name, origin: 'core' };
}

function external(name: string): RegisteredMigration {
  return { name, origin: 'external' };
}

interface FixtureTree {
  /** Core migration sources, one file each, named `2026010<i>T000000_core_probe.ts`. */
  readonly migrations?: readonly string[];
  /**
   * Non-migration `.ts` files inside a `migrations/` directory — the shape the
   * naming convention's §4 allows and the real tree has exactly one of.
   */
  readonly helpers?: readonly string[];
  /** Package-origin migration sources, under `packages/<name>/migrations/`. */
  readonly packaged?: readonly string[];
  readonly seedSources?: boolean;
}

async function fixtureTree(options: FixtureTree): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'b2b-289-'));
  await mkdir(join(root, 'src/db/migrations'), { recursive: true });
  for (const [index, content] of (options.migrations ?? []).entries()) {
    await writeFile(join(root, `src/db/migrations/2026010${index}T000000_core_probe.ts`), content);
  }
  const helpers = options.helpers ?? [];
  if (helpers.length > 0)
    await mkdir(join(root, 'src/modules/quotes/migrations'), { recursive: true });
  for (const [index, content] of helpers.entries()) {
    await writeFile(
      join(root, `src/modules/quotes/migrations/status-mapping-${index}.ts`),
      content,
    );
  }
  for (const [index, content] of (options.packaged ?? []).entries()) {
    await mkdir(join(root, 'packages/vendor-loyalty/migrations'), { recursive: true });
    await writeFile(
      join(root, `packages/vendor-loyalty/migrations/2026020${index}T000000_loyalty_probe.ts`),
      content,
    );
  }
  if (options.seedSources !== false) {
    for (const declared of TEMPLATE_SEED_SOURCES) {
      await mkdir(join(root, declared, '..'), { recursive: true });
      await writeFile(join(root, declared), '// a seed source');
    }
  }
  return root;
}

describe('the migration set this run has', () => {
  it('is read from the tree, and says what it read', async () => {
    const identity = await templateIdentity();

    expect(identity.digest).toMatch(new RegExp(`^[0-9a-f]{${TEMPLATE_DIGEST_LENGTH}}$`));
    // The order the ORM config runs, not a second spelling of it.
    expect(identity.migrations).toEqual(MIGRATION_NAMES);
    // Every registered migration has a file, so the walk is never short of the
    // registry — that reconciliation is the refusal proven below.
    expect(identity.migrationFiles).toBeGreaterThanOrEqual(MIGRATION_NAMES.length);
    expect(identity.sources.length).toBe(identity.migrationFiles + TEMPLATE_SEED_SOURCES.length);
  });

  it('floors every origin the registry names, on its own', async () => {
    const identity = await templateIdentity();

    // Derived from the registry on every run, never a number written here: the
    // day a package contributes migrations, this expectation grows an origin
    // rather than going quietly stale.
    for (const population of identity.origins) {
      const registered = REGISTERED_MIGRATIONS.filter(
        (migration) => migration.origin === population.origin,
      ).length;
      expect(population.registered).toBe(registered);
      expect(population.migrationFiles).toBeGreaterThanOrEqual(registered);
    }
    expect(identity.origins.map((population) => population.origin)).toEqual([
      ...new Set(REGISTERED_MIGRATIONS.map((migration) => migration.origin)),
    ]);
  });

  it('counts the helper §4 permits as a source and not as a migration', async () => {
    const identity = await templateIdentity();
    // `backend/`-relative, which since feature 080's T040b leaves the repository
    // root: `quote_requests` is a module package and its §4 helper went with it.
    const helper = '../packages/modules/quote_requests/src/migrations/status-mapping.ts';

    // It is read — a migration is free to import it, so its content decides
    // what a template holds — and it is not one, so it settles no floor.
    expect(existsSync(join(BACKEND_ROOT, helper))).toBe(true);
    expect(identity.sources.map((source) => source.path)).toContain(helper);
    const coreOrigin = identity.origins.find((population) => population.origin === 'core');
    expect(coreOrigin?.sourceFiles).toBeGreaterThan(coreOrigin?.migrationFiles ?? 0);
  });

  it('is stable, so two invocations of one tree share a template', async () => {
    const [first, second] = await Promise.all([templateIdentity(), templateIdentity()]);
    expect(second.digest).toBe(first.digest);
  });

  it('folds in every file that seeds a template, and every one of them exists', async () => {
    // A declared seed source that has been renamed away must fail loudly, not
    // silently drop out of the identity — see the refusal below. This half is
    // the ledger's other direction: the paths are real today.
    for (const declared of TEMPLATE_SEED_SOURCES) {
      expect(existsSync(join(BACKEND_ROOT, declared))).toBe(true);
    }
    const identity = await templateIdentity();
    for (const declared of TEMPLATE_SEED_SOURCES) {
      expect(identity.sources.map((source) => source.path)).toContain(declared);
    }
  });
});

describe('a template is never identified from less than it holds', () => {
  const trees: string[] = [];

  afterAll(async () => {
    for (const tree of trees) await rm(tree, { recursive: true, force: true });
  });

  it('refuses a walk that came back short of the registry, naming the origin', async () => {
    // The shape that would reintroduce the defect: a digest over a partial read
    // names a template that holds more than the digest accounts for, which is
    // how two different platforms come to share one database.
    const root = await fixtureTree({ migrations: ['create table a ();'] });
    trees.push(root);
    await expect(
      templateIdentity({
        root,
        migrations: [core('MigrationOne'), core('MigrationTwo'), core('MigrationThree')],
      }),
    ).rejects.toThrow(/'core' migration origin came up short by 2/);
  });

  it('refuses an origin whose sources it cannot see, and says which', async () => {
    // T030b, the live shape: the walk reaches the core tree and nothing else,
    // so a package's migration is registered, ordered, applied — and invisible
    // to the digest. One file of slack (the helper) is all it took to absorb
    // it, because the floor was one comparison against one total.
    const root = await fixtureTree({
      migrations: ['create table a ();'],
      helpers: ['export const map = {};'],
    });
    trees.push(root);
    await expect(
      templateIdentity({ root, migrations: [core('MigrationOne'), external('MigrationLoyalty')] }),
    ).rejects.toThrow(/'external' migration origin came up short by 1/);
  });

  it("does not let one origin's surplus cover another origin's shortfall", async () => {
    // Three core files against one core registration is a surplus of two — and
    // it settles nothing for the origin that is short, which is the whole
    // reason the floor is per origin rather than one bigger number.
    const root = await fixtureTree({
      migrations: ['create table a ();', 'create table b ();', 'create table c ();'],
      helpers: ['export const map = {};'],
    });
    trees.push(root);
    await expect(
      templateIdentity({
        root,
        migrations: [
          core('MigrationOne'),
          external('MigrationLoyaltyOne'),
          external('MigrationLoyaltyTwo'),
        ],
      }),
    ).rejects.toThrow(/'external' migration origin came up short by 2/);
  });

  it('never lets a helper settle a floor, however many of them there are', async () => {
    // The exclusion is about what the file *is* — the naming convention's §1
    // recognizer says it is not a migration — and not about the count working
    // out. Three helpers against one missing migration still refuses.
    const root = await fixtureTree({
      migrations: ['create table a ();'],
      helpers: ['export const a = 1;', 'export const b = 2;', 'export const c = 3;'],
    });
    trees.push(root);
    await expect(
      templateIdentity({ root, migrations: [core('MigrationOne'), core('MigrationTwo')] }),
    ).rejects.toThrow(/'core' migration origin came up short by 1/);
  });

  it('reads a helper into the digest even though it counts toward no floor', async () => {
    const root = await fixtureTree({
      migrations: ['create table a ();'],
      helpers: ['export const map = {};'],
    });
    trees.push(root);
    const identity = await templateIdentity({ root, migrations: [core('MigrationOne')] });

    expect(identity.sources.map((source) => source.path)).toContain(
      'src/modules/quotes/migrations/status-mapping-0.ts',
    );
    expect(identity.origins).toEqual([
      { origin: 'core', registered: 1, migrationFiles: 1, sourceFiles: 2 },
    ]);
  });

  it('refuses a declared seed source it cannot read', async () => {
    const root = await fixtureTree({ migrations: ['create table a ();'], seedSources: false });
    trees.push(root);
    await expect(templateIdentity({ root, migrations: [core('MigrationOne')] })).rejects.toThrow(
      /template seed source/,
    );
  });

  it('moves when a migration changes under an unchanged name', async () => {
    // The defect, at the level the digest sees it: same name, same position,
    // different SQL. Names alone cannot tell these two trees apart.
    const before = await fixtureTree({ migrations: ["insert into x values ('a');"] });
    const after = await fixtureTree({ migrations: ["insert into x values ('b');"] });
    trees.push(before, after);

    const one = await templateIdentity({ root: before, migrations: [core('MigrationOne')] });
    const other = await templateIdentity({ root: after, migrations: [core('MigrationOne')] });
    expect(other.digest).not.toBe(one.digest);
  });

  it('moves when a *package* migration changes under an unchanged name', async () => {
    // The same sentence with the origin changed, which is the one the total
    // floor could not say: two platforms differing only in what a package's
    // migration does are two platforms, and they may not share a template.
    const set = [core('MigrationOne'), external('MigrationLoyaltyProbe')];
    const before = await fixtureTree({
      migrations: ['create table a ();'],
      helpers: ['export const map = {};'],
      packaged: ["insert into x values ('a');"],
    });
    const after = await fixtureTree({
      migrations: ['create table a ();'],
      helpers: ['export const map = {};'],
      packaged: ["insert into x values ('b');"],
    });
    trees.push(before, after);

    const one = await templateIdentity({
      root: before,
      migrations: set,
      sourceRoots: WITH_PACKAGES,
    });
    const other = await templateIdentity({
      root: after,
      migrations: set,
      sourceRoots: WITH_PACKAGES,
    });
    expect(other.digest).not.toBe(one.digest);
  });

  it('reads a package root the instance holds, and records it by name@version', async () => {
    // T033's half of D-155.5: the `external` root exists now, and it is a
    // directory inside an instance's `node_modules` rather than a path under
    // `backend/`. What the digest records for it is `<name>@<version>/…`,
    // because the on-disk path is a property of the instance — a tmpdir here, a
    // container mount in production — and recording that would give one package
    // a different digest in every instance and disable template reuse.
    const instance = await mkdtemp(join(tmpdir(), 'b2b-t033-instance-'));
    trees.push(instance);
    const packageMigrations = join(instance, 'node_modules/@vendor/mod-loyalty/dist/migrations');
    await mkdir(packageMigrations, { recursive: true });
    await writeFile(
      join(packageMigrations, '20260821T120000_loyalty_init.js'),
      'export class Migration20260821T120000LoyaltyInit {}\n',
    );
    await writeFile(join(packageMigrations, 'index.js'), 'export const migrations = [];\n');

    const root = await fixtureTree({ migrations: ['create table a ();'] });
    trees.push(root);
    const roots = await migrationSourceRoots([
      {
        packageName: '@vendor/mod-loyalty',
        version: '4.2.0',
        migrationsDirectory: packageMigrations,
      },
    ]);
    const identity = await templateIdentity({
      root,
      migrations: [core('MigrationOne'), external('Migration20260821T120000LoyaltyInit')],
      sourceRoots: roots,
    });

    const paths = identity.sources.map((source) => source.path);
    expect(paths).toContain('@vendor/mod-loyalty@4.2.0/20260821T120000_loyalty_init.js');
    // `index.js` is read — a migration may import it — and is not a migration,
    // so it settles no floor. Same rule the core helper follows.
    expect(paths).toContain('@vendor/mod-loyalty@4.2.0/index.js');
    expect(paths.some((path) => path.startsWith(instance))).toBe(false);
    expect(identity.origins).toContainEqual({
      origin: 'external',
      registered: 1,
      migrationFiles: 1,
      sourceFiles: 2,
    });
  });

  it('gives two versions of one package two digests', async () => {
    // The identity half, which the class names alone cannot carry: a package
    // that republishes the same class with a different body is a different
    // platform, and `name@version` is what says so.
    const root = await fixtureTree({ migrations: ['create table a ();'] });
    trees.push(root);
    const set = [core('MigrationOne'), external('Migration20260821T120000LoyaltyInit')];

    const digests: string[] = [];
    for (const version of ['1.0.0', '1.0.1']) {
      const instance = await mkdtemp(join(tmpdir(), 'b2b-t033-version-'));
      trees.push(instance);
      const dir = join(instance, 'migrations');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, '20260821T120000_loyalty_init.js'),
        'export class Migration20260821T120000LoyaltyInit {}\n',
      );
      const roots = await migrationSourceRoots([
        { packageName: '@vendor/mod-loyalty', version, migrationsDirectory: dir },
      ]);
      digests.push(
        (await templateIdentity({ root, migrations: set, sourceRoots: roots })).digest,
      );
    }

    expect(digests[0]).not.toBe(digests[1]);
  });

  it('refuses an external root that says nothing about how to record itself', async () => {
    const root = await fixtureTree({ migrations: ['create table a ();'] });
    trees.push(root);
    // Absolute, no `recordAs`: every instance would compute a different digest
    // for the same package and no two runs would ever share a template.
    await expect(
      templateIdentity({
        root,
        migrations: [core('MigrationOne')],
        sourceRoots: [
          ...MIGRATION_SOURCE_ROOTS,
          { origin: 'external', path: tmpdir(), kind: 'directory', sourceExtension: '.js' },
        ],
      }),
    ).rejects.toThrow(/declares no 'recordAs'/);
  });

  it('does not move because the tree sits somewhere else on disk', async () => {
    // Every agent runs from a worktree of their own. Two checkouts of one
    // commit must share a template, so the paths that go into the digest are
    // relative to `backend/` and never absolute. Proven with a package origin
    // in the set as well: a floor that made every run unique would disable
    // template reuse and make every invocation pay a full migration pass.
    const set = [core('MigrationOne'), external('MigrationLoyaltyProbe')];
    const contents = {
      migrations: ['create table a ();'],
      helpers: ['export const map = {};'],
      packaged: ['create table loyalty ();'],
    };
    const here = await fixtureTree(contents);
    const there = await fixtureTree(contents);
    trees.push(here, there);

    expect(
      (await templateIdentity({ root: there, migrations: set, sourceRoots: WITH_PACKAGES })).digest,
    ).toBe(
      (await templateIdentity({ root: here, migrations: set, sourceRoots: WITH_PACKAGES })).digest,
    );
  });
});

describe('the harness reads the order the platform runs', () => {
  it('takes it from the module the ORM config assigns, not from a copy', async () => {
    // `src/db/configured-migrations.ts` exists so that reading the order does
    // not mean importing the ORM config, which captures `DATABASE_URL` at
    // import — the parent process reads this before it knows which database
    // this run will migrate.
    // The config is a factory since T033 — it merges an installed package's
    // migrations, which cannot be known at import — so this awaits it. What the
    // assertion says is unchanged and is the check that matters: a config that
    // stopped merging, or that grew a merge of its own, goes red here.
    const { default: config } = await import('../../../src/db/mikro-orm.config.js');
    const options = await config();
    expect((options.migrations?.migrationsList ?? []).map((entry) => entry.name)).toEqual(
      MIGRATION_NAMES,
    );
  });

  it('reads the origin each registered migration declared, in that order', async () => {
    // The floor is per origin, so the order alone is not enough input: the
    // registry's own `origin` is what says which floor a migration counts
    // toward, and the committed core registry declares none, meaning 'core'.
    const { MIGRATION_REGISTRY } = await import('../../../src/db/migrations-registry.generated.js');
    expect(REGISTERED_MIGRATIONS.map((migration) => migration.name)).toEqual(MIGRATION_NAMES);
    expect(new Set(REGISTERED_MIGRATIONS.map((migration) => migration.origin))).toEqual(
      new Set(MIGRATION_REGISTRY.map((entry) => entry.origin ?? 'core')),
    );
  });
});
