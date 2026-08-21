import { describe, expect, it } from 'vitest';
import { resolvePaymentReturnNotice } from '../../lib/orders/payment-return-notice';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #274 — the order page is now where every gateway returns the buyer, so
 * it has to say why they are back. The gateway's `?payment=` marker is a hint
 * for the copy only: it travels in a URL the buyer can replay, so the order's
 * own `paymentStatus` stays the authority.
 */
describe('resolvePaymentReturnNotice', () => {
  it('says nothing when the buyer did not come back from a gateway', () => {
    expect(resolvePaymentReturnNotice(undefined, 'awaiting_payment')).toBeNull();
    expect(resolvePaymentReturnNotice('', 'awaiting_payment')).toBeNull();
  });

  it('tells a buyer who backed out of Stripe that they have not paid yet', () => {
    // `cancel_url` fires on *back*, not on a decline — the copy may not say
    // the payment failed, because nothing failed.
    const key = resolvePaymentReturnNotice('cancelled', 'awaiting_payment');
    expect(key).toBe('orders.paymentReturn.cancelled');
    expect(tForLocale('en-US')(key!)).toContain('have not paid');
    expect(tForLocale('en-US')(key!)).not.toContain('failed');
  });

  it('tells a buyer whose attempt was declined that it did not go through', () => {
    expect(resolvePaymentReturnNotice('failed', 'awaiting_payment')).toBe(
      'orders.paymentReturn.failed',
    );
  });

  /**
   * The case the notice was written for, and the one the original guard could
   * not reach. TPay redirects a declined buyer to `?payment=failed`, and from
   * feature 085 the settlement ingress has already written
   * `paymentStatus = 'failed'` on the order by the time that page renders. A
   * guard reading `!== 'awaiting_payment'` as *settled* suppresses the message
   * for exactly that buyer.
   */
  it('still speaks when the decline has already landed on the order', () => {
    expect(resolvePaymentReturnNotice('failed', 'failed')).toBe('orders.paymentReturn.failed');
    expect(resolvePaymentReturnNotice('returned', 'failed')).toBe('orders.paymentReturn.returned');
    expect(resolvePaymentReturnNotice('cancelled', 'failed')).toBe(
      'orders.paymentReturn.cancelled',
    );
  });

  it('tells a buyer returned with no outcome that the result is still coming', () => {
    // PayU and Autopay redirect here whatever happened; the notification decides.
    expect(resolvePaymentReturnNotice('returned', 'awaiting_payment')).toBe(
      'orders.paymentReturn.returned',
    );
  });

  it('says nothing once the payment is settled either way', () => {
    // A replayed return URL, or a notification that beat the browser back.
    expect(resolvePaymentReturnNotice('failed', 'paid')).toBeNull();
    expect(resolvePaymentReturnNotice('returned', 'paid')).toBeNull();
    expect(resolvePaymentReturnNotice('cancelled', 'deferred')).toBeNull();
    expect(resolvePaymentReturnNotice('failed', 'refunded')).toBeNull();
  });

  it('ignores a marker it does not recognise', () => {
    expect(resolvePaymentReturnNotice('whatever', 'awaiting_payment')).toBeNull();
  });

  it('ships every notice in both shipped languages', () => {
    const en = tForLocale('en-US');
    const pl = tForLocale('pl-PL');
    for (const marker of ['returned', 'cancelled', 'failed'] as const) {
      const key = resolvePaymentReturnNotice(marker, 'awaiting_payment');
      expect(key).not.toBeNull();
      expect(en(key!)).not.toBe(key);
      expect(pl(key!)).not.toBe(key);
      expect(pl(key!)).not.toBe(en(key!));
    }
  });
});
