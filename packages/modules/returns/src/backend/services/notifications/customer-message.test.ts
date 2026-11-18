import { describe, expect, it } from 'vitest';
import { GUEST_TWINS, customerMessageFor } from './customer-message.js';

/**
 * `specs/181-guest-complaints/` T028 (FR-044, FR-072; research R-7): which e-mail a
 * case's filer receives, and where. One function decides it for every customer e-mail:
 * an account's case keeps 180's template and recipient; a guest's case gets the guest
 * twin at the verified address; an erased guest case gets nothing.
 */
describe('customerMessageFor', () => {
  const ACCOUNT = { customerAccountId: 'acc-1', contact: { email: 'typed@example.test' }, personalDataErasedAt: null };
  const GUEST = { customerAccountId: null, contact: { email: 'guest@example.test' }, personalDataErasedAt: null };

  it.each(Object.keys(GUEST_TWINS) as Array<keyof typeof GUEST_TWINS>)(
    'keeps %s for an account, addressed to the account',
    (code) => {
      expect(customerMessageFor(ACCOUNT, code)).toEqual({ audience: 'customer', code, customerAccountId: 'acc-1' });
    },
  );

  it.each(Object.entries(GUEST_TWINS))('picks the twin of %s for a guest, to the verified address', (code, twin) => {
    expect(customerMessageFor(GUEST, code as keyof typeof GUEST_TWINS)).toEqual({
      audience: 'guest',
      code: twin,
      to: 'guest@example.test',
    });
  });

  it('names every twin of 181', () => {
    expect(GUEST_TWINS).toEqual({
      return_submitted: 'return_guest_submitted',
      return_comment_added: 'return_guest_comment_added',
      return_status_entered: 'return_guest_status_entered',
      return_authorized: 'return_guest_authorized',
      return_rejected: 'return_guest_rejected',
    });
  });

  it('answers nothing for a guest case after erasure, or without an address', () => {
    expect(customerMessageFor({ ...GUEST, personalDataErasedAt: new Date() }, 'return_comment_added')).toBeNull();
    expect(customerMessageFor({ ...GUEST, contact: null }, 'return_status_entered')).toBeNull();
    expect(customerMessageFor({ ...GUEST, contact: { email: '  ' } }, 'return_submitted')).toBeNull();
  });

  it('keeps 180’s behaviour for an account whose case data was erased: the account decides', () => {
    expect(customerMessageFor({ ...ACCOUNT, contact: null, personalDataErasedAt: new Date() }, 'return_rejected')).toEqual({
      audience: 'customer',
      code: 'return_rejected',
      customerAccountId: 'acc-1',
    });
  });
});
