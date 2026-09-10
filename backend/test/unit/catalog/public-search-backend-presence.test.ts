import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootContainer } from '@endora-commerce/platform/composition';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { systemTenantContext } from '@endora-commerce/platform/composition';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registerCatalogPublicRoutes } from '../../../../packages/modules/catalog/src/backend/routes.public.js';
import type { SearchListOutcome, SearchQueryPort } from '@endora-commerce/contracts';
import type { CatalogQueryService } from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';

/**
 * Issue #144 — the public catalogue listing decides `search`'s presence before
 * it reads Meilisearch.
 *
 * `catalog` used to build its own `SearchQueryService` instead of resolving one,
 * so no port was crossed and none of the port checks could see this edge: with
 * `CATALOG_SEARCH_BACKEND=meilisearch` the catalogue went on serving Meilisearch
 * reads after an operator switched `search` off — on a public storefront
 * surface, out of an index whose maintenance subscribers had stopped with the
 * module. Constitution XVII: a module that is off behaves as if never installed,
 * and with `search` never installed this listing is a Postgres query.
 *
 * Issue #153 made it a port, and the probe under test matters *more* for it:
 * calling a gated port with its owner switched off throws
 * `ModuleDisabledError`, which must not reach a public catalogue listing. The
 * fourth case below covers the other arm — an index the port could not reach —
 * because that fallback used to be a `catch` on an error class and is now a
 * field on the return value.
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

const EMPTY_OUTCOME: SearchListOutcome = { status: 'ok', result: EMPTY_PAGE };

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
    meilisearchListProducts = vi.fn(async () => structuredClone(EMPTY_OUTCOME));

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
      } as unknown as SearchQueryPort,
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

  it('falls back to Postgres when the port reports the index unreachable', async () => {
    // Issue #153 — the other degrade, and the one that used to be a `catch` on
    // `SearchBackendUnavailable`. `search` is present; its index is not. The
    // route reads a field to tell the two apart, so a `ModuleDisabledError`
    // could never be mistaken for a slow index.
    meilisearchListProducts.mockResolvedValueOnce({
      status: 'index-unavailable',
      reason: 'connect ECONNREFUSED 127.0.0.1:7700',
    } satisfies SearchListOutcome);

    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=50' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-search-backend']).toBe('postgres');
    expect(meilisearchListProducts).toHaveBeenCalledTimes(1);
    expect(postgresListProducts).toHaveBeenCalledTimes(1);
  });

  it('routes a price ordering to Postgres while `search` is on, and never queries the index', async () => {
    // Feature 086 / FR-027 — the price orderings behave identically whether
    // `search` is switched on or off, because they never went through the
    // index. Meilisearch has never carried a price (one document per product
    // per channel; per-buyer pricing would multiply the corpus by the customer
    // base) and its `sort` is a tie-break sequence, which cannot express the
    // fall-through the chain implements.
    expect(effectiveState.isPresent('search'), 'the fixture never switched it on').toBe(true);

    for (const query of ['sort=price', 'sort=-price', 'minPrice=10', 'maxPrice=10']) {
      meilisearchListProducts.mockClear();
      postgresListProducts.mockClear();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?limit=50&${query}`,
      });
      expect(res.statusCode, query).toBe(200);
      expect(res.headers['x-search-backend'], query).toBe('postgres');
      expect(meilisearchListProducts, query).not.toHaveBeenCalled();
      expect(postgresListProducts, query).toHaveBeenCalledTimes(1);
    }
  });

  it('answers a price ordering the same way with `search` off', async () => {
    // The other half of FR-027: the same route, the same backend, the same
    // parameters reaching the query service.
    const withSearch = await app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?limit=50&sort=price',
    });
    const paramsWithSearch = postgresListProducts.mock.calls[0]?.[0];

    postgresListProducts.mockClear();
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['search'] });
    expect(effectiveState.isPresent('search'), 'the fixture did not switch it off').toBe(false);
    const withoutSearch = await app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?limit=50&sort=price',
    });

    expect(withoutSearch.statusCode).toBe(withSearch.statusCode);
    expect(withoutSearch.headers['x-search-backend']).toBe(
      withSearch.headers['x-search-backend'],
    );
    expect(withoutSearch.json()).toEqual(withSearch.json());
    expect(postgresListProducts.mock.calls[0]?.[0]).toEqual(paramsWithSearch);
  });

  it('advertises the price controls on the listing response', async () => {
    // FR-023 — the storefront gates its toolbar on this, rather than guessing
    // the display mode it cannot see.
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=50' });
    expect((res.json() as { capabilities?: { priceOrdering?: boolean } }).capabilities).toEqual({
      priceOrdering: true,
    });
  });

  it('refuses the price controls on a channel that publishes no prices', async () => {
    // FR-016's first condition, which needs no pricing port to decide: a
    // non-public channel withholds prices wholesale, so there is nothing to
    // order by.
    const nonPublic = Fastify();
    nonPublic.addHook('onRequest', (_request, reply, done) => {
      void enterPlatformScope(
        systemTenantContext('catalog public listing presence test'),
        () =>
          new Promise<void>((resolve) => {
            reply.raw.once('close', resolve);
            done();
          }),
        { channel: { ...FAKE_CHANNEL, isPublic: false }, container: createRootContainer() },
      );
    });
    await registerCatalogPublicRoutes(nonPublic, {
      queryService: { listProducts: postgresListProducts } as unknown as CatalogQueryService,
    });
    await nonPublic.ready();
    postgresListProducts.mockClear();
    try {
      const refused = await nonPublic.inject({
        method: 'GET',
        url: '/api/v1/catalog/products?limit=50&sort=price',
      });
      // The status, not the envelope: this fixture mounts a bare Fastify with
      // no error-envelope plugin, so the code is asserted in
      // `test/integration/catalog/price-sort-withheld.test.ts`, where the whole
      // server is up.
      expect(refused.statusCode).toBe(400);
      expect(postgresListProducts).not.toHaveBeenCalled();
      const served = await nonPublic.inject({
        method: 'GET',
        url: '/api/v1/catalog/products?limit=50',
      });
      expect(served.statusCode).toBe(200);
      expect(
        (served.json() as { capabilities?: { priceOrdering?: boolean } }).capabilities,
      ).toEqual({ priceOrdering: false });
    } finally {
      await nonPublic.close();
    }
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
