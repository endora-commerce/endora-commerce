import { describe, expect, it } from 'vitest';
import { resolvePaymentMethodName } from '../../../../packages/modules/payment_methods/src/backend/services/name-resolver.js';

describe('resolvePaymentMethodName', () => {
  it('prefers the exact language override', () => {
    expect(resolvePaymentMethodName({ default: 'Transfer', pl: 'Przelew' }, 'pl')).toBe('Przelew');
  });

  it('falls back to the default key when the language is missing', () => {
    expect(resolvePaymentMethodName({ default: 'Transfer', pl: 'Przelew' }, 'de')).toBe('Transfer');
  });

  it('falls back to the first value when there is no default key', () => {
    expect(resolvePaymentMethodName({ 'en-US': 'Bank transfer' }, 'de')).toBe('Bank transfer');
  });

  it('uses the default when no language is requested', () => {
    expect(resolvePaymentMethodName({ default: 'Transfer', pl: 'Przelew' })).toBe('Transfer');
  });
});
