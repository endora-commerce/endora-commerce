import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HomepageConfigResponseSchema } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature: storefront home-page CMS-page setting.
 *
 * GET /api/v1/storefront/homepage resolves the `homepage_cms_page_slug`
 * setting for the request's sales channel. Null when unset (storefront then
 * renders its built-in landing page).
 */
describe('Settings — GET /api/v1/storefront/homepage', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('defaults to null when no home-page CMS page is configured', async () => {
    // Reset any global override left by other tests sharing the DB.
    await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/settings/homepage_cms_page_slug/values',
      cookies: adminCookie,
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/homepage',
    });
    expect(res.statusCode).toBe(200);
    const parsed = HomepageConfigResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.data.cmsPageSlug).toBeNull();
  });

  it('returns the configured slug after an admin sets it', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/homepage_cms_page_slug/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 'welcome' },
    });
    expect(put.statusCode).toBe(200);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/homepage',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { cmsPageSlug: string | null } };
    expect(body.data.cmsPageSlug).toBe('welcome');

    // Cleanup so the global override doesn't leak into other suites.
    await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/settings/homepage_cms_page_slug/values',
      cookies: adminCookie,
    });
  });
});
