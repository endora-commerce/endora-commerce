import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_DIGEST_LENGTH } from '../../run-isolation.js';
import { TEMPLATE_SEED_SOURCES, templateIdentity } from '../../template-identity.js';
import { MIGRATION_NAMES } from '../../../src/db/configured-migrations.js';

/**
 * Issue #289 — what makes this run's migration template *this run's*.
 *
 * Two halves, and both are proven over a real tree rather than over a value
 * somebody handed the last function in the chain (issue #130): the digest is
 * computed from files on disk, so the fixtures here are directories, and the
 * refusals are proven by trees that are genuinely short of what they claim.
 *
 * No database and no service — this is the reading half.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

async function fixtureTree(options: {
  readonly migrations: readonly string[];
  readonly seedSources?: boolean;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'b2b-289-'));
  await mkdir(join(root, 'src/db/migrations'), { recursive: true });
  for (const [index, content] of options.migrations.entries()) {
    await writeFile(join(root, `src/db/migrations/2026010${index}T000000_core_probe.ts`), content);
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

  it('refuses a walk that came back short of the registry', async () => {
    // The shape that would reintroduce the defect: a digest over a partial read
    // names a template that holds more than the digest accounts for, which is
    // how two different platforms come to share one database.
    const root = await fixtureTree({ migrations: ['create table a ();'] });
    trees.push(root);
    await expect(
      templateIdentity({ root, migrations: ['MigrationOne', 'MigrationTwo', 'MigrationThree'] }),
    ).rejects.toThrow(/partial read/);
  });

  it('refuses a declared seed source it cannot read', async () => {
    const root = await fixtureTree({ migrations: ['create table a ();'], seedSources: false });
    trees.push(root);
    await expect(templateIdentity({ root, migrations: ['MigrationOne'] })).rejects.toThrow(
      /template seed source/,
    );
  });

  it('moves when a migration changes under an unchanged name', async () => {
    // The defect, at the level the digest sees it: same name, same position,
    // different SQL. Names alone cannot tell these two trees apart.
    const before = await fixtureTree({ migrations: ["insert into x values ('a');"] });
    const after = await fixtureTree({ migrations: ["insert into x values ('b');"] });
    trees.push(before, after);

    const one = await templateIdentity({ root: before, migrations: ['MigrationOne'] });
    const other = await templateIdentity({ root: after, migrations: ['MigrationOne'] });
    expect(other.digest).not.toBe(one.digest);
  });

  it('does not move because the tree sits somewhere else on disk', async () => {
    // Every agent runs from a worktree of their own. Two checkouts of one
    // commit must share a template, so the paths that go into the digest are
    // relative to `backend/` and never absolute.
    const here = await fixtureTree({ migrations: ['create table a ();'] });
    const there = await fixtureTree({ migrations: ['create table a ();'] });
    trees.push(here, there);

    expect((await templateIdentity({ root: there, migrations: ['MigrationOne'] })).digest).toBe(
      (await templateIdentity({ root: here, migrations: ['MigrationOne'] })).digest,
    );
  });
});

describe('the harness reads the order the platform runs', () => {
  it('takes it from the module the ORM config assigns, not from a copy', async () => {
    // `src/db/configured-migrations.ts` exists so that reading the order does
    // not mean importing the ORM config, which captures `DATABASE_URL` at
    // import — the parent process reads this before it knows which database
    // this run will migrate.
    const { default: config } = await import('../../../src/db/mikro-orm.config.js');
    expect((config.migrations?.migrationsList ?? []).map((entry) => entry.name)).toEqual(
      MIGRATION_NAMES,
    );
  });
});
