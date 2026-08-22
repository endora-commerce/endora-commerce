import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T206 — Admin grants → Customer GET /me/credit-limit returns the right shape:
 *   { grantedAmount, availableAmount, currency, activeReservations[], grantedAt }
 * Without a grant, GET returns 404 CREDIT_LIMIT_NOT_GRANTED.
 */

interface CreditLimitView {
  organizationId: string;
  grantedAmount: number;
  availableAmount: number;
  currency: string;
  activeReservations: Array<{ orderId: string; amount: number; createdAt: string }>;
  grantedAt: string;
}

describe('GET /api/v1/me/credit-limit + admin grant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 404 CREDIT_LIMIT_NOT_GRANTED before any grant', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
    );
  });

  it('after admin grant, GET returns the granted amount and zero reservations', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const grant = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      payload: { grantedAmount: 10000, currency: 'PLN', reason: 'Initial trial' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(grant.statusCode).toBe(201);

    const view = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(view.statusCode).toBe(200);
    const body = view.json() as { data: CreditLimitView };
    expect(body.data.grantedAmount).toBe(10000);
    expect(body.data.availableAmount).toBe(10000);
    expect(body.data.currency).toBe('PLN');
    expect(body.data.activeReservations).toHaveLength(0);
  });

  it('second grant attempt returns 409 CREDIT_LIMIT_ALREADY_GRANTED', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      payload: { grantedAmount: 5000, currency: 'PLN' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CREDIT_LIMIT_ALREADY_GRANTED,
    );
  });
});
