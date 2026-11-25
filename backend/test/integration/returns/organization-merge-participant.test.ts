import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectComposedOrganizationParticipant, mergeSql, seedRows } from '../../helpers/organization-merge-conformance.js';

/**
 * `specs/192-organization-merge/` T050 — the `returns` participant: the
 * loser's return cases, their attachments and its withdrawal statements are
 * re-pointed to the survivor.
 */
describe('returns — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('re-points cases, attachments and withdrawal statements (T050)', async () => {
    const caseIds = [randomUUID(), randomUUID()];
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'returns',
      key: 'returns',
      action: 'return_case.merge_reassign',
      seed: ({ loserId }) =>
        seedRows(h, [
          ...caseIds.map(
            (id) =>
              [
                `insert into "return_cases" ("id","kind","sales_channel_id","status_code","currency","submitted_at","order_id","customer_account_id","organization_id","rma_number","created_at","updated_at")
                 values (?, 'return', ?, 'submitted', 'PLN', now(), ?, ?, ?, ?, now(), now())`,
                [id, randomUUID(), randomUUID(), randomUUID(), loserId, `RMA-MRG-${id.slice(0, 8)}`],
              ] as const,
          ),
          [
            `insert into "return_case_attachments" ("id","return_case_id","organization_id","storage_locator","created_at") values (?, ?, ?, ?, now())`,
            [randomUUID(), caseIds[0], loserId, `returns/${loserId}/merge-proof.pdf`],
          ],
          [
            `insert into "return_withdrawal_statements"
               ("id","return_case_id","order_id","organization_id","channel","submission_id","submitted_at","order_number","scope","lines","within_statutory_period","created_at")
             values (?, ?, ?, ?, 'storefront', ?, now(), 'ORD-MRG-1', 'whole_order', '[]'::jsonb, true, now())`,
            [randomUUID(), caseIds[1], randomUUID(), loserId, randomUUID()],
          ],
        ]),
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select 'case' as "t", "id", "organization_id" from "return_cases" where "organization_id" in (?, ?)
           union all select 'attachment', "id", "organization_id" from "return_case_attachments" where "organization_id" in (?, ?)
           union all select 'statement', "id", "organization_id" from "return_withdrawal_statements" where "organization_id" in (?, ?)
           order by 1, 2`,
          [survivorId, loserId, survivorId, loserId, survivorId, loserId],
        ),
      failOn: { table: 'return_cases', on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });
    expect(outcome.moved).toBe(4);
    const left = await mergeSql<unknown[]>(
      h,
      `select 1 from "return_cases" where "organization_id" = ? union all select 1 from "return_case_attachments" where "organization_id" = ?
       union all select 1 from "return_withdrawal_statements" where "organization_id" = ?`,
      [outcome.loserId, outcome.loserId, outcome.loserId],
    );
    expect(left).toEqual([]);
  });
});
