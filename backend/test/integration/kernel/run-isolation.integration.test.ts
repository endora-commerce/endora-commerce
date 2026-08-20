import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import Redis from 'ioredis';
import { redisUrlWithDatabase, withDatabase } from '../../run-isolation.js';
import {
  dropRunDatabase,
  leaseRedisDatabase,
  provisionRunDatabase,
} from '../../run-isolation-provision.js';

/**
 * Issue #189 — the provisioning seam itself, against a live server.
 *
 * Driven over a **throwaway base** of its own rather than the suite's, so it
 * neither depends on nor disturbs the template this invocation was cloned from.
 * The migration callback writes a marker row instead of applying 144 real
 * migrations: what is under test is that a run database is a clone of the
 * template *as the callback left it*, and a marker proves that in a second.
 *
 * The clone also proves the ordering the design depends on. PostgreSQL refuses
 * `create database … template …` while any session is connected to the source,
 * so a `migrateTemplate` whose connection outlived it would fail here with
 * 55006 rather than pass quietly.
 */

const BASE = withDatabase(
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b_test',
  'b2b_189_isolation_test',
);
const TEMPLATE = 'b2b_189_isolation_test_tpl';

const provisioned: string[] = [];

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

/** Stands in for `applyMigrations`: writes something the clone must carry. */
async function markTemplate(templateUrl: string): Promise<void> {
  const client = new Client({ connectionString: templateUrl });
  await client.connect();
  try {
    await client.query('create table if not exists isolation_probe (marker text primary key)');
    await client.query(
      `insert into isolation_probe (marker) values ('from-the-template') on conflict do nothing`,
    );
  } finally {
    // Closed before `provisionRunDatabase` clones — the clone is illegal while
    // anything is connected to the source.
    await client.end();
  }
}

afterAll(async () => {
  for (const name of provisioned) await dropRunDatabase(BASE, name, () => {});
  const client = await admin();
  try {
    await client.query(`drop database if exists "${TEMPLATE}" with (force)`);
  } finally {
    await client.end();
  }
});

describe('a test invocation gets its own database', () => {
  it('clones the migrated template, and the clone carries what the template holds', async () => {
    const run = await provisionRunDatabase({
      baseUrl: BASE,
      configuredMigrations: async () => [],
      migrateTemplate: markTemplate,
      log: () => {},
    });
    provisioned.push(run.name);

    expect(run.template).toBe(TEMPLATE);
    expect(run.name).not.toBe(TEMPLATE);
    expect(await exists(run.name)).toBe(true);

    const client = new Client({ connectionString: run.url });
    await client.connect();
    try {
      const { rows } = await client.query<{ marker: string }>('select marker from isolation_probe');
      expect(rows.map((r) => r.marker)).toEqual(['from-the-template']);
    } finally {
      await client.end();
    }
  }, 60_000);

  it('gives two invocations two databases, even started in the same second', async () => {
    const [first, second] = await Promise.all([
      provisionRunDatabase({
        baseUrl: BASE,
        configuredMigrations: async () => [],
        migrateTemplate: markTemplate,
        log: () => {},
      }),
      provisionRunDatabase({
        baseUrl: BASE,
        configuredMigrations: async () => [],
        migrateTemplate: markTemplate,
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
      configuredMigrations: async () => [],
      migrateTemplate: markTemplate,
      log: () => {},
    });
    expect(await exists(run.name)).toBe(true);
    await dropRunDatabase(BASE, run.name, () => {});
    expect(await exists(run.name)).toBe(false);
  }, 60_000);
});

describe('the template a run is cloned from is this run\'s migration set', () => {
  /** Stands in for `applyMigrations`: logs the names it is given as applied. */
  function applyNames(names: readonly string[]): (templateUrl: string) => Promise<void> {
    return async (templateUrl) => {
      const client = new Client({ connectionString: templateUrl });
      await client.connect();
      try {
        await client.query(
          'create table if not exists mikro_orm_migrations ' +
            '(id serial primary key, name varchar(255), executed_at timestamptz default now())',
        );
        const { rows } = await client.query<{ name: string }>(
          'select name from mikro_orm_migrations order by id asc',
        );
        const applied = new Set(rows.map((row) => row.name));
        for (const name of names) {
          if (applied.has(name)) continue;
          await client.query('insert into mikro_orm_migrations (name) values ($1)', [name]);
        }
      } finally {
        await client.end();
      }
    };
  }

  async function templateQuery<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    const client = new Client({ connectionString: withDatabase(BASE, TEMPLATE) });
    await client.connect();
    try {
      const { rows } = await client.query<T>(sql);
      return rows;
    } finally {
      await client.end();
    }
  }

  it('rebuilds a template another branch migrated into, rather than cloning it', async () => {
    // The template outlives every run and is shared by every branch on the
    // machine. This is the shape that broke
    // `test/integration/catalog/attributes-migration-parity.test.ts`: a name
    // this run's registry does not contain, applied ahead of one it does, so
    // the applied order is not one an append could ever produce.
    const first = await provisionRunDatabase({
      baseUrl: BASE,
      configuredMigrations: async () => ['MigrationOne'],
      migrateTemplate: applyNames(['MigrationOne']),
      log: () => {},
    });
    provisioned.push(first.name);

    const polluter = new Client({ connectionString: withDatabase(BASE, TEMPLATE) });
    await polluter.connect();
    try {
      await polluter.query(
        `insert into mikro_orm_migrations (name) values ('MigrationFromAnotherBranch')`,
      );
      await polluter.query('create table another_branch_table (id int)');
    } finally {
      await polluter.end();
    }

    const second = await provisionRunDatabase({
      baseUrl: BASE,
      configuredMigrations: async () => ['MigrationOne'],
      migrateTemplate: applyNames(['MigrationOne']),
      log: () => {},
    });
    provisioned.push(second.name);

    // Rebuilt from empty and migrated again: the foreign row is gone, and so is
    // the schema it stood for.
    const applied = await templateQuery<{ name: string }>(
      'select name from mikro_orm_migrations order by id asc',
    );
    expect(applied.map((row) => row.name)).toEqual(['MigrationOne']);
    const leftovers = await templateQuery<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'another_branch_table'`,
    );
    expect(leftovers).toHaveLength(0);
  }, 60_000);

  it('leaves a template that is only behind alone, so an append still pays for itself', async () => {
    const before = await provisionRunDatabase({
      baseUrl: BASE,
      configuredMigrations: async () => ['MigrationOne'],
      migrateTemplate: applyNames(['MigrationOne']),
      log: () => {},
    });
    provisioned.push(before.name);

    const marker = new Client({ connectionString: withDatabase(BASE, TEMPLATE) });
    await marker.connect();
    try {
      await marker.query('create table survives_an_append (id int)');
    } finally {
      await marker.end();
    }

    const after = await provisionRunDatabase({
      baseUrl: BASE,
      configuredMigrations: async () => ['MigrationOne', 'MigrationTwo'],
      migrateTemplate: applyNames(['MigrationOne', 'MigrationTwo']),
      log: () => {},
    });
    provisioned.push(after.name);

    const applied = await templateQuery<{ name: string }>(
      'select name from mikro_orm_migrations order by id asc',
    );
    expect(applied.map((row) => row.name)).toEqual(['MigrationOne', 'MigrationTwo']);
    // Untouched: a rebuild here would throw away every migration the template
    // already holds on every run that adds one.
    const survivor = await templateQuery<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'survives_an_append'`,
    );
    expect(survivor).toHaveLength(1);
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
