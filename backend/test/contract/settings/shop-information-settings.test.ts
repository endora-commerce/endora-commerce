import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature: shop / company contact information settings.
 *
 * The Settings module registers a `shop` group with the store's public
 * contact fields. These are consumed across the storefront (footer, the 404
 * "need help?" block, the contact form recipients, etc.). This contract test
 * pins the registration + defaults so the admin section and downstream
 * consumers have a stable surface.
 */
describe('Settings — shop information', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  const expectedCodes = [
    'shop.name',
    'shop.address',
    'shop.contact_email',
    'shop.support_email',
    'shop.phone',
    'shop.contact_form_recipient_emails',
  ];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('registers all shop settings in the shop group as strings defaulting to empty', async () => {
    for (const code of expectedCodes) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/settings/${code}`,
        cookies: adminCookie,
      });
      expect(res.statusCode, `GET ${code}`).toBe(200);
      const dto = res.json() as {
        code: string;
        valueType: string;
        defaultValue: unknown;
      };
      expect(dto.code).toBe(code);
      expect(dto.valueType).toBe('string');
      expect(dto.defaultValue).toBe('');
    }
  });

  it('accepts a global override value for the support email', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/shop.support_email/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 'support@example.com' },
    });
    expect(put.statusCode).toBe(200);
    const dto = put.json() as { globalValue: unknown };
    expect(dto.globalValue).toBe('support@example.com');
  });
});
