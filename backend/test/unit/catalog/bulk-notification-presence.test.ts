import { afterEach, describe, expect, it } from 'vitest';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  presenceAwareBulkRecorder,
  type BulkNotificationInput,
} from '../../../../packages/modules/catalog/src/backend/services/bulk-operation.service.js';

/**
 * D-60 — the third of the three sites, and the one with the sharpest cost.
 *
 * The bulk-operation bell is written when the operation has already finished
 * and its row carries the outcome, so re-throwing there would fail a job whose
 * work is done and, on retry, redo the products. That is why the answer had to
 * move in front of the gate rather than the `catch` being narrowed to a
 * re-throw: the operator switching notifications off is now `not-present` in
 * the return type, and the `catch` that remains covers a failed write.
 */

const INPUT: BulkNotificationInput = {
  audience: 'admin_user',
  targetAdminUserId: '00000000-0000-0000-0000-000000000001',
  kind: 'catalog.bulk_operation.completed',
  title: 'Bulk edit finished — 10/10 updated',
};

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('catalog — the bulk-operation notification recorder decides presence (D-60)', () => {
  it('answers `not-present` without touching the port while the bell is off', async () => {
    let calls = 0;
    const recorder = presenceAwareBulkRecorder({
      record: async () => {
        calls += 1;
      },
    });
    registryCache.__setEnabledForTesting(['catalog']);

    await expect(recorder.record(INPUT)).resolves.toBe('not-present');
    expect(calls).toBe(0);
  });

  it('records and says so once the module is present', async () => {
    const seen: BulkNotificationInput[] = [];
    const recorder = presenceAwareBulkRecorder({
      record: async (input) => {
        seen.push(input);
      },
    });
    registryCache.__setEnabledForTesting(['catalog', 'admin_notifications']);

    await expect(recorder.record(INPUT)).resolves.toBe('recorded');
    expect(seen).toEqual([INPUT]);
  });
});
