import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectComposedOrganizationParticipant, mergeSql, seedRows } from '../../helpers/organization-merge-participants.js';

/**
 * `specs/192-organization-merge/` T044 — the `invoices` participant: the
 * loser's invoices are re-pointed to the survivor, and the issued document —
 * its number, its buyer snapshot, its amounts — is not touched (FR-043).
 */
describe('invoices — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const invoice = (organizationId: string) =>
    [
      `insert into "invoices" ("id","kind","number","issued_at","currency","total","order_id","organization_id","created_at","updated_at")
       values (?, 'invoice', ?, now(), 'PLN', 123.45, ?, ?, now() - interval '1 day', now() - interval '1 day')`,
      [randomUUID(), `MRG/${randomUUID().slice(0, 12)}`, randomUUID(), organizationId],
    ] as const;

  it('re-points the loser’s invoices and leaves the printed document as issued (T044, FR-043)', async () => {
    const picture = (survivorId: string, loserId: string) =>
      mergeSql<Array<Record<string, unknown>>>(
        h,
        `select "id", "number", "total", "issued_at", "updated_at", "organization_id" from "invoices" where "organization_id" in (?, ?) order by "id"`,
        [survivorId, loserId],
      );
    let before: Array<Record<string, unknown>> = [];
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'invoices',
      key: 'invoices',
      action: 'invoice.merge_reassign',
      seed: async ({ survivorId, loserId }) => {
        await seedRows(h, [invoice(loserId), invoice(loserId), invoice(loserId), invoice(survivorId)]);
        before = await picture(survivorId, loserId);
      },
      snapshot: ({ survivorId, loserId }) => picture(survivorId, loserId),
      failOn: { table: 'invoices', on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });
    expect(outcome.moved).toBe(3);
    const after = await picture(outcome.survivorId, outcome.loserId);
    expect(after.map(({ organization_id: _o, ...document }) => document)).toEqual(
      before.map(({ organization_id: _o, ...document }) => document),
    );
    expect(after.every((row) => row['organization_id'] === outcome.survivorId)).toBe(true);
  });
});
