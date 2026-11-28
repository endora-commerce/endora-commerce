import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { ShoppingList } from '../entities/shopping-list.entity.js';
import { ShoppingListOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T051 — `shopping_lists` in an Organization
 * merge: every list of the loser is re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `shopping_list.merge_reassign`. A
 * moved list stays its customer's default only when the customer has no
 * default list on the survivor, so "one default per (organization, customer)"
 * still holds.
 */
const SENTINEL = 'SENTINEL-list-name-4711';

function world() {
  const w = createMemoryMergeWorld();
  const participant = new ShoppingListOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
  return { w, participant };
}

describe('shopping_lists — Organization merge participant', () => {
  it('declares its re-point in the records phase', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'shopping-lists',
        phase: 'records',
        references: [{ entity: 'ShoppingList', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const { w, participant } = world();
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(ShoppingList, { id: `l-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, name: SENTINEL });
        }
        w.insert(ShoppingList, { id: 's-0', organizationId: survivorId, customerAccountId: 'c-s', name: SENTINEL });
      },
      snapshot: async () => w.rows(ShoppingList).map((list) => `${list.id}:${list.organizationId}:${list.isDefault}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    expect(w.audit.entries().every((entry) => entry.action === 'shopping_list.merge_reassign' && entry.objectType === 'organization')).toBe(true);
  });

  it('keeps the survivor-side default of a customer and demotes the moved one', async () => {
    const { w, participant } = world();
    w.insert(ShoppingList, { id: 'a', organizationId: 'S', customerAccountId: 'c1', name: 'Default', isDefault: true });
    w.insert(ShoppingList, { id: 'b', organizationId: 'L', customerAccountId: 'c1', name: 'Default', isDefault: true });
    w.insert(ShoppingList, { id: 'c', organizationId: 'L', customerAccountId: 'c2', name: 'Default', isDefault: true });
    const result = await participant.applyBatch({ mergeId: 'm', hostType: 'organization', survivorId: 'S', loserId: 'L', hostContext: {}, batchSize: 10 });
    expect(result).toEqual({ moved: 2 });
    const byId = Object.fromEntries(w.rows(ShoppingList).map((list) => [list.id, list]));
    expect(byId['a']).toMatchObject({ organizationId: 'S', isDefault: true });
    expect(byId['b']).toMatchObject({ organizationId: 'S', isDefault: false });
    expect(byId['c']).toMatchObject({ organizationId: 'S', isDefault: true });
    expect(w.audit.entries()[0]?.stateAfter).toEqual({ mergeId: 'm', loserId: 'L', moved: 2, ids: ['b', 'c'] });
  });
});
