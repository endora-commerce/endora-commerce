import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deploymentDatabase, type DeploymentDatabase } from '../../helpers/deployment-database.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The off-state proof of an overlay module that owns a table — and the
 * template for one (`specs/190-overlay-full-modules/` FR-046, T092;
 * `contracts/overlay-lifecycle.md` §4; `specs/conventions/module-activation.md`
 * item 6).
 *
 * `check:off-state-coverage` counts every deployment's overlay modules that own
 * tables, so this is the file that proves `example`'s `overlay_notes_fixture`.
 * What is different from a core module's proof is one thing, and it is the
 * whole of the template: **the server runs on the deployment's own database.**
 * The run's database is bare core (OR-13), which has no `overlay_fixture_notes`
 * table and whose ORM maps no overlay entity, so a route reading the table
 * would answer 500 while on and the "restored" half would measure nothing. So
 * the file takes the deployment's template (`deploymentDatabase`, FR-039 — the
 * one every overlay-table test shares) and selects the deployment and that
 * database **in-process** before the server opens its ORM, which reads both at
 * its first call. A test file is its own fork, so nothing leaks.
 *
 * Item 6, surface by surface:
 *
 *  - **API** — its one route answers `MODULE_DISABLED` on both axes and is
 *    restored after (`expectModuleAbsent`);
 *  - **admin** — the presence projection reports it absent while off; it ships
 *    no admin screen, sidebar entry or palette action, so nothing else is
 *    there to be absent;
 *  - **configuration** — its only setting is its activation control, which the
 *    activation endpoint's own contract covers, so there is no `settingWrite`;
 *  - **permissions** — `overlay_notes_fixture:read` leaves the grantable set
 *    while off (the harness's catalogue sweep);
 *  - **storefront** — it contributes none;
 *  - **rows** — off is not uninstall: the note written before the flip is read
 *    back, through the module's own route, once it is on again.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'overlay_notes_fixture';
const NOTES = '/api/v1/admin/overlay-notes-fixture/notes';
const ADMIN = { b2b_session: 'stub-admin-session' };

let database: DeploymentDatabase;
let h: BackendServerHandle;
const restore: Record<string, string | undefined> = {};

beforeAll(async () => {
  database = await deploymentDatabase(DEPLOYMENT);
  for (const name of ['DEPLOYMENT', 'DATABASE_URL']) restore[name] = process.env[name];
  process.env['DEPLOYMENT'] = DEPLOYMENT;
  process.env['DATABASE_URL'] = database.url;
  h = await setupBackendServer({ deployment: DEPLOYMENT });

  const organizationId = randomUUID();
  const connection = h.orm.em.fork().getConnection();
  await connection.execute(
    `insert into "organizations"
       ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
     values (?, 'Overlay off-state', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
    [organizationId, `OVL${organizationId.slice(0, 13).replace(/-/g, '').toUpperCase()}`, `/${organizationId}/`],
  );
  await connection.execute(
    `insert into "overlay_fixture_notes" ("id","organization_id","body","created_at") values (?, ?, 'kept while off', now())`,
    [randomUUID(), organizationId],
  );
}, 180_000);

afterAll(async () => {
  if (h) await teardownBackendServer(h);
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await database?.drop();
});

async function notes(): Promise<number> {
  const res = await h.app.inject({ method: 'GET', url: NOTES, cookies: ADMIN });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { notes: number }).notes;
}

describe('overlay_notes_fixture while it is off [integration]', () => {
  it('answers its route from its own table while on', async () => {
    expect(await notes()).toBe(1);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, MODULE_ID, {
      routes: [{ url: NOTES, cookies: ADMIN }],
      adminPresence: { cookies: ADMIN },
    });
  });

  it('kept its rows: switching it off dropped nothing', async () => {
    expect(await notes()).toBe(1);
  });
});
