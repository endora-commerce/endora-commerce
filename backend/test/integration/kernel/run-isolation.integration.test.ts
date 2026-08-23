import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { Redis } from 'ioredis';
import {
  formatTemplateProvenance,
  redisUrlWithDatabase,
  templateDatabaseName,
  templateDigest,
  withDatabase,
} from '../../run-isolation.js';
import {
  cloneTemplateForCaller,
  dropRunDatabase,
  leaseRedisDatabase,
  provisionRunDatabase,
  sweepStaleTemplates,
} from '../../run-isolation-provision.js';

/**
 * Issues #189 and #289 — the provisioning seam itself, against a live server.
 *
 * Driven over a **throwaway base** of its own rather than the suite's, so it
 * neither depends on nor disturbs the template this invocation was cloned from.
 * The migration callback writes a marker row instead of applying 157 real
 * migrations: what is under test is that a run database is a clone of the
 * template *as the callback left it*, and a marker proves that in a second.
 *
 * The clone also proves the ordering the design depends on. PostgreSQL refuses
 * `create database … template …` while any session is connected to the source,
 * so a `migrateTemplate` whose connection outlived it would fail here with
 * 55006 rather than pass quietly.
 */

const BASE_NAME = 'b2b_189_isolation_test';
const BASE = withDatabase(
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b_test',
  BASE_NAME,
);

const provisioned: string[] = [];

/** A migration set, spelled the way `template-identity.ts` spells one. */
function identityOf(migrations: readonly string[], content: string) {
  const sources = [{ path: 'src/db/migrations/probe.ts', sha256: content.padEnd(64, '0') }];
  return {
    digest: templateDigest({ migrations, sources }),
    migrations,
    migrationFiles: sources.length,
    origins: [{ origin: 'core', registered: migrations.length, migrationFiles: sources.length }],
  };
}

async function admin(): Promise<Client> {
  const client = new Client({ connectionString: withDatabase(BASE, 'postgres') });
  await client.connect();
  return client;
}

async function exists(name: string): Promise<boolean> {
  const client = await admin();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    return (rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}

async function query<T extends Record<string, unknown>>(
  database: string,
  sql: string,
): Promise<T[]> {
  const client = new Client({ connectionString: withDatabase(BASE, database) });
  await client.connect();
  try {
    const { rows } = await client.query<T>(sql);
    return rows;
  } finally {
    await client.end();
  }
}

/** Stands in for `applyMigrations`: writes something the clone must carry. */
function seedTemplate(marker: string, names: readonly string[] = []) {
  return async (templateUrl: string): Promise<void> => {
    const client = new Client({ connectionString: templateUrl });
    await client.connect();
    try {
      await client.query('create table if not exists isolation_probe (marker text primary key)');
      await client.query(
        'insert into isolation_probe (marker) values ($1) on conflict do nothing',
        [marker],
      );
      await client.query(
        'create table if not exists mikro_orm_migrations ' +
          '(id serial primary key, name varchar(255), executed_at timestamptz default now())',
      );
      for (const name of names) {
        await client.query('insert into mikro_orm_migrations (name) values ($1)', [name]);
      }
    } finally {
      // Closed before `provisionRunDatabase` clones — the clone is illegal while
      // anything is connected to the source.
      await client.end();
    }
  };
}

afterAll(async () => {
  for (const name of provisioned) await dropRunDatabase(BASE, name, () => {});
  const client = await admin();
  try {
    const { rows } = await client.query<{ datname: string }>(
      'select datname from pg_database where datname like $1',
      [`${BASE_NAME}_tpl%`],
    );
    for (const row of rows) {
      await client.query(`drop database if exists "${row.datname}" with (force)`);
    }
  } finally {
    await client.end();
  }
});

describe('a test invocation gets its own database', () => {
  it('clones the migrated template, and the clone carries what the template holds', async () => {
    const identity = identityOf(['MigrationOne'], 'a');
    const run = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: seedTemplate('from-the-template', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(run.name);

    expect(run.template).toBe(templateDatabaseName(BASE_NAME, identity.digest));
    expect(run.name).not.toBe(run.template);
    expect(await exists(run.name)).toBe(true);

    const rows = await query<{ marker: string }>(run.name, 'select marker from isolation_probe');
    expect(rows.map((r) => r.marker)).toEqual(['from-the-template']);
  }, 60_000);

  it('gives two invocations two databases, even started in the same second', async () => {
    const identity = identityOf(['MigrationOne'], 'a');
    const [first, second] = await Promise.all([
      provisionRunDatabase({
        baseUrl: BASE,
        identity,
        migrateTemplate: seedTemplate('from-the-template', ['MigrationOne']),
        log: () => {},
      }),
      provisionRunDatabase({
        baseUrl: BASE,
        identity,
        migrateTemplate: seedTemplate('from-the-template', ['MigrationOne']),
        log: () => {},
      }),
    ]);
    provisioned.push(first.name, second.name);

    expect(first.name).not.toBe(second.name);
    expect(await exists(first.name)).toBe(true);
    expect(await exists(second.name)).toBe(true);
  }, 60_000);

  it('drops the database the run owned', async () => {
    const run = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'a'),
      migrateTemplate: seedTemplate('from-the-template', ['MigrationOne']),
      log: () => {},
    });
    expect(await exists(run.name)).toBe(true);
    await dropRunDatabase(BASE, run.name, () => {});
    expect(await exists(run.name)).toBe(false);
  }, 60_000);
});

describe("the template a run is cloned from is this run's migration set (issue #289)", () => {
  it('does not hand one branch a template another branch built', async () => {
    // The measured defect. Two worktrees carrying the same migration *names*
    // and different content — one agent iterating on an unmerged data
    // migration, which is an ordinary morning. Before this, the second run
    // cloned the first one's template and failed against a row seeded by a
    // branch it had never seen, with the offending string appearing nowhere in
    // its own tree.
    const branchA = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'a'),
      migrateTemplate: seedTemplate('seeded-by-branch-a', ['MigrationOne']),
      log: () => {},
    });
    const branchB = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'b'),
      migrateTemplate: seedTemplate('seeded-by-branch-b', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(branchA.name, branchB.name);

    expect(branchA.template).not.toBe(branchB.template);
    const rows = await query<{ marker: string }>(
      branchB.name,
      'select marker from isolation_probe',
    );
    expect(rows.map((r) => r.marker)).toEqual(['seeded-by-branch-b']);
  }, 60_000);

  it('shares one template between runs whose platform is the same, and migrates once', async () => {
    // The other half of the bargain: keying by the set must not turn every run
    // into a migration pass. A second run of the same tree clones what is there.
    const identity = identityOf(['MigrationOne'], 'shared');
    let migrations = 0;
    const migrate = async (url: string): Promise<void> => {
      migrations += 1;
      await seedTemplate('shared', ['MigrationOne'])(url);
    };

    const first = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: migrate,
      log: () => {},
    });
    const second = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: migrate,
      log: () => {},
    });
    provisioned.push(first.name, second.name);

    expect(second.template).toBe(first.template);
    expect(migrations).toBe(1);
  }, 60_000);

  it('rebuilds a template that cannot say what it holds, rather than cloning it', async () => {
    // A template of unknown provenance is the defect itself: a database whose
    // contents nothing accounts for. The shapes are a build that died before it
    // signed itself, a template an older version of this harness left, and a
    // hand-made database that happens to fit the name.
    const identity = identityOf(['MigrationOne'], 'provenance');
    const first = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: seedTemplate('rebuilt', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(first.name);

    const client = await admin();
    try {
      await client.query(`comment on database "${first.template}" is 'left by something else'`);
    } finally {
      await client.end();
    }
    const polluter = new Client({ connectionString: withDatabase(BASE, first.template) });
    await polluter.connect();
    try {
      await polluter.query('create table another_branch_table (id int)');
    } finally {
      await polluter.end();
    }

    const second = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: seedTemplate('rebuilt', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(second.name);

    const leftovers = await query<{ table_name: string }>(
      second.name,
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'another_branch_table'`,
    );
    expect(leftovers).toHaveLength(0);
  }, 60_000);

  it('rebuilds a template whose migrations disagree with what it says', async () => {
    // The provenance says the right thing and the database does not — a build
    // interrupted after its comment, or somebody's psql session. The comment is
    // one claim and `mikro_orm_migrations` is another; a clone needs both.
    const identity = identityOf(['MigrationOne'], 'disagreement');
    const first = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: seedTemplate('agreed', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(first.name);

    const polluter = new Client({ connectionString: withDatabase(BASE, first.template) });
    await polluter.connect();
    try {
      await polluter.query(
        "insert into mikro_orm_migrations (name) values ('MigrationFromAnotherBranch')",
      );
    } finally {
      await polluter.end();
    }

    const lines: string[] = [];
    const second = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: seedTemplate('agreed', ['MigrationOne']),
      log: (line) => lines.push(line),
    });
    provisioned.push(second.name);

    const applied = await query<{ name: string }>(
      second.name,
      'select name from mikro_orm_migrations order by id asc',
    );
    expect(applied.map((row) => row.name)).toEqual(['MigrationOne']);
    expect(lines.join('\n')).toContain('building it from empty');
  }, 60_000);

  it('refuses to clone a template it cannot verify, rather than migrating into the wrong one', async () => {
    // `migrateTemplate` left the template holding something else — the live
    // hazard while the ORM config resolves its DSN from an ambient variable.
    // Silence here would hand every file in the run a database that is quietly
    // not the platform its branch describes.
    await expect(
      provisionRunDatabase({
        baseUrl: BASE,
        identity: identityOf(['MigrationOne', 'MigrationTwo'], 'unverifiable'),
        migrateTemplate: seedTemplate('half-migrated', ['MigrationOne']),
        log: () => {},
      }),
    ).rejects.toThrow(/not this run's migration set/);
  }, 60_000);

  it('gives a migrator-driving file the template its own run was cloned from', async () => {
    // The clone happens mid-run, by which time another invocation may have
    // built a template of its own. It is named, not re-derived, so what it
    // clones is this run's platform however many templates the cluster holds.
    const identity = identityOf(['MigrationOne'], 'named');
    const run = await provisionRunDatabase({
      baseUrl: BASE,
      identity,
      migrateTemplate: seedTemplate('this-runs-platform', ['MigrationOne']),
      log: () => {},
    });
    const other = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'another-branch'),
      migrateTemplate: seedTemplate('another-branch', ['MigrationOne']),
      log: () => {},
    });
    const clone = await cloneTemplateForCaller(BASE, run.template);
    provisioned.push(run.name, other.name, clone.name);

    const rows = await query<{ marker: string }>(clone.name, 'select marker from isolation_probe');
    expect(rows.map((r) => r.marker)).toEqual(['this-runs-platform']);
  }, 60_000);

  it('says so rather than cloning something else when its template is gone', async () => {
    const run = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'vanishing'),
      migrateTemplate: seedTemplate('vanishing', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(run.name);
    const client = await admin();
    try {
      await client.query(`drop database if exists "${run.template}" with (force)`);
    } finally {
      await client.end();
    }

    await expect(cloneTemplateForCaller(BASE, run.template)).rejects.toThrow(/is gone/);
  }, 60_000);
});

describe('templates no branch uses any more are collected', () => {
  it('drops one nothing has used for a day, and never the one in use', async () => {
    const mine = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'in-use'),
      migrateTemplate: seedTemplate('in-use', ['MigrationOne']),
      log: () => {},
    });
    const abandoned = await provisionRunDatabase({
      baseUrl: BASE,
      identity: identityOf(['MigrationOne'], 'abandoned'),
      migrateTemplate: seedTemplate('abandoned', ['MigrationOne']),
      log: () => {},
    });
    provisioned.push(mine.name, abandoned.name);

    const client = await admin();
    try {
      // Aged by rewriting its own provenance — the sweep reads when a template
      // was last used, not when it was built.
      await client.query(
        `comment on database "${abandoned.template}" is '${formatTemplateProvenance({
          digest: 'ffffffffffff',
          migrations: 1,
          lastUsedAt: new Date(Date.now() - 48 * 3600_000),
        })}'`,
      );
      const dropped = await sweepStaleTemplates(client, BASE_NAME, mine.template, () => {});
      expect(dropped).toContain(abandoned.template);
      expect(dropped).not.toContain(mine.template);
    } finally {
      await client.end();
    }

    expect(await exists(abandoned.template)).toBe(false);
    expect(await exists(mine.template)).toBe(true);
  }, 60_000);
});

describe('a test invocation gets its own Redis logical database', () => {
  it('leases an index of its own, empties it, and gives it back', async () => {
    // This invocation already holds one, so these two are the second and third
    // concurrent claim — which is the property under test.
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    const first = await leaseRedisDatabase(redisUrl, 'run-isolation-test-1', () => {});
    const second = await leaseRedisDatabase(redisUrl, 'run-isolation-test-2', () => {});
    try {
      expect(first.index).toBeGreaterThan(0);
      expect(second.index).toBeGreaterThan(0);
      expect(first.index).not.toBe(second.index);
      // The leased index is this run's alone, so what a crashed run left in it
      // is gone before the first test sees it.
      const client = new Redis(first.url, { maxRetriesPerRequest: null });
      try {
        expect(await client.dbsize()).toBe(0);
      } finally {
        client.disconnect();
      }
    } finally {
      await first.release();
      await second.release();
    }

    // Released, so the next invocation can take them. The leases live in index
    // 0 whatever index this invocation is running against.
    const registry = new Redis(redisUrlWithDatabase(redisUrl, 0), { maxRetriesPerRequest: null });
    try {
      expect(await registry.get(`b2b:test-run-lease:${first.index}`)).toBeNull();
    } finally {
      registry.disconnect();
    }
  }, 30_000);
});
