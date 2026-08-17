import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootContainer } from '../../../src/kernel/container.js';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { systemTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registerCatalogPublicRoutes } from '../../../src/modules/catalog/routes.public.js';
import type { CatalogQueryService } from '../../../src/modules/catalog/services/catalog-query.service.js';
import type { SearchQueryService } from '../../../src/modules/search/services/search-query.service.js';

/**
 * Issue #144 — the public catalogue listing decides `search`'s presence before
 * it reads Meilisearch.
 *
 * `catalog` builds its own `SearchQueryService` instead of resolving one, so no
 * port is crossed and none of the port checks can see this edge: with
 * `CATALOG_SEARCH_BACKEND=meilisearch` the catalogue went on serving Meilisearch
 * reads after an operator switched `search` off — on a public storefront
 * surface, out of an index whose maintenance subscribers had stopped with the
 * module. Constitution XVII: a module that is off behaves as if never installed,
 * and with `search` never installed this listing is a Postgres query.
 *
 * The degrade is what is asserted, not a 503: the catalogue is
 * non-deactivatable, Postgres is its default read backend, and refusing a public
 * product list because an optional search module is off would be the wrong
 * answer.
 *
 * Meilisearch is never contacted here — the read backend is a recording stub —
 * so "did not query the search backend" is decided by the probe under test and
 * not by an unreachable docker service. That is why this is a unit test rather
 * than a second `catalog-via-meilisearch` integration case: there, an absent
 * Meilisearch produces the same Postgres answer for an entirely different
 * reason.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

const FAKE_CHANNEL = {
  id: 'chan-1',
  code: 'default',
  name: { en: 'Default' },
  active: true,
  isPublic: true,
  systemDefault: true,
  defaultLanguage: 'en',
  defaultCurrency: 'PLN',
  themeCode: null,
  logoAssetId: null,
  languages: ['en'],
  currencies: ['PLN'],
  version: 1,
};

const EMPTY_PAGE = {
  data: [],
  pagination: { hasMore: false, limit: 50, cursor: null },
};

describe('catalog public listing — the Meilisearch read decides `search` presence', () => {
  let app: FastifyInstance;
  let postgresListProducts: ReturnType<typeof vi.fn>;
  let meilisearchListProducts: ReturnType<typeof vi.fn>;
  let originalBackend: string | undefined;

  beforeEach(async () => {
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    registryCache.__setEnabledForTesting(ALL_IDS);

    postgresListProducts = vi.fn(async () => structuredClone(EMPTY_PAGE));
    meilisearchListProducts = vi.fn(async () => structuredClone(EMPTY_PAGE));

    const container = createRootContainer();
    app = Fastify();
    // The stand-in for the sales-channel resolver middleware: the channel lives
    // on the request scope now, so the hook opens one exactly as the production
    // tenant hook does.
    app.addHook('onRequest', (_request, reply, done) => {
      void enterPlatformScope(
        systemTenantContext('catalog public listing presence test'),
        () =>
          new Promise<void>((resolve) => {
            reply.raw.once('close', resolve);
            done();
          }),
        { channel: FAKE_CHANNEL, container },
      );
    });
    await registerCatalogPublicRoutes(app, {
      queryService: {
        listProducts: postgresListProducts,
      } as unknown as CatalogQueryService,
      searchQueryService: {
        listProducts: meilisearchListProducts,
      } as unknown as SearchQueryService,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (originalBackend === undefined) delete process.env['CATALOG_SEARCH_BACKEND'];
    else process.env['CATALOG_SEARCH_BACKEND'] = originalBackend;
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(() => {
    // The cache is a process singleton and the suite shares one fork: leave it
    // the way every other file finds it.
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  it('serves the search backend while `search` is on', async () => {
    expect(effectiveState.isPresent('search'), 'the fixture never switched it on').toBe(true);

    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=50' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    expect(meilisearchListProducts).toHaveBeenCalledTimes(1);
    expect(postgresListProducts).not.toHaveBeenCalled();
  });

  it('falls back to Postgres while `search` is off, and never queries the index', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['search'] });
    // Assert the module really is off before asserting anything about the
    // behaviour of a module being off: an off-state test against a module that
    // is still on passes for the wrong reason and proves nothing.
    expect(effectiveState.isPresent('search'), 'the fixture did not switch it off').toBe(false);

    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=50' });

    expect(res.statusCode, 'the public listing must degrade, not refuse').toBe(200);
    expect(res.headers['x-search-backend']).toBe('postgres');
    expect(
      meilisearchListProducts,
      'a switched-off `search` was still serving the public catalogue listing',
    ).not.toHaveBeenCalled();
    expect(postgresListProducts).toHaveBeenCalledTimes(1);
  });

  it('restores the search backend when `search` comes back', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['search'] });
    await app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=50' });
    expect(meilisearchListProducts).not.toHaveBeenCalled();

    registryCache.__setEnabledForTesting(ALL_IDS);
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=50' });

    expect(res.headers['x-search-backend']).toBe('meilisearch');
    expect(meilisearchListProducts).toHaveBeenCalledTimes(1);
    expect(postgresListProducts, 'the fallback ran a second time').toHaveBeenCalledTimes(1);
  });
});
