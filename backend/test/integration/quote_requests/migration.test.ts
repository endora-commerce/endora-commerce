import { describe, expect, it } from 'vitest';
import { mapLegacyStatus } from '../../../src/modules/quote_requests/migrations/status-mapping.js';

/**
 * T025 — Legacy → new status migration roundtrip.
 *
 * The migration's data step is driven by `mapLegacyStatus`, which is
 * unit-tested in test/unit/quote_requests/status-migration.test.ts.
 * This integration test re-asserts the mapping table against the
 * acceptance scenarios in research §R1 from the integration-test
 * harness, so a regression in the mapping is caught from both
 * angles (unit + integration).
 *
 * The migration's SQL side is exercised on every test boot —
 * the foundation `setupTestDb` runs migrations 001..029 against
 * a real Postgres before any test starts, so a broken migration
 * fails the whole suite, not just this file.
 */
describe('Quote Requests legacy → new status migration (T025)', () => {
  it('maps every legacy status to the documented target', () => {
    expect(mapLegacyStatus('draft').status).toBeNull();
    expect(mapLegacyStatus('new').status).toBe('Pending');
    expect(mapLegacyStatus('under_review').status).toBe('Pending');

    const quoted = mapLegacyStatus('quoted');
    expect(quoted.status).toBe('Pending');
    expect(quoted.awaitingCustomerRevisionAcceptance).toBe(true);

    expect(mapLegacyStatus('accepted').status).toBe('Approved');
    expect(mapLegacyStatus('rejected').status).toBe('Canceled');
    expect(mapLegacyStatus('expired').status).toBe('Expired');
  });

  it('preserves the awaiting flag only on `quoted`', () => {
    const all = ['draft', 'new', 'under_review', 'quoted', 'accepted', 'rejected', 'expired'] as const;
    for (const s of all) {
      const expected = s === 'quoted';
      expect(mapLegacyStatus(s).awaitingCustomerRevisionAcceptance).toBe(expected);
    }
  });
});
