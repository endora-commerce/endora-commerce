import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectComposedOrganizationParticipant, mergeSql, seedRows } from '../../helpers/organization-merge-conformance.js';

/**
 * `specs/192-organization-merge/` T049 — the `promotions` participant: the
 * loser's Organization-specific promotions and its usages are re-pointed, and
 * its per-Organization usage counters are added to the survivor's, so a merge
 * cannot reset a per-Organization limit (spec § Edge cases).
 */
describe('promotions — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const counter = (key: string, count: number, scopeType = 'organization') =>
    [
      `insert into "promotion_usage_counters" ("id","scope_type","scope_key","count") values (?, ?, ?, ?)`,
      [randomUUID(), scopeType, key, count],
    ] as const;

  it('re-points promotions and usages and sums the per-Organization counters (T049)', async () => {
    const shared = randomUUID();
    const loserOnly = randomUUID();
    const customer = randomUUID();
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'promotions',
      key: 'promotions',
      action: 'promotion.merge_reassign',
      seed: ({ survivorId, loserId }) =>
        seedRows(h, [
          [
            `insert into "promotions" ("id","name","organization_id","created_at","updated_at") values (?, 'Merge promo', ?, now(), now())`,
            [randomUUID(), loserId],
          ],
          ...[shared, loserOnly].map(
            (promotionId) =>
              [
                `insert into "promotion_usages" ("id","promotion_id","order_id","organization_id","sales_channel_id","discount_amount","currency","created_at")
                 values (?, ?, ?, ?, ?, 10, 'PLN', now())`,
                [randomUUID(), promotionId, randomUUID(), loserId, randomUUID()],
              ] as const,
          ),
          counter(`${shared}:${loserId}`, 3),
          counter(`${shared}:${survivorId}`, 2),
          counter(`${loserOnly}:${loserId}`, 1),
          counter(`${shared}:${customer}`, 7, 'customer'),
        ]),
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select 'promotion' as "t", "id"::text as "k", "organization_id"::text as "v" from "promotions" where "organization_id" in (?, ?)
           union all select 'usage', "id"::text, "organization_id"::text from "promotion_usages" where "organization_id" in (?, ?)
           union all select 'counter', "scope_key", "count"::text from "promotion_usage_counters"
            where "scope_type" = 'organization' and ("scope_key" like ? or "scope_key" like ?)
           order by 1, 2`,
          [survivorId, loserId, survivorId, loserId, `%:${survivorId}`, `%:${loserId}`],
        ),
      failOn: { table: 'promotion_usage_counters', on: 'DELETE', when: (loserId) => `OLD."scope_key" like '%:${loserId}'` },
      batchSize: 5,
    });
    expect(outcome.moved).toBe(5);

    const counters = await mergeSql<Array<{ scope_key: string; count: number }>>(
      h,
      `select "scope_key", "count" from "promotion_usage_counters" where "scope_type" = 'organization' and ("scope_key" like ? or "scope_key" like ?) order by "scope_key"`,
      [`%:${outcome.survivorId}`, `%:${outcome.loserId}`],
    );
    expect([...counters].sort((a, b) => a.scope_key.localeCompare(b.scope_key))).toEqual(
      [
        { scope_key: `${shared}:${outcome.survivorId}`, count: 5 },
        { scope_key: `${loserOnly}:${outcome.survivorId}`, count: 1 },
      ].sort((a, b) => a.scope_key.localeCompare(b.scope_key)),
    );
    const [untouched] = await mergeSql<Array<{ count: number }>>(
      h,
      `select "count" from "promotion_usage_counters" where "scope_type" = 'customer' and "scope_key" = ?`,
      [`${shared}:${customer}`],
    );
    expect(untouched?.count).toBe(7);
  });
});
