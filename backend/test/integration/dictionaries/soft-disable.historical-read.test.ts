import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary soft-disable historical reads (feature 017 / US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('excludes inactive entries from the registry but keeps by-code reads available', async () => {
    const adminCookie = { b2b_session: 'stub-admin-session' };
    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/dictionary/countries/DE',
      cookies: adminCookie,
      payload: { isActive: false },
    });
    expect(update.statusCode).toBe(200);

    const registry = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary?locale=en-US',
    });
    expect(registry.statusCode).toBe(200);
    expect(registry.json().data.countries.some((c: { code: string }) => c.code === 'DE')).toBe(
      false,
    );

    const byCode = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/by-code?type=country&code=DE&locale=en-US',
    });
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json().data.entry).toMatchObject({ code: 'DE', isActive: false });
  });
});

