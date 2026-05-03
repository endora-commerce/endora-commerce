import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

describe('debug', () => {
  let h: BackendServerHandle;
  beforeAll(async () => { h = await setupBackendServer(); });
  afterAll(async () => { await teardownBackendServer(h); });

  it('inspects snapshots', async () => {
    const c = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, desiredUnitPrice: 8 }] },
    });
    const created = (c.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 60, agreedUnitPrice: 8.0 }] },
    });
    const d = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    console.log('DETAIL', JSON.stringify((d.json() as any).data.comparisonAgainstLastSeen, null, 2));
  });
});
