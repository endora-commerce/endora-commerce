import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OverlayFixtureNote } from '../../../src/apps/example/modules/overlay_notes_fixture/entities/overlay-fixture-note.entity.js';
import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { deploymentDatabase, type DeploymentDatabase } from '../../helpers/deployment-database.js';

/**
 * An overlay module that owns a table, end to end in this repository
 * (`specs/190-overlay-full-modules/` US1, FR-030 – FR-036, T079; #1850).
 *
 * `example`'s `overlay_notes_fixture` ships one organization-scoped entity and
 * one migration. With the deployment selected **in-process** (FR-040 — no suite
 * leg runs with it), the platform reads both at runtime from the deployment
 * root: the migration is applied in the module's topological position, owned by
 * the module for `uninstall --hard`, and the entity is mapped under the tenancy
 * filter, so one organization's note is "not found" from another's.
 *
 * The database is the deployment's own template (`deploymentDatabase`), which
 * every overlay-table test shares; the run's bare-core database has no such
 * table and must not be given one.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'overlay_notes_fixture';

let database: DeploymentDatabase;
let orm: MikroORM;

const system: TenantContext = { mode: 'system', actor: { kind: 'system' }, reason: 'overlay-table seed' };
const singleOrg = (organizationId: string): TenantContext => ({
  mode: 'single-org',
  organizationId,
  actor: { kind: 'admin', id: 'overlay-table-test' },
});

async function organization(name: string): Promise<string> {
  const id = randomUUID();
  await orm.em.getConnection().execute(
    `insert into "organizations"
       ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
     values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
    [id, name, `OVL${id.slice(0, 13).replace(/-/g, '').toUpperCase()}`, `/${id}/`],
  );
  return id;
}

beforeAll(async () => {
  database = await deploymentDatabase(DEPLOYMENT);
  orm = await MikroORM.init(await database.config());
}, 180_000);

afterAll(async () => {
  await orm?.close(true);
  await database?.drop();
});

describe('an overlay module that owns a table [integration]', () => {
  it('its migration is applied, after the module it depends on, and recorded under its class name', async () => {
    const order = (await configuredMigrations(database.env)).names;
    const own = order.filter((name) => name.startsWith('Migration') && name.includes('OverlayNotesFixture'));
    // Its own migration, preceded by the step generated from its one `x_*`
    // declaration on `organizations` (#1853, FR-065) at the head of its block.
    expect(own).toEqual([
      expect.stringMatching(/^Migration10000101T000000OverlayNotesFixtureSchemaExtensions[0-9a-f]{12}$/),
      'Migration20261125T120000OverlayNotesFixtureCreateNotes',
    ]);
    const firstOrganizations = order.findIndex((name) => /^Migration\d{8}T\d{6}Organizations/.test(name));
    expect(firstOrganizations).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(own[0]!)).toBeGreaterThan(firstOrganizations);

    const applied = (await orm.em
      .getConnection()
      .execute('select "name" from "mikro_orm_migrations"')) as { name: string }[];
    expect(applied.map((row) => row.name)).toEqual(expect.arrayContaining(own));
  });

  it('is owned by the module, so a hard uninstall can enumerate its chain (FR-036)', async () => {
    const { ownership } = await configuredMigrations(database.env);
    expect(ownership.migrationNamesFor(MODULE_ID)).toEqual([
      expect.stringMatching(/^Migration10000101T000000OverlayNotesFixtureSchemaExtensions[0-9a-f]{12}$/),
      'Migration20261125T120000OverlayNotesFixtureCreateNotes',
    ]);
  });

  it('maps its entity, and another organization\'s row is not found (Principle XI)', async () => {
    const mine = await organization('Overlay notes — mine');
    const theirs = await organization('Overlay notes — theirs');

    const noteId = await runWithTenantContext(system, async () => {
      const em = orm.em.fork();
      const note = em.create(OverlayFixtureNote, { organizationId: theirs, body: 'their note' });
      await em.persist(note).flush();
      return note.id;
    });

    const fromTheirs = await runWithTenantContext(singleOrg(theirs), () =>
      orm.em.fork().findOne(OverlayFixtureNote, { id: noteId }),
    );
    expect(fromTheirs?.body).toBe('their note');

    const fromMine = await runWithTenantContext(singleOrg(mine), () =>
      orm.em.fork().findOne(OverlayFixtureNote, { id: noteId }),
    );
    expect(fromMine).toBeNull();
  });
});

describe('bare core in the same process keeps its own order', () => {
  it('names no overlay migration with no deployment selected', async () => {
    const { names } = await configuredMigrations({ ...process.env, DEPLOYMENT: '' });
    expect(names.some((name) => name.includes('OverlayNotesFixture'))).toBe(false);
  });
});
