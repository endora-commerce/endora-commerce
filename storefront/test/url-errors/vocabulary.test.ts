import { describe, expect, it } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';
import { defineUrlErrors } from '../../lib/url-errors';

/**
 * Issue #745 — the one shape every page's `?error=` vocabulary is written in.
 * A code travels; the page names the codes it knows and reads anything else as
 * its generic failure.
 */
const vocabulary = defineUrlErrors({
  api: {
    CART_EMPTY: 'commerce.error.CART_EMPTY',
    ORDER_CART_APPROVAL_REQUIRED: 'commerce.error.ORDER_CART_APPROVAL_REQUIRED',
    'ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending': 'commerce.error.ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending',
  },
  own: {
    PLACE_FAILED: 'commerce.checkout.placeFailed',
    FAILED: 'checkout.failure.generic',
  },
  generic: 'FAILED',
});

describe('failureCode — what a failed action carries', () => {
  it('carries an API code the page names', () => {
    expect(vocabulary.failureCode(new StorefrontApiError(409, 'CART_EMPTY', 'Your cart is empty.'), 'PLACE_FAILED')).toBe(
      'CART_EMPTY',
    );
  });

  it('carries the refinement the backend put in details.code when the page names it', () => {
    const pending = new StorefrontApiError(409, 'ORDER_CART_APPROVAL_REQUIRED', 'x', undefined, {
      code: 'cart_approval_pending',
    });
    expect(vocabulary.failureCode(pending, 'PLACE_FAILED')).toBe('ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending');
    const unknown = new StorefrontApiError(409, 'ORDER_CART_APPROVAL_REQUIRED', 'x', undefined, { code: 'other' });
    expect(vocabulary.failureCode(unknown, 'PLACE_FAILED')).toBe('ORDER_CART_APPROVAL_REQUIRED');
  });

  it('carries the action’s own code for an API code the page does not name, or no API answer', () => {
    expect(vocabulary.failureCode(new StorefrontApiError(500, 'INTERNAL', 'Database exploded.'), 'PLACE_FAILED')).toBe(
      'PLACE_FAILED',
    );
    expect(vocabulary.failureCode(new Error('fetch failed'), 'PLACE_FAILED')).toBe('PLACE_FAILED');
    expect(vocabulary.failureCode(null, 'PLACE_FAILED')).toBe('PLACE_FAILED');
  });

  it('does not take an API answer naming a storefront code at its word', () => {
    expect(vocabulary.failureCode(new StorefrontApiError(400, 'FAILED', 'x'), 'PLACE_FAILED')).toBe('PLACE_FAILED');
    expect(vocabulary.failureCode(new StorefrontApiError(400, 'constructor', 'x'), 'PLACE_FAILED')).toBe('PLACE_FAILED');
  });
});

describe('errorKey — what the page says about ?error=<code>', () => {
  it('names nothing without a parameter', () => {
    expect(vocabulary.errorKey(undefined)).toBeNull();
    expect(vocabulary.errorKey('')).toBeNull();
  });

  it('names an API code, a refinement and an own code', () => {
    expect(vocabulary.errorKey('CART_EMPTY')).toBe('commerce.error.CART_EMPTY');
    expect(vocabulary.errorKey('ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending')).toBe(
      'commerce.error.ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending',
    );
    expect(vocabulary.errorKey('PLACE_FAILED')).toBe('commerce.checkout.placeFailed');
  });

  it.each(['Twoja rola wymaga akceptacji…', 'SOMETHING_ELSE', 'constructor', '__proto__', 'toString'])(
    'reads %s as the generic failure',
    (crafted) => {
      expect(vocabulary.errorKey(crafted)).toBe('checkout.failure.generic');
      expect(vocabulary.isCode(crafted)).toBe(false);
    },
  );
});
