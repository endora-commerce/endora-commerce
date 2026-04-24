import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T102 — `GET /orders/:id/invoice`:
 *   - 404 INVOICE_NOT_READY before the async generation completes.
 *   - 200 application/pdf once the PDF is attached.
 */

describe('GET /api/v1/orders/:id/invoice — availability', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 404 INVOICE_NOT_READY before the job finishes', async () => {
    // Fixture: a freshly placed Order whose invoice job has not yet run.
    const orderId = '00000000-0000-4000-8000-000000000301';
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoice`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.INVOICE_NOT_READY);
  });

  it('returns 200 application/pdf once the invoice is ready', async () => {
    // Fixture: a paid Order with an attached Invoice in status='ready'.
    const orderId = '00000000-0000-4000-8000-000000000302';
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoice`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // PDF magic header `%PDF-`
    expect(res.rawPayload.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
