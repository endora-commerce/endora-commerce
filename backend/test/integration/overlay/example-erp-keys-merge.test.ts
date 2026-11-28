import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EXAMPLE_ERP_KEY_KEPT,
  EXAMPLE_ERP_KEYS_MERGE_KEY,
  EXAMPLE_ERP_KEYS_MERGE_REASSIGN_ACTION,
} from '../../../src/apps/example/modules/example_erp_keys/merge.js';
import { deploymentDatabase, type DeploymentDatabase } from '../../helpers/deployment-database.js';
import {
  composedOrganizationParticipant,
  expectComposedOrganizationParticipant,
  insertOrganizationPair,
  mergeSql,
  seedRows,
} from '../../helpers/organization-merge-conformance.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * `example_erp_keys` in an Organization merge (`specs/192-organization-merge/`
 * FR-045, disposition `survivor_wins_fill_gaps`). A key names one Organization
 * in the ERP and is unique across the shop:
 *
 *  - a survivor with no key inherits the loser's (the same row, re-pointed);
 *  - a survivor with a key keeps it, and the loser's stays on the archived
 *    loser, listed in the preview for the integrator to reconcile in the ERP.
 *
 * As `example-erp-keys.test.ts` sets out, the server runs on the deployment's
 * own database: the run's bare-core database has no such table.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'example_erp_keys';
const TABLE = 'example_erp_keys_organization_keys';

let database: DeploymentDatabase;
let h: BackendServerHandle;
const restore: Record<string, string | undefined> = {};

const keyRow = (organizationId: string, erpKey: string) =>
  [`insert into "${TABLE}" ("organization_id", "erp_key", "created_at") values (?, ?, now())`, [organizationId, erpKey]] as const;
const uniqueKey = (): string => `ERP-${randomUUID().slice(0, 12).toUpperCase()}`;

beforeAll(async () => {
  database = await deploymentDatabase(DEPLOYMENT);
  for (const name of ['DEPLOYMENT', 'DATABASE_URL']) restore[name] = process.env[name];
  process.env['DEPLOYMENT'] = DEPLOYMENT;
  process.env['DATABASE_URL'] = database.url;
  h = await setupBackendServer({ deployment: DEPLOYMENT });
}, 180_000);

afterAll(async () => {
  if (h) await teardownBackendServer(h);
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await database?.drop();
});

describe('example_erp_keys — Organization merge participant [integration]', () => {
  it('moves the loser’s key to a survivor that has none, auditing the step and not the key', async () => {
    const loserKey = uniqueKey();
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: MODULE_ID,
      key: EXAMPLE_ERP_KEYS_MERGE_KEY,
      action: EXAMPLE_ERP_KEYS_MERGE_REASSIGN_ACTION,
      seed: ({ loserId }) => seedRows(h, [keyRow(loserId, loserKey)]),
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(h, `select "organization_id", "erp_key" from "${TABLE}" where "organization_id" in (?, ?) order by "organization_id"`, [
          survivorId,
          loserId,
        ]),
      failOn: { table: TABLE, on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });

    expect(outcome.moved).toBe(1);
    const rows = await mergeSql<Array<{ organization_id: string }>>(h, `select "organization_id" from "${TABLE}" where "erp_key" = ?`, [loserKey]);
    expect(rows.map((row) => row.organization_id)).toEqual([outcome.survivorId]);
    const audit = await mergeSql<Array<{ state_after: unknown }>>(
      h,
      `select "state_after" from "audit_log_entries" where "action" = ? and "state_after" ->> 'mergeId' = ?`,
      [EXAMPLE_ERP_KEYS_MERGE_REASSIGN_ACTION, outcome.mergeId],
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(loserKey);
  });

  it('keeps the survivor’s key, leaves the loser’s on the archived loser, and lists it in the preview', async () => {
    const participant = composedOrganizationParticipant(h, MODULE_ID, EXAMPLE_ERP_KEYS_MERGE_KEY);
    const { survivorId, loserId } = await insertOrganizationPair(h);
    const survivorKey = uniqueKey();
    const loserKey = uniqueKey();
    await seedRows(h, [keyRow(survivorId, survivorKey), keyRow(loserId, loserKey)]);

    const preview = await participant.preview({ hostType: 'organization', survivorId, loserId, hostContext: {} });
    expect(preview.counts).toEqual({ 'ExampleErpOrganizationKey.organizationId': 0 });
    expect(preview.warnings).toEqual([{ code: EXAMPLE_ERP_KEY_KEPT, details: { loserId } }]);

    const mergeId = randomUUID();
    const { moved } = await participant.applyBatch({ hostType: 'organization', survivorId, loserId, mergeId, batchSize: 100, hostContext: {} });
    expect(moved).toBe(0);

    const rows = await mergeSql<Array<{ organization_id: string; erp_key: string }>>(
      h,
      `select "organization_id", "erp_key" from "${TABLE}" where "organization_id" in (?, ?) order by "erp_key"`,
      [survivorId, loserId],
    );
    expect(new Map(rows.map((row) => [row.organization_id, row.erp_key]))).toEqual(
      new Map([
        [survivorId, survivorKey],
        [loserId, loserKey],
      ]),
    );
    // A step that moved nothing writes no audit entry.
    const audit = await mergeSql<unknown[]>(h, `select 1 from "audit_log_entries" where "state_after" ->> 'mergeId' = ?`, [mergeId]);
    expect(audit).toHaveLength(0);
  });

  it('previews nothing for a loser without a key', async () => {
    const participant = composedOrganizationParticipant(h, MODULE_ID, EXAMPLE_ERP_KEYS_MERGE_KEY);
    const { survivorId, loserId } = await insertOrganizationPair(h);
    const preview = await participant.preview({ hostType: 'organization', survivorId, loserId, hostContext: {} });
    expect(preview).toEqual({ counts: { 'ExampleErpOrganizationKey.organizationId': 0 }, conflicts: [], warnings: [], refusals: [] });
  });
});
