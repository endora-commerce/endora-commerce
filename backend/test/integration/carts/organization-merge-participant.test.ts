import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectComposedOrganizationParticipant, mergeSql, seedRows } from '../../helpers/organization-merge-participants.js';

/**
 * `specs/192-organization-merge/` T043 — the `carts` participant: carts of the
 * loser and carts *Buying for* the loser are re-pointed to the survivor; a
 * *Buying for* that now names the cart's own Organization is cleared; every
 * moved cart is repriced on its next read (its recompute cache is dropped).
 */
describe('carts — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const cart = (id: string, organizationId: string, buyingFor: string | null) =>
    [
      `insert into "carts" ("id","organization_id","status","approval_status","buying_for_organization_id","buying_for_terms","last_activity_at","version","created_at","updated_at")
       values (?, ?, 'active', 'not_required', ?, ?, now(), 1, now(), now())`,
      [id, organizationId, buyingFor, buyingFor === null ? null : 'payer'],
    ] as const;

  it('re-points the loser’s carts and its Buying-for, clears a Buying-for of self, and drops the repricing cache (T043)', async () => {
    const third = randomUUID();
    const ids = { own: randomUUID(), forSurvivor: randomUUID(), thirdForLoser: randomUUID(), survivorForLoser: randomUUID() };
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'carts',
      key: 'carts',
      action: 'cart.merge_reassign',
      seed: async ({ survivorId, loserId }) => {
        await seedRows(h, [
          cart(ids.own, loserId, null),
          cart(ids.forSurvivor, loserId, survivorId),
          cart(ids.thirdForLoser, third, loserId),
          cart(ids.survivorForLoser, survivorId, loserId),
        ]);
        for (const id of Object.values(ids)) await h.redis.set(`b2b:cart:recompute:${id}`, '{}', 'EX', 60);
      },
      snapshot: () =>
        mergeSql(
          h,
          `select "id", "organization_id", "buying_for_organization_id", "buying_for_terms" from "carts" where "id" in (?, ?, ?, ?) order by "id"`,
          Object.values(ids),
        ),
      failOn: {
        table: 'carts',
        on: 'UPDATE',
        when: (loserId) => `OLD."organization_id" = '${loserId}' or OLD."buying_for_organization_id" = '${loserId}'`,
      },
    });
    expect(outcome.moved).toBe(4);

    const rows = new Map(
      (
        await mergeSql<Array<{ id: string; organization_id: string; buying_for_organization_id: string | null; buying_for_terms: string | null }>>(
          h,
          `select "id", "organization_id", "buying_for_organization_id", "buying_for_terms" from "carts" where "id" in (?, ?, ?, ?)`,
          Object.values(ids),
        )
      ).map((row) => [row.id, row]),
    );
    const { survivorId } = outcome;
    expect(rows.get(ids.own)).toMatchObject({ organization_id: survivorId, buying_for_organization_id: null });
    expect(rows.get(ids.forSurvivor)).toMatchObject({ organization_id: survivorId, buying_for_organization_id: null, buying_for_terms: null });
    expect(rows.get(ids.thirdForLoser)).toMatchObject({ organization_id: third, buying_for_organization_id: survivorId, buying_for_terms: 'payer' });
    expect(rows.get(ids.survivorForLoser)).toMatchObject({ organization_id: survivorId, buying_for_organization_id: null, buying_for_terms: null });
    for (const id of Object.values(ids)) expect(await h.redis.exists(`b2b:cart:recompute:${id}`)).toBe(0);
  });
});
