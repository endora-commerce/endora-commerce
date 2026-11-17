import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootContainer } from '@endora-commerce/platform/composition';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { systemTenantContext } from '@endora-commerce/platform/composition';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registerCatalogPublicRoutes } from '../../../../packages/modules/catalog/src/backend/routes.public.js';
import type { SearchMatchingIdsOutcome, SearchQueryPort } from '@endora-commerce/contracts';
import type { CatalogQueryService } from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';

/**
 * Issue #1326 — `GET /catalog/filters` counts over the products the listing's
 * text query matches.
 *
 * The route took no query at all, so a search with no hit showed "Color (40)"
 * — the catalogue's counts — beside "no product matches". With `?q=` the counts
 * are taken over the result set, and over the result set **the listing
 * itself** computes: the one `GET /catalog/products?q=` answers from the
 * search index whenever it is asked to (a typo the index forgives would
 * otherwise list products the counts said were not there), and from Postgres's
 * text match whenever the listing degrades there. Either way the counting is
 * Postgres's, over the products this caller may reach (issue #227): the index
 * contributes the ids it matched, never a count.
 *
 * Both backends are recording stubs; what is asserted is which one decides
 * the narrowing, under the same conditions the listing route uses.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

const FAKE_CHANNEL = {
  id: 'chan-1',
  code: 'default',
  name: { en: 'Default' },
  active: true,
  anonymousAccess: true,
  prefixDefaultLanguage: true,
  systemDefault: true,
  defaultLanguage: 'en',
  defaultCurrency: 'PLN',
  themeCode: null,
  logoAssetId: null,
  languages: ['en'],
  currencies: ['PLN'],
  version: 1,
};

const MATCHED = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

describe('catalog public filters — counted over the text query’s result set', () => {
  let app: FastifyInstance;
  let getFilterDefinitions: ReturnType<typeof vi.fn>;
  let matchingProductIds: ReturnType<typeof vi.fn>;
  let originalBackend: string | undefined;

  beforeEach(async () => {
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    delete process.env['CATALOG_SEARCH_BACKEND'];
    registryCache.__setEnabledForTesting(ALL_IDS);

    getFilterDefinitions = vi.fn(async () => []);
    matchingProductIds = vi.fn(
      async (): Promise<SearchMatchingIdsOutcome> => ({ status: 'ok', ids: [...MATCHED] }),
    );
    const container = createRootContainer();
    app = Fastify();
    app.addHook('onRequest', (_request, reply, done) => {
      void enterPlatformScope(
        systemTenantContext('catalog public filters query test'),
        () =>
          new Promise<void>((resolve) => {
            reply.raw.once('close', resolve);
            done();
          }),
        { channel: FAKE_CHANNEL, container },
      );
    });
    await registerCatalogPublicRoutes(app, {
      queryService: { getFilterDefinitions } as unknown as CatalogQueryService,
      searchQueryService: {
        listProducts: vi.fn(),
        matchingProductIds,
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
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  function narrowingOf(call: number): unknown {
    return getFilterDefinitions.mock.calls[call]?.[1];
  }

  it('counts over the whole catalogue when there is no text query', async () => {
    for (const query of ['', '?q=', '?q=%20%20']) {
      getFilterDefinitions.mockClear();
      const res = await app.inject({ method: 'GET', url: `/api/v1/catalog/filters${query}` });
      expect(res.statusCode, query).toBe(200);
      expect(narrowingOf(0), query).toBeUndefined();
    }
    expect(matchingProductIds).not.toHaveBeenCalled();
  });

  it('counts over the ids the search index matched, as the listing does', async () => {
    expect(effectiveState.isPresent('search'), 'the fixture never switched it on').toBe(true);

    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/filters?q=helmest' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    expect(matchingProductIds).toHaveBeenCalledTimes(1);
    expect(matchingProductIds.mock.calls[0]?.[0]).toEqual({ q: 'helmest' });
    expect(narrowingOf(0)).toEqual({ ids: MATCHED });
  });

  it('counts over nothing when the index matched nothing', async () => {
    matchingProductIds.mockResolvedValueOnce({ status: 'ok', ids: [] } satisfies SearchMatchingIdsOutcome);

    await app.inject({ method: 'GET', url: '/api/v1/catalog/filters?q=%C5%82o%C5%BCysko' });

    expect(narrowingOf(0)).toEqual({ ids: [] });
  });

  it('counts over the Postgres text match while `search` is off, and never queries the index', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['search'] });
    expect(effectiveState.isPresent('search'), 'the fixture did not switch it off').toBe(false);

    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/filters?q=helmets' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-search-backend']).toBe('postgres');
    expect(matchingProductIds).not.toHaveBeenCalled();
    expect(narrowingOf(0)).toEqual({ q: 'helmets' });
  });

  it('counts over the Postgres text match when the index is unreachable', async () => {
    matchingProductIds.mockResolvedValueOnce({
      status: 'index-unavailable',
      reason: 'connect ECONNREFUSED 127.0.0.1:7700',
    } satisfies SearchMatchingIdsOutcome);

    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/filters?q=helmets' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-search-backend']).toBe('postgres');
    expect(narrowingOf(0)).toEqual({ q: 'helmets' });
  });

  it('counts over the Postgres text match with `CATALOG_SEARCH_BACKEND=postgres`', async () => {
    process.env['CATALOG_SEARCH_BACKEND'] = 'postgres';

    await app.inject({ method: 'GET', url: '/api/v1/catalog/filters?q=helmets' });

    expect(matchingProductIds).not.toHaveBeenCalled();
    expect(narrowingOf(0)).toEqual({ q: 'helmets' });
  });
});
