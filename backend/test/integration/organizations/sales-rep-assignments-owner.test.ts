import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/postgresql';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_DATABASE_URL_ENV,
  cloneTemplateForCaller,
  dropRunDatabase,
  TEMPLATE_DATABASE_ENV,
} from '@endora-commerce/test-kit/database';
import { AuditLogService, ModuleRegistration } from '@endora-commerce/platform/composition';
import {
  LifecycleError,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
  type LoadedManifestRegistry,
} from '@endora-commerce/platform/lifecycle';

import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  applyMigration,
  compositionOf,
  migrateComposition,
} from '../../helpers/partial-composition.js';
import { revertMigration, throwawayDatabase, type ThrowawayDatabase } from '../../helpers/schema-extension-fixture.js';

/**
 * Issue #1033 — `organization_sales_rep_assignments` is created by its owner.
 *
 * `organizations` maps, writes and puts triggers on the table, but until this
 * issue only `quote_requests`' `Migration20260503T141344QuoteRequestsWorkflow`
 * created it. A platform composing `organizations` without `quote_requests`
 * therefore stopped at `Migration20261109T144721OrganizationsReachGovernor`,
 * whose triggers name the table. The repair creates it in that migration with
 * `if not exists`, and guards the historical statement in `20260503` the same
 * way, so an instance that installs `quote_requests` later does not meet
 * `relation already exists` (D-291 addendum R-A8,
 * `specs/178-extensible-columns/spec.md`).
 *
 * Two kinds of database: a throwaway one migrated from empty over the
 * `organizations` composition alone, then over `quote_requests` arriving late;
 * and a clone of the run's template, which every module migrated from empty.
 */

const TABLE = 'organization_sales_rep_assignments';
const REACH_GOVERNOR = 'Migration20261109T144721OrganizationsReachGovernor';
const QUOTE_REQUESTS_WORKFLOW = 'Migration20260503T141344QuoteRequestsWorkflow';

/** The shape every database must end up with — the table as `20260503` created it. */
const REFERENCE_SHAPE = {
  columns: [
    { name: 'id', type: 'uuid', nullable: 'NO', default: null },
    { name: 'organization_id', type: 'uuid', nullable: 'NO', default: null },
    { name: 'admin_user_id', type: 'uuid', nullable: 'NO', default: null },
    { name: 'assigned_by_admin_user_id', type: 'uuid', nullable: 'YES', default: null },
    { name: 'created_at', type: 'timestamp with time zone', nullable: 'NO', default: null },
  ],
  constraints: [
    { name: 'organization_sales_rep_assignments_pkey', definition: 'PRIMARY KEY (id)' },
    { name: 'orgsa_unique', definition: 'UNIQUE (organization_id, admin_user_id)' },
  ],
  indexes: [
    {
      name: 'organization_sales_rep_assignments_pkey',
      definition:
        'CREATE UNIQUE INDEX organization_sales_rep_assignments_pkey ON public.organization_sales_rep_assignments USING btree (id)',
    },
    {
      name: 'orgsa_admin_user_idx',
      definition:
        'CREATE INDEX orgsa_admin_user_idx ON public.organization_sales_rep_assignments USING btree (admin_user_id)',
    },
    {
      name: 'orgsa_organization_idx',
      definition:
        'CREATE INDEX orgsa_organization_idx ON public.organization_sales_rep_assignments USING btree (organization_id)',
    },
    {
      name: 'orgsa_unique',
      definition:
        'CREATE UNIQUE INDEX orgsa_unique ON public.organization_sales_rep_assignments USING btree (organization_id, admin_user_id)',
    },
  ],
  triggers: [
    'organization_reach_governor_assignments_delete',
    'organization_reach_governor_assignments_insert',
    'organization_reach_governor_assignments_truncate',
    'organization_reach_governor_assignments_update',
  ],
} as const;

type Query = <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;

/** The table's shape as `pg_catalog` / `information_schema` report it. */
async function shapeOf(query: Query) {
  const tables = await query<{ n: string }>(
    `select count(*)::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
    [TABLE],
  );
  const columns = await query<{ name: string; type: string; nullable: string; default: string | null }>(
    `select column_name as name, data_type as type, is_nullable as nullable, column_default as default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [TABLE],
  );
  const constraints = await query<{ name: string; definition: string }>(
    `select conname as name, pg_get_constraintdef(oid) as definition
       from pg_constraint where conrelid = $1::regclass
      order by conname collate "C"`,
    [TABLE],
  );
  const indexes = await query<{ name: string; definition: string }>(
    `select indexname as name, indexdef as definition
       from pg_indexes where schemaname = 'public' and tablename = $1
      order by indexname collate "C"`,
    [TABLE],
  );
  const triggers = await query<{ name: string }>(
    `select tgname as name from pg_trigger where tgrelid = $1::regclass and not tgisinternal order by tgname`,
    [TABLE],
  );
  return {
    tables: Number(tables[0]!.n),
    columns,
    constraints,
    indexes,
    triggers: triggers.map((row) => row.name),
  };
}

const EXPECTED = { tables: 1, ...REFERENCE_SHAPE };

describe('organization_sales_rep_assignments — a platform without quote_requests (#1033)', () => {
  let db: ThrowawayDatabase;
  const organizationsOnly = compositionOf('organizations');
  const withQuoteRequests = compositionOf('organizations', 'quote_requests');
  const assignment = randomUUID();

  beforeAll(async () => {
    db = await throwawayDatabase('i1033');
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('composes organizations without quote_requests', () => {
    expect(organizationsOnly.has('organizations')).toBe(true);
    expect(organizationsOnly.has('quote_requests')).toBe(false);
  });

  it('migrates a fresh database, and the owner creates the table with the reference shape', async () => {
    const applied = await migrateComposition(db.url, organizationsOnly);
    expect(applied).toContain(REACH_GOVERNOR);
    expect(applied).not.toContain(QUOTE_REQUESTS_WORKFLOW);

    expect(await shapeOf(db.query)).toEqual(EXPECTED);
  }, 600_000);

  it('installs quote_requests later, leaving the table and its rows as they were', async () => {
    await db.query(
      `insert into "${TABLE}" ("id", "organization_id", "admin_user_id", "created_at") values ($1, $2, $3, now())`,
      [assignment, randomUUID(), randomUUID()],
    );

    const applied = await migrateComposition(db.url, withQuoteRequests);
    expect(applied).toContain(QUOTE_REQUESTS_WORKFLOW);
    expect(applied).not.toContain(REACH_GOVERNOR);

    expect(await shapeOf(db.query)).toEqual(EXPECTED);
    expect(await db.query(`select "id" from "${TABLE}"`)).toEqual([{ id: assignment }]);
  }, 600_000);
});

describe('organization_sales_rep_assignments — a platform composing every module (#1033)', () => {
  let orm: MikroORM;
  let redis: Redis;
  let drop: () => Promise<void>;
  let query: Query;
  const assignment = randomUUID();

  beforeAll(async () => {
    const baseUrl = process.env[BASE_DATABASE_URL_ENV]!;
    const clone = await cloneTemplateForCaller(baseUrl, process.env[TEMPLATE_DATABASE_ENV]!);
    drop = () => dropRunDatabase(baseUrl, clone.name, () => {});
    orm = await MikroORM.init({ ...(await mikroOrmConfig()), clientUrl: clone.url });
    query = async (sql, params = []) =>
      (await orm.em.getConnection().execute(sql.replace(/\$\d+/g, '?'), params)) as never;
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    await query(
      `insert into "${TABLE}" ("id", "organization_id", "admin_user_id", "created_at") values ($1, $2, $3, now())`,
      [assignment, randomUUID(), randomUUID()],
    );
  }, 300_000);

  afterAll(async () => {
    redis?.disconnect();
    await orm?.close(true);
    await drop?.();
  });

  it('holds exactly one table, with the reference shape', async () => {
    expect(await shapeOf(query)).toEqual(EXPECTED);
  });

  it('survives reverting and re-applying the owner migration, triggers included', async () => {
    await revertMigration(orm, REACH_GOVERNOR);
    expect(await query(`select "id" from "${TABLE}" where "id" = $1`, [assignment])).toEqual([
      { id: assignment },
    ]);
    expect((await shapeOf(query)).triggers).toEqual([]);

    await applyMigration(orm, REACH_GOVERNOR);
    expect(await shapeOf(query)).toEqual(EXPECTED);
    expect(await query(`select "id" from "${TABLE}" where "id" = $1`, [assignment])).toEqual([
      { id: assignment },
    ]);
  }, 300_000);

  it.each([false, true])(
    'refuses `module:uninstall organizations` (hard: %s) as non-deactivatable and touches nothing',
    async (hard) => {
      const entries = REGISTERED_MANIFESTS.map((entry) => ({
        manifest: entry.manifest,
        filePath: entry.filePath,
      }));
      const registry: LoadedManifestRegistry = {
        modules: new Map(entries.map((entry) => [entry.manifest.id, entry])) as never,
        graph: new ModuleDepGraph(entries.map((entry) => entry.manifest)),
        participants: [],
      };
      const em = () => orm.em.fork();
      // The template migrates the schema and installs nothing, so the row a
      // running platform holds for `organizations` is seeded here: without it
      // the orchestrator answers `already-uninstalled` before any refusal.
      const seed = em();
      const now = new Date();
      await seed.upsert(ModuleRegistration, {
        moduleId: 'organizations',
        state: 'installed',
        version: '1.0.0',
        installedAt: now,
        lastStateChangeAt: now,
        lastInstallFailedAt: null,
        lastInstallError: null,
      });
      const orchestrator = new ModuleLifecycleOrchestrator({
        orm,
        redis,
        em,
        auditLog: new AuditLogService(em),
        registry,
      });

      const refusal = await orchestrator.uninstall('organizations', { hard }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(LifecycleError);
      expect((refusal as LifecycleError).kind).toBe('non-deactivatable');

      expect(await shapeOf(query)).toEqual(EXPECTED);
      expect(await query(`select "id" from "${TABLE}" where "id" = $1`, [assignment])).toEqual([
        { id: assignment },
      ]);
    },
    60_000,
  );
});
