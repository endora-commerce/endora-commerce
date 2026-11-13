import { describe, expect, it, vi } from 'vitest';
import type { CustomerAccountRecord } from '@endora-commerce/contracts';
import {
  CustomerNotificationRetentionSweeper,
  RETENTION_DAYS_BOUNDS,
  clampRetentionDays,
  type RetentionStore,
} from './retention-sweeper.js';

/**
 * The two passes of the retention sweep (research R-16, data-model §2, T062),
 * over a fake store: entries older than the retention period go in batches,
 * and so do the entries of accounts the account owner reports deleted or
 * anonymised — or no longer reports at all.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-13T03:00:00.000Z');

function account(id: string, overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return { id, deletedAt: null, anonymizedAt: null, ...overrides } as CustomerAccountRecord;
}

function store(overrides: Partial<RetentionStore> = {}): RetentionStore & {
  deleteCreatedBefore: ReturnType<typeof vi.fn>;
  accountIdsAfter: ReturnType<typeof vi.fn>;
  deleteForAccounts: ReturnType<typeof vi.fn>;
} {
  return {
    hasWork: vi.fn(async () => true),
    deleteCreatedBefore: vi.fn(async () => 0),
    accountIdsAfter: vi.fn(async () => []),
    deleteForAccounts: vi.fn(async (ids: readonly string[]) => ids.length),
    ...overrides,
  } as never;
}

describe('the retention pass', () => {
  it('deletes entries older than the period, batch after batch, until a short batch', async () => {
    const batches = [1000, 1000, 17];
    const s = store({ deleteCreatedBefore: vi.fn(async () => batches.shift() ?? 0) });
    const sweeper = new CustomerNotificationRetentionSweeper({
      store: s,
      retentionDays: async () => 90,
      customerAccounts: { findByIds: async () => [] },
      batchSize: 1000,
    });

    const result = await sweeper.sweep(NOW);

    expect(s.deleteCreatedBefore).toHaveBeenCalledTimes(3);
    for (const call of s.deleteCreatedBefore.mock.calls) {
      expect(call).toEqual([new Date(NOW.getTime() - 90 * DAY), 1000]);
    }
    expect(result).toMatchObject({ retentionDays: 90, expired: 2017 });
  });

  it('holds a stored period outside 7–730 days to the range', async () => {
    expect(RETENTION_DAYS_BOUNDS).toEqual({ min: 7, max: 730 });
    expect(clampRetentionDays(1)).toBe(7);
    expect(clampRetentionDays(5000)).toBe(730);
    expect(clampRetentionDays(30.7)).toBe(30);
    expect(clampRetentionDays(Number.NaN)).toBe(90);

    const s = store();
    const sweeper = new CustomerNotificationRetentionSweeper({
      store: s,
      retentionDays: async () => 1,
      customerAccounts: { findByIds: async () => [] },
    });
    const result = await sweeper.sweep(NOW);
    expect(s.deleteCreatedBefore.mock.calls[0]![0]).toEqual(new Date(NOW.getTime() - 7 * DAY));
    expect(result.retentionDays).toBe(7);
  });
});

describe('the erasure pass', () => {
  it('deletes the entries of deleted, anonymised and vanished accounts, and keeps the live ones', async () => {
    const pages = [['a1', 'a2', 'a3', 'a4']];
    const s = store({
      accountIdsAfter: vi.fn(async () => pages.shift() ?? []),
    });
    const findByIds = vi.fn(async (ids: readonly string[]) => {
      expect(ids).toEqual(['a1', 'a2', 'a3', 'a4']);
      return [
        account('a1'),
        account('a2', { deletedAt: new Date() }),
        account('a3', { anonymizedAt: new Date() }),
        // a4 is not answered at all: the account is gone.
      ];
    });
    const sweeper = new CustomerNotificationRetentionSweeper({
      store: s,
      retentionDays: async () => 90,
      customerAccounts: { findByIds },
      accountPageSize: 500,
    });

    const result = await sweeper.sweep(NOW);

    expect(s.deleteForAccounts).toHaveBeenCalledTimes(1);
    expect(s.deleteForAccounts).toHaveBeenCalledWith(['a2', 'a3', 'a4']);
    expect(result.erased).toBe(3);
  });

  it('pages through the attributed accounts by keyset until a short page', async () => {
    const full = Array.from({ length: 3 }, (_, i) => `p1-${i}`);
    const pages = [full, ['p2-0']];
    const s = store({ accountIdsAfter: vi.fn(async () => pages.shift() ?? []) });
    const sweeper = new CustomerNotificationRetentionSweeper({
      store: s,
      retentionDays: async () => 90,
      customerAccounts: { findByIds: async (ids) => ids.map((id) => account(id)) },
      accountPageSize: 3,
    });

    await sweeper.sweep(NOW);

    expect(s.accountIdsAfter.mock.calls).toEqual([
      [null, 3],
      ['p1-2', 3],
    ]);
    expect(s.deleteForAccounts).not.toHaveBeenCalled();
  });

  it('asks the store whether there is any work, and nothing else', async () => {
    const hasWork = vi.fn(async () => false);
    const sweeper = new CustomerNotificationRetentionSweeper({
      store: store({ hasWork }),
      retentionDays: async () => 90,
      customerAccounts: { findByIds: async () => [] },
    });

    expect(await sweeper.hasWork()).toBe(false);
    expect(hasWork).toHaveBeenCalledTimes(1);
  });
});
