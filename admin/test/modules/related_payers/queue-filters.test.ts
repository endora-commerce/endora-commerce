import { describe, expect, it } from 'vitest';
import { DEFAULT_QUEUE_FILTERS, queueFiltersActive } from '../../../../packages/modules/related_payers/src/admin/lib/queue-filters';

describe('queueFiltersActive (UX audit DS-06 #1440, DS-15 #1448)', () => {
  it('is off on what the queue opens on, and on for a reason or another state', () => {
    expect(queueFiltersActive(DEFAULT_QUEUE_FILTERS)).toBe(false);
    expect(queueFiltersActive({ state: 'pending', reason: 'no_account' })).toBe(true);
    expect(queueFiltersActive({ state: 'rejected', reason: '' })).toBe(true);
  });
});
