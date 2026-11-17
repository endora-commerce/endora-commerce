import { describe, expect, it } from 'vitest';
import { rfqStatusSchema } from '@endora-commerce/contracts';
import { rfqStatusLabels } from './labels.js';

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
