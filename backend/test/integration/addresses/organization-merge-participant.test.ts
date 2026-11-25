import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectComposedOrganizationParticipant, mergeSql, seedRows } from '../../helpers/organization-merge-conformance.js';

/**
 * `specs/192-organization-merge/` T042 — the `addresses` participant: the
 * loser's addresses are re-pointed to the survivor in the `addresses` phase,
 * and the survivor's defaults are kept (`participant-dispositions.md` §A).
 */
describe('addresses — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const address = (organizationId: string, kind: 'delivery' | 'billing', isDefault: boolean, id = randomUUID()) =>
    [
      `insert into "addresses" ("id","organization_id","kind","recipient_name","street","city","postal_code","country","is_default","created_at","updated_at")
       values (?, ?, ?, 'Merge Recipient', 'ul. Długa 1', 'Kraków', '30-001', 'PL', ?, now(), now())`,
      [id, organizationId, kind, isDefault],
    ] as const;

  it('re-points every address of the loser and keeps the survivor’s defaults (T042)', async () => {
    const ids = { loserDeliveryDefault: randomUUID(), loserBillingDefault: randomUUID(), survivorDeliveryDefault: randomUUID() };
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'addresses',
      key: 'addresses',
      action: 'address.merge_reassign',
      seed: ({ survivorId, loserId }) =>
        seedRows(h, [
          address(survivorId, 'delivery', true, ids.survivorDeliveryDefault),
          address(loserId, 'delivery', true, ids.loserDeliveryDefault),
          address(loserId, 'billing', true, ids.loserBillingDefault),
          address(loserId, 'delivery', false),
          address(loserId, 'billing', false),
        ]),
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select "id", "organization_id", "is_default" from "addresses" where "organization_id" in (?, ?) order by "id"`,
          [survivorId, loserId],
        ),
      failOn: { table: 'addresses', on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
      sentinels: ['Merge Recipient', 'ul. Długa 1'],
    });
    expect(outcome.moved).toBe(4);

    const rows = await mergeSql<Array<{ id: string; organization_id: string; is_default: boolean }>>(
      h,
      `select "id", "organization_id", "is_default" from "addresses" where "organization_id" in (?, ?)`,
      [outcome.survivorId, outcome.loserId],
    );
    expect(rows.every((row) => row.organization_id === outcome.survivorId)).toBe(true);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.survivorDeliveryDefault)?.is_default).toBe(true);
    expect(byId.get(ids.loserDeliveryDefault)?.is_default).toBe(false);
    expect(byId.get(ids.loserBillingDefault)?.is_default).toBe(true);
  });
});
