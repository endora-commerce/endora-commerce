import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary storefront cache (feature 017 / US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.redis.del('dictionary:registry:v1:default:en-US');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('caches registry reads and invalidates on dictionary writes', async () => {
    const cacheKey = 'dictionary:registry:v1:default:en-US';
    expect(await h.redis.exists(cacheKey)).toBe(0);

    const first = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary?locale=en-US',
    });
    expect(first.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(1);

    await h.orm.em.getConnection().execute(
      `update "countries" set "label" = 'Cached Poland' where "code" = 'PL'`,
    );

    const second = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary?locale=en-US',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.countries.find((c: { code: string }) => c.code === 'PL').label).toBe(
      'Poland',
    );

    const adminCookie = { b2b_session: 'stub-admin-session' };
    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/dictionary/countries/PL',
      cookies: adminCookie,
      payload: { label: 'Poland' },
    });
    expect(update.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(0);
  });
});

