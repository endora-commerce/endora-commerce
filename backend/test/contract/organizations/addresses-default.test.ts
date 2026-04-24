import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T097 — `POST /addresses` with `isDefault=true` must demote any prior default
 * of the same `kind` atomically. Enforced by a partial unique index
 * `(organization_id, kind) WHERE is_default = true`.
 */

interface Address {
  id: string;
  kind: 'delivery' | 'billing';
  isDefault: boolean;
}

describe('POST /api/v1/organizations/mine/addresses — isDefault demotion', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('second default=true leaves exactly one default address of that kind', async () => {
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      payload: {
        kind: 'delivery',
        recipientName: 'Anna',
        street: 'ul. Pierwsza 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
        isDefault: true,
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(first.statusCode).toBe(201);

    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      payload: {
        kind: 'delivery',
        recipientName: 'Anna',
        street: 'ul. Druga 2',
        city: 'Warszawa',
        postalCode: '00-002',
        country: 'PL',
        isDefault: true,
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(second.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organizations/mine/addresses?kind=delivery',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Address[] };
    const defaults = body.data.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
  });
});
