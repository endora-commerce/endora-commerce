import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  composedOrganizationParticipant,
  expectComposedOrganizationParticipant,
  insertCompanyOrganization,
  mergeSql,
  seedRows,
} from '../../helpers/organization-merge-conformance.js';

/**
 * `specs/192-organization-merge/` T046 — the `credit_limits` participants
 * (OQ-8): the survivor keeps its limit, or takes the loser's when it has none
 * (`credit-limit`, configuration, S+f); the loser's reservations and return
 * top-ups become the survivor's, and reservations held on the loser's limit
 * move onto the survivor's, which may put it over its limit — the preview warns
 * and does not refuse (`credit-exposure`, records, R).
 */
describe('credit_limits — Organization merge participants', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const limit = (id: string, organizationId: string, amount: number) =>
    [
      `insert into "credit_limits" ("id","organization_id","granted_amount","currency","created_at","updated_at") values (?, ?, ?, 'PLN', now(), now())`,
      [id, organizationId, amount],
    ] as const;
  const reservation = (creditLimitId: string, reservingOrganizationId: string, amount: number, status = 'active') =>
    [
      `insert into "credit_limit_reservations" ("id","credit_limit_id","order_id","reserving_organization_id","amount","currency","status","created_at","updated_at")
       values (?, ?, ?, ?, ?, 'PLN', ?, now(), now())`,
      [randomUUID(), creditLimitId, randomUUID(), reservingOrganizationId, amount, status],
    ] as const;
  const topup = (organizationId: string) =>
    [
      `insert into "credit_limit_return_topups" ("id","return_case_id","organization_id","amount","currency","applied_at") values (?, ?, ?, 5, 'PLN', now())`,
      [randomUUID(), randomUUID(), organizationId],
    ] as const;

  it('gives the survivor the loser’s limit when it has none (credit-limit, S+f)', async () => {
    const loserLimit = randomUUID();
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'credit_limits',
      key: 'credit-limit',
      action: 'credit_limit.merge_reassign',
      seed: ({ loserId }) => seedRows(h, [limit(loserLimit, loserId, 500)]),
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(h, `select "id", "organization_id" from "credit_limits" where "organization_id" in (?, ?) order by "id"`, [survivorId, loserId]),
      failOn: { table: 'credit_limits', on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });
    expect(outcome.moved).toBe(1);
    const [row] = await mergeSql<Array<{ organization_id: string }>>(h, `select "organization_id" from "credit_limits" where "id" = ?`, [loserLimit]);
    expect(row?.organization_id).toBe(outcome.survivorId);
  });

  it('keeps the survivor’s limit and leaves the loser’s on the archived loser', async () => {
    const survivorId = await insertCompanyOrganization(h, 'Survivor');
    const loserId = await insertCompanyOrganization(h, 'Loser');
    const [survivorLimit, loserLimit] = [randomUUID(), randomUUID()];
    await seedRows(h, [limit(survivorLimit, survivorId, 100), limit(loserLimit, loserId, 500)]);
    const participant = composedOrganizationParticipant(h, 'credit_limits', 'credit-limit');
    const preview = await participant.preview({ hostType: 'organization', survivorId, loserId, hostContext: {} });
    expect(preview.counts).toEqual({ 'CreditLimit.organizationId': 0 });
    expect(preview.conflicts.map((conflict) => conflict.code)).toEqual(['CREDIT_LIMIT_MERGE_SURVIVOR_KEPT']);
    expect(
      (await participant.applyBatch({ mergeId: randomUUID(), hostType: 'organization', survivorId, loserId, hostContext: {}, batchSize: 10 })).moved,
    ).toBe(0);
  });

  it('moves the exposure onto the survivor’s limit and warns when it is exceeded (credit-exposure, OQ-8)', async () => {
    const [survivorLimit, loserLimit] = [randomUUID(), randomUUID()];
    const child = randomUUID();
    let warnings: readonly { code: string }[] = [];
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'credit_limits',
      key: 'credit-exposure',
      action: 'credit_limit.merge_reassign',
      seed: async ({ survivorId, loserId }) => {
        await seedRows(h, [
          limit(survivorLimit, survivorId, 100),
          limit(loserLimit, loserId, 500),
          reservation(survivorLimit, survivorId, 40),
          reservation(loserLimit, loserId, 80),
          reservation(loserLimit, loserId, 30, 'released'),
          // A descendant drawing on the loser's shared pool: its credit now comes from the survivor's limit.
          reservation(loserLimit, child, 10),
          topup(loserId),
        ]);
        const preview = await composedOrganizationParticipant(h, 'credit_limits', 'credit-exposure').preview({
          hostType: 'organization',
          survivorId,
          loserId,
          hostContext: {},
        });
        warnings = preview.warnings;
      },
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select 'reservation' as "t", "id", "credit_limit_id"::text || ':' || "reserving_organization_id"::text as "v"
             from "credit_limit_reservations" where "credit_limit_id" in (?, ?)
           union all select 'topup', "id", "organization_id"::text from "credit_limit_return_topups" where "organization_id" in (?, ?)
           order by 1, 2`,
          [survivorLimit, loserLimit, survivorId, loserId],
        ),
      failOn: { table: 'credit_limit_reservations', on: 'UPDATE', when: () => `OLD."credit_limit_id" = '${loserLimit}'` },
    });
    expect(warnings.map((warning) => warning.code)).toEqual(['CREDIT_LIMIT_MERGE_OVER_LIMIT']);
    expect(outcome.moved).toBe(4);
    const reservations = await mergeSql<Array<{ credit_limit_id: string; reserving_organization_id: string }>>(
      h,
      `select "credit_limit_id", "reserving_organization_id" from "credit_limit_reservations" where "credit_limit_id" in (?, ?)`,
      [survivorLimit, loserLimit],
    );
    expect(reservations.every((row) => row.credit_limit_id === survivorLimit)).toBe(true);
    expect(reservations.filter((row) => row.reserving_organization_id === outcome.loserId)).toEqual([]);
    expect(reservations.filter((row) => row.reserving_organization_id === child)).toHaveLength(1);
    const topups = await mergeSql<Array<{ organization_id: string }>>(
      h,
      `select "organization_id" from "credit_limit_return_topups" where "organization_id" in (?, ?)`,
      [outcome.survivorId, outcome.loserId],
    );
    expect(topups).toEqual([{ organization_id: outcome.survivorId }]);
  });
});
