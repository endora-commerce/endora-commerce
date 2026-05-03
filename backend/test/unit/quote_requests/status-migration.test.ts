import { describe, expect, it } from 'vitest';
import {
  mapLegacyStatus,
  type LegacyStatus,
  type NewStatus,
} from '../../../src/modules/quote_requests/migrations/status-mapping.js';

describe('mapLegacyStatus (feature 008 / T005)', () => {
  it('drops legacy `draft` rows (returns null status)', () => {
    expect(mapLegacyStatus('draft').status).toBeNull();
  });

  it.each([
    ['new', 'Pending', false],
    ['under_review', 'Pending', false],
    ['quoted', 'Pending', true],
    ['accepted', 'Approved', false],
    ['rejected', 'Canceled', false],
    ['expired', 'Expired', false],
  ] as Array<[LegacyStatus, NewStatus, boolean]>)(
    'maps legacy %s → %s with awaitingCustomerRevisionAcceptance=%s',
    (legacy, expectedStatus, expectedAwaiting) => {
      const result = mapLegacyStatus(legacy);
      expect(result.status).toBe(expectedStatus);
      expect(result.awaitingCustomerRevisionAcceptance).toBe(expectedAwaiting);
    },
  );

  it('only `quoted` triggers awaitingCustomerRevisionAcceptance', () => {
    const all: LegacyStatus[] = [
      'draft',
      'new',
      'under_review',
      'quoted',
      'accepted',
      'rejected',
      'expired',
    ];
    for (const s of all) {
      const expected = s === 'quoted';
      expect(mapLegacyStatus(s).awaitingCustomerRevisionAcceptance).toBe(expected);
    }
  });
});
