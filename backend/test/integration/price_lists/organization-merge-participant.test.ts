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
 * `specs/192-organization-merge/` T048 — the `price_lists` participant, in the
 * `configuration` phase: the loser's price-book audience memberships are
 * unioned into the survivor's, and its display-mode override fills the
 * survivor's gap (the survivor's own wins). Organization-specific matrix prices
 * no longer exist on `master` (the 2026-11 price-book model): a matrix entry
 * names no Organization, so there is nothing to merge there.
 */
describe('price_lists — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const book = (id: string) =>
    [
      `insert into "price_lists" ("id","name","currency_code","audience_kind","status","created_at","updated_at")
       values (?, 'Merge book', 'PLN', 'organizations', 'active', now(), now())`,
      [id],
    ] as const;
  const member = (priceListId: string, organizationId: string) =>
    [
      `insert into "price_list_audience_members" ("id","price_list_id","organization_id") values (?, ?, ?)`,
      [randomUUID(), priceListId, organizationId],
    ] as const;
  const override = (organizationId: string, mode: string) =>
    [
      `insert into "price_display_mode_overrides" ("scope","target_id","mode","created_at","updated_at") values ('organization', ?, ?, now(), now())`,
      [organizationId, mode],
    ] as const;

  it('unions the audiences and fills the survivor’s display-mode gap (T048)', async () => {
    const both = randomUUID();
    const loserOnly = randomUUID();
    // R-17: every committed batch bumps the pricing generation with what it changed.
    const generation = (
      h as unknown as { container: { cradle: { priceLists: { handle: { pricingGeneration: { bump(change?: unknown): Promise<void> } } } } } }
    ).container.cradle.priceLists.handle.pricingGeneration;
    const bump = generation.bump;
    const changes: Array<{ kind: string; books?: Array<{ facts: Array<{ bookId: string }> }> }> = [];
    generation.bump = (change?: unknown) => {
      changes.push(change as (typeof changes)[number]);
      return bump.call(generation, change);
    };
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'price_lists',
      key: 'price-audiences',
      action: 'price_list.merge_reassign',
      seed: async ({ survivorId, loserId }) => {
        await seedRows(h, [
          book(both),
          book(loserOnly),
          member(both, survivorId),
          member(both, loserId),
          member(loserOnly, loserId),
          override(loserId, 'net_only'),
        ]);
      },
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select 'member' as "t", "price_list_id"::text || ':' || "organization_id"::text as "k" from "price_list_audience_members"
            where "organization_id" in (?, ?)
           union all select 'override', "target_id"::text || ':' || "mode" from "price_display_mode_overrides"
            where "scope" = 'organization' and "target_id" in (?, ?)
           order by 1, 2`,
          [survivorId, loserId, survivorId, loserId],
        ),
      failOn: { table: 'price_list_audience_members', on: 'DELETE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });
    generation.bump = bump;
    expect(outcome.moved).toBe(3);
    const bumpedBooks = new Set(changes.flatMap((change) => (change.books ?? []).flatMap((entry) => entry.facts.map((f) => f.bookId))));
    expect([...bumpedBooks].sort()).toEqual([both, loserOnly].sort());

    const members = await mergeSql<Array<{ price_list_id: string; organization_id: string }>>(
      h,
      `select "price_list_id", "organization_id" from "price_list_audience_members" where "organization_id" in (?, ?)`,
      [outcome.survivorId, outcome.loserId],
    );
    expect(members.filter((row) => row.organization_id === outcome.loserId)).toEqual([]);
    expect(members.map((row) => row.price_list_id).sort()).toEqual([both, loserOnly].sort());
    const overrides = await mergeSql<Array<{ target_id: string; mode: string }>>(
      h,
      `select "target_id", "mode" from "price_display_mode_overrides" where "scope" = 'organization' and "target_id" in (?, ?)`,
      [outcome.survivorId, outcome.loserId],
    );
    expect(overrides).toEqual([{ target_id: outcome.survivorId, mode: 'net_only' }]);
  });

  it('keeps the survivor’s display mode and leaves the loser’s on the archived loser (S+f)', async () => {
    const survivorId = await insertCompanyOrganization(h, 'Survivor');
    const loserId = await insertCompanyOrganization(h, 'Loser');
    await seedRows(h, [override(survivorId, 'gross_only'), override(loserId, 'net_only')]);
    const participant = composedOrganizationParticipant(h, 'price_lists', 'price-audiences');
    const preview = await participant.preview({ hostType: 'organization', survivorId, loserId, hostContext: {} });
    expect(preview.counts['PriceDisplayModeOverride.targetId']).toBe(0);
    expect(preview.conflicts.map((conflict) => conflict.code)).toContain('PRICE_DISPLAY_MODE_MERGE_SURVIVOR_KEPT');
    const moved = await participant.applyBatch({
      mergeId: randomUUID(),
      hostType: 'organization',
      survivorId,
      loserId,
      hostContext: {},
      batchSize: 10,
    });
    expect(moved.moved).toBe(0);
    const rows = await mergeSql<Array<{ target_id: string; mode: string }>>(
      h,
      `select "target_id", "mode" from "price_display_mode_overrides" where "scope" = 'organization' and "target_id" in (?, ?) order by "mode"`,
      [survivorId, loserId],
    );
    expect(rows).toEqual([
      { target_id: survivorId, mode: 'gross_only' },
      { target_id: loserId, mode: 'net_only' },
    ]);
  });
});
