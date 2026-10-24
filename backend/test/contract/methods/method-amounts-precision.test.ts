import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #417, owner ruling of 2026-10-24 — a delivery cost and a payment
 * surcharge an operator types have at most two decimal places. More is
 * refused with `400 AMOUNT_PRECISION_EXCEEDED`, in the reader's language, and
 * never rounded: `toFixed(2)` once stored 1.005 as 1.00, and half-up would
 * have stored a figure nobody typed.
 */
describe('method amounts refuse more than two decimal places (#417)', () => {
  let h: BackendServerHandle;
  const cookies = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a delivery cost of 1.005, in Polish for an admin who reads Polish', async () => {
    const language = (preferredLanguage: 'pl' | null) =>
      h.app.inject({ method: 'PATCH', url: '/api/v1/admin/me/preferred-language', cookies, payload: { preferredLanguage } });
    expect((await language('pl')).statusCode).toBe(200);
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/precision_courier',
      cookies,
      payload: { code: 'precision_courier', name: { 'en-US': 'Precision courier' }, cost: 1.005, currency: 'PLN' },
    });
    expect(res.statusCode, res.body).toBe(400);
    const { error } = res.json() as { error: { code: string; message: string; details: unknown } };
    expect(error.code).toBe('AMOUNT_PRECISION_EXCEEDED');
    expect(error.details).toEqual([{ path: 'cost', issue: 'AMOUNT_PRECISION_EXCEEDED' }]);
    expect(error.message).toBe('Kwota może mieć najwyżej dwa miejsca po przecinku.');
    await language(null);
  });

  it('refuses a payment surcharge of 2.675', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/precision_transfer',
      cookies,
      payload: { code: 'precision_transfer', name: { 'en-US': 'Precision transfer' }, kind: 'bank_transfer', additionalPrice: 2.675 },
    });
    expect(res.statusCode, res.body).toBe(400);
    const { error } = res.json() as { error: { code: string; message: string } };
    expect(error.code).toBe('AMOUNT_PRECISION_EXCEEDED');
    expect(error.message).toBe('An amount may have at most two decimal places.');
  });

  it('stores two places as typed', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/precision_courier_ok',
      cookies,
      payload: { code: 'precision_courier_ok', name: { 'en-US': 'Courier' }, cost: 12.5, currency: 'PLN' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { cost: { amount: number } } }).data.cost.amount).toBe(12.5);
  });
});
