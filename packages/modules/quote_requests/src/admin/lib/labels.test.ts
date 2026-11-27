import { describe, expect, it } from 'vitest';
import { adminQuoteRequestListQuerySchema, rfqStatusSchema } from '@endora-commerce/contracts';
import { rfqSharingLabels, rfqStatusLabels } from './labels.js';
import en from '../../../i18n/en.json' with { type: 'json' };
import pl from '../../../i18n/pl.json' with { type: 'json' };

/**
 * Issues #1434, #1476 — the quote request status map. That every key is in
 * both shipped `core` bundles is held by
 * `admin/test/modules/quote_requests/rfq-status-labels.test.tsx`.
 */
const echo = (key: string): string => key;

describe('quote request status labels', () => {
  it('declares every published status, in the order of the schema', () => {
    expect(rfqStatusLabels.values).toEqual(rfqStatusSchema.options);
  });

  it('maps each status to its rfq.status key', () => {
    expect(rfqStatusLabels.label(echo, 'Created from admin')).toBe('rfq.status.createdFromAdmin');
    expect(rfqStatusLabels.label(echo, 'Pending')).toBe('rfq.status.pending');
  });
});

describe('quote request sharing labels (specs/192-quote-request-draft-share/, FR-009)', () => {
  it('declares every value the list query accepts', () => {
    expect(rfqSharingLabels.values).toEqual(adminQuoteRequestListQuerySchema.shape.sharing.unwrap().options);
  });

  it('names each value in both shipped bundles of the module', () => {
    for (const value of rfqSharingLabels.values) {
      const key = rfqSharingLabels.label(echo, value);
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((pl as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
