import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Issue #284 — `findByObjectIds`, the audit read a page makes instead of a
 * read per row.
 *
 * The two properties that matter to its caller are both about the *statement*:
 * there is exactly one of it for the whole set, and there is none at all for an
 * empty set. Its caller counts them in
 * `test/integration/orders/cancellability-batching.test.ts`; this file pins the
 * shape of the query itself, which that count cannot see.
 */

function serviceWithFind(): { service: AuditLogService; find: ReturnType<typeof vi.fn> } {
  const find = vi.fn().mockResolvedValue([]);
  const em = { find } as unknown as EntityManager;
  return { service: new AuditLogService(() => em), find };
}

describe('AuditLogService.findByObjectIds', () => {
  it('asks for the whole set in one query, filtered by action and object type', async () => {
    const { service, find } = serviceWithFind();

    await service.findByObjectIds({
      action: 'order.status_transition',
      objectType: 'order',
      objectIds: ['a', 'b', 'c'],
    });

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      AuditLogEntry,
      {
        action: 'order.status_transition',
        objectType: 'order',
        objectId: { $in: ['a', 'b', 'c'] },
      },
      { orderBy: { actedAt: 'asc' } },
    );
  });

  it('does not go to the database for an empty set', async () => {
    // An `$in: []` is still a round trip, and the caller reaching this with no
    // ids is the ordinary page — every order freshly placed, nothing whose
    // authorship changes the answer.
    const { service, find } = serviceWithFind();

    await expect(
      service.findByObjectIds({ action: 'order.status_transition', objectType: 'order', objectIds: [] }),
    ).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('collapses a repeated id rather than asking for it twice', async () => {
    const { service, find } = serviceWithFind();

    await service.findByObjectIds({
      action: 'order.status_transition',
      objectType: 'order',
      objectIds: ['a', 'a', 'b'],
    });

    expect(find.mock.calls[0]?.[1]).toMatchObject({ objectId: { $in: ['a', 'b'] } });
  });

  /**
   * Deliberately uncapped, unlike `query()`. A `limit` over a set does not
   * bound the work evenly — it drops whichever objects sort last, and an object
   * whose history was truncated reads as an object with no history, which the
   * caller answers by refusing a buyer their cancellation.
   */
  it('applies no limit, so no object in the set can be silently truncated away', async () => {
    const { service, find } = serviceWithFind();

    await service.findByObjectIds({
      action: 'order.status_transition',
      objectType: 'order',
      objectIds: ['a'],
    });

    expect(find.mock.calls[0]?.[2]).not.toHaveProperty('limit');
  });
});
