import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { applyUndo, type RevertHandlers, type RevertRecord } from '@endora-commerce/platform/commands';

/**
 * Pure unit tests for the undo engine (feature 054, US2 / FR-006/FR-013/FR-014).
 * A fake EM is unused by these handlers — the current-state map stands in for the DB.
 */
const em = {} as EntityManager;

function handlers(current: Map<string, Record<string, unknown> | null>): RevertHandlers {
  return {
    async readCurrent(_em, rec) {
      return current.has(rec.recordId) ? current.get(rec.recordId)! : null;
    },
    async restore(_em, rec) {
      current.set(rec.recordId, { ...rec.before });
    },
  };
}

const rec = (id: string, before: unknown, after: unknown): RevertRecord => ({
  recordId: id,
  before: { price: before },
  after: { price: after },
});

describe('applyUndo (feature 054)', () => {
  it('restores every record whose current state still matches the operation after-state', async () => {
    const current = new Map<string, Record<string, unknown> | null>([
      ['p1', { price: 20 }],
      ['p2', { price: 20 }],
    ]);
    const records = [rec('p1', 10, 20), rec('p2', 10, 20)];
    const res = await applyUndo(em, records, handlers(current));
    expect(res.reverted.sort()).toEqual(['p1', 'p2']);
    expect(res.conflicts).toEqual([]);
    expect(res.undoStatus).toBe('reverted');
    expect(current.get('p1')).toEqual({ price: 10 });
  });

  it('refuses records changed since the operation (no silent clobber) and reports them', async () => {
    const current = new Map<string, Record<string, unknown> | null>([
      ['p1', { price: 20 }], // unchanged → restore
      ['p2', { price: 99 }], // changed since → conflict
    ]);
    const res = await applyUndo(em, [rec('p1', 10, 20), rec('p2', 10, 20)], handlers(current));
    expect(res.reverted).toEqual(['p1']);
    expect(res.conflicts).toEqual([{ recordId: 'p2', reason: 'changed_since_operation' }]);
    expect(res.undoStatus).toBe('partially_reverted');
    expect(current.get('p2')).toEqual({ price: 99 }); // untouched
  });

  it('reports a missing record as a conflict', async () => {
    const current = new Map<string, Record<string, unknown> | null>();
    const res = await applyUndo(em, [rec('gone', 10, 20)], handlers(current));
    expect(res.conflicts).toEqual([{ recordId: 'gone', reason: 'missing' }]);
    expect(res.undoStatus).toBe('none');
  });

  it('is idempotent-safe: a record already at its before-state counts as reverted, no rewrite', async () => {
    const current = new Map<string, Record<string, unknown> | null>([['p1', { price: 10 }]]);
    const res = await applyUndo(em, [rec('p1', 10, 20)], handlers(current));
    expect(res.reverted).toEqual(['p1']);
    expect(res.conflicts).toEqual([]);
    expect(res.undoStatus).toBe('reverted');
  });
});
