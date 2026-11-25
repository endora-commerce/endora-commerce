import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminSearchCapabilitySchema,
  AdminSearchResponseSchema,
  type AdminSearchProvider,
  type AdminSearchProviderQuery,
  type AdminSearchProviderRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/150-admin-global-search/` T013 — the capability and search routes
 * against their contract (`contracts/admin-search-api.md` §1–§2), with fixture
 * providers registered through the composed `adminSearchProviderRegistry`.
 *
 * The fixtures carry the id of an always-present module (`catalog`), so the
 * presence filter keeps them and the permission filter is what the
 * restricted-admin case measures. Every search narrows to the fixture types so
 * the real providers in the composition do not enter the assertions.
 */
describe('admin global search — capability and search API (spec 150)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const restricted = { b2b_session: 'stub-global-search-restricted-session' };
  const RESTRICTED_ID = '00000000-0000-4000-8000-0000000150a2';
  const FIXTURE = 'catalog.fixture_thing';
  const GATED = 'catalog.fixture_gated';
  const FIXTURES = `${FIXTURE},${GATED}`;
  const seen: AdminSearchProviderQuery[] = [];

  function fixture(entityType: string, requiredPermission: string): AdminSearchProvider {
    return {
      entityType,
      moduleId: 'catalog',
      // A key `catalog`'s bundle carries today, so the resolution is observable.
      labelKey: 'nav.products.label',
      icon: 'Package',
      requiredPermission,
      weight: 9000,
      fields: [{ code: 'name', labelKey: 'adminSearch.product.field.name', defaultSelected: true, identifier: false }],
      async search(query) {
        seen.push(query);
        return {
          hits: [
            {
              id: `${entityType}-1`,
              title: `Thing for ${query.text}`,
              subtitle: null,
              status: { code: 'active', label: 'Active' },
              targetRoute: '/catalog/products/x',
            },
          ],
          hasMore: false,
        };
      },
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const registry = h.container.resolve('adminSearchProviderRegistry') as AdminSearchProviderRegistryPort;
    registry.register(fixture(FIXTURE, 'catalog:read'));
    // A code nobody holds but the platform admin's wildcard role.
    registry.register(fixture(GATED, 'orders:write'));
    await withSystemScope('test seed: global search restricted admin', async () => {
      const em = h.em();
      let role = await em.findOne(AdminRole, { code: 'global_search_catalog_reader' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'global_search_catalog_reader',
          name: 'Global search catalog reader',
          permissions: ['catalog:read'],
        });
        await em.persist(role).flush();
      }
      if (!(await em.findOne(AdminUser, { id: RESTRICTED_ID }))) {
        em.create(AdminUser, {
          id: RESTRICTED_ID,
          email: 'global-search-restricted@example.com',
          passwordHash: 'x'.repeat(60),
          firstName: 'Global',
          lastName: 'Search',
          adminRoleId: role.id,
          status: 'active',
        });
        await em.flush();
      }
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers 401 without a session on both routes', async () => {
    for (const url of ['/api/v1/admin/global-search/capability?language=en', '/api/v1/admin/global-search?q=abc&language=en']) {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('answers the capability contract, with private no-store caching', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/global-search/capability?language=en',
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const data = AdminSearchCapabilitySchema.parse((res.json() as { data: unknown }).data);
    expect(data.minimumQueryLength).toBeGreaterThanOrEqual(2);
    expect(data.entityTypes.map((e) => e.entityType)).toEqual(expect.arrayContaining([FIXTURE, GATED]));
    // Labels are resolved server-side in the request language.
    expect(data.entityTypes.find((e) => e.entityType === FIXTURE)?.label).toBe('Products');
  });

  it('answers the search contract and passes the provider an escaped, typed query', async () => {
    seen.length = 0;
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${encodeURIComponent('  a%_c  ')}&entityTypes=${FIXTURES}&language=pl`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const body = AdminSearchResponseSchema.parse(res.json());
    expect(body.data.query).toBe('a%_c');
    expect(body.meta.belowMinimumLength).toBe(false);
    // Equal weights order by entity type.
    expect(body.data.groups.map((g) => g.entityType)).toEqual([GATED, FIXTURE]);
    expect(body.data.groups[1]).toMatchObject({ status: 'ok', hasMore: false });
    expect(body.data.groups[1]?.label).not.toBe('catalog.nav.products.label');
    const query = seen.find((q) => q.text === 'a%_c');
    expect(query).toMatchObject({ likeEscaped: 'a\\%\\_c', isUuid: false, fields: ['name'], language: 'pl' });
  });

  it('refuses a text over 100 characters with 400', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${'a'.repeat(101)}&language=en`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('answers a short text with 200 and belowMinimumLength, running no provider', async () => {
    seen.length = 0;
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=ab&entityTypes=${FIXTURES}&language=en`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    const body = AdminSearchResponseSchema.parse(res.json());
    expect(body.meta.belowMinimumLength).toBe(true);
    expect(body.data.groups).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('leaves a type the caller may not read out of both the capability and the results', async () => {
    const capability = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/global-search/capability?language=en',
      cookies: restricted,
    });
    expect(capability.statusCode).toBe(200);
    const types = (capability.json() as { data: { entityTypes: Array<{ entityType: string }> } }).data.entityTypes.map(
      (e) => e.entityType,
    );
    expect(types).toContain(FIXTURE);
    expect(types).not.toContain(GATED);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=abc&entityTypes=${FIXTURES}&language=en`,
      cookies: restricted,
    });
    expect(res.statusCode).toBe(200);
    const body = AdminSearchResponseSchema.parse(res.json());
    expect(body.data.groups.map((g) => g.entityType)).toEqual([FIXTURE]);
  });
});
