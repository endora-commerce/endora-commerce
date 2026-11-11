import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_DATABASE_URL_ENV,
  cloneTemplateForCaller,
  dropRunDatabase,
  TEMPLATE_DATABASE_ENV,
} from '@endora-commerce/test-kit/database';

import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import { revertMigration } from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` D-291 R-A7 (tasks.md T073) — a latent data
 * loss: `quote_requests`' workflow migration created
 * `organization_sales_rep_assignments`, which `organizations` maps and which
 * outlives `quote_requests`, and its `down()` dropped it. `module:uninstall
 * quote_requests --hard` reverts the module's chain in reverse, so it destroyed
 * a live `organizations` table.
 *
 * Issue #1033 extends the assertion to the table's reach-governor triggers:
 * `organizations`' `Migration20261109T144721OrganizationsReachGovernor` puts
 * them on the table, and the old `drop table … cascade` would have taken them
 * with it.
 *
 * The chain is reverted here exactly as the orchestrator's hard uninstall does
 * it — every migration the ownership answer names for `quote_requests`, newest
 * first — on a clone of the run's migrated template of this file's own.
 */

let orm: MikroORM;
let drop: () => Promise<void>;
const assignment = randomUUID();

beforeAll(async () => {
  const baseUrl = process.env[BASE_DATABASE_URL_ENV]!;
  const clone = await cloneTemplateForCaller(baseUrl, process.env[TEMPLATE_DATABASE_ENV]!);
  drop = () => dropRunDatabase(baseUrl, clone.name, () => {});
  orm = await MikroORM.init({ ...(await mikroOrmConfig()), clientUrl: clone.url });
  await orm.em
    .getConnection()
    .execute(
      `insert into "organization_sales_rep_assignments" ("id", "organization_id", "admin_user_id", "created_at") values (?, ?, ?, now())`,
      [assignment, randomUUID(), randomUUID()],
    );
}, 300_000);

afterAll(async () => {
  await orm?.close(true);
  await drop?.();
});

describe('module:uninstall quote_requests --hard', () => {
  it('keeps organization_sales_rep_assignments and its rows', async () => {
    const names = [...((await configuredMigrations()).ownership.migrationNamesFor('quote_requests') ?? [])].reverse();
    expect(names).toContain('Migration20260503T141344QuoteRequestsWorkflow');
    for (const name of names) await revertMigration(orm, name);

    const rows = await orm.em
      .getConnection()
      .execute(`select "id" from "organization_sales_rep_assignments" where "id" = ?`, [assignment]);
    expect(rows).toEqual([{ id: assignment }]);

    const triggers = await orm.em
      .getConnection()
      .execute<{ tgname: string }[]>(
        `select tgname from pg_trigger where tgrelid = 'organization_sales_rep_assignments'::regclass and not tgisinternal order by tgname collate "C"`,
      );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'organization_reach_governor_assignments_delete',
      'organization_reach_governor_assignments_insert',
      'organization_reach_governor_assignments_truncate',
      'organization_reach_governor_assignments_update',
    ]);
  }, 300_000);
});
