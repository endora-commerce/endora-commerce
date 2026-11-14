import { describe, expect, it } from 'vitest';
import { rfqConversionRedirect } from '../../lib/account/shopping-list-conversion';

/**
 * Issue #1159 (architect ruling A) — a list → quote-request conversion that
 * converted nothing answers `rfqId: null`. The redirect carries the counts
 * always and the quote request's id only when there is one: the string `null`
 * never reaches the URL.
 */
describe('rfqConversionRedirect', () => {
  const listId = '00000000-0000-4000-8000-0000000000f1';
  const skip = { itemId: 'i1', productId: 'p1', reason: 'product_archived' as const };

  it('omits rfqId when no quote request was created', () => {
    const url = rfqConversionRedirect(listId, { rfqId: null, added: 0, skipped: [skip, skip] });
    const [path, query] = url.split('?');
    expect(path).toBe(`/shopping-lists/${listId}`);
    const params = new URLSearchParams(query);
    expect(params.has('rfqId')).toBe(false);
    expect(params.get('rfqAdded')).toBe('0');
    expect(params.get('rfqSkipped')).toBe('2');
    expect(url).not.toContain('null');
  });

  it('keeps rfqId when the conversion created or extended a quote request', () => {
    const rfqId = '00000000-0000-4000-8000-0000000000a1';
    const url = rfqConversionRedirect(listId, { rfqId, added: 2, skipped: [skip] });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('rfqId')).toBe(rfqId);
    expect(params.get('rfqAdded')).toBe('2');
    expect(params.get('rfqSkipped')).toBe('1');
  });
});
