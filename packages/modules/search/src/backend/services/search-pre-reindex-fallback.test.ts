import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_PRODUCT_AUDIENCE, type CatalogProductReadPort } from '@endora-commerce/contracts';
import { SearchQueryService } from './search-query.service.js';

/**
 * Feature 174 (`contracts/search-index.md` §2; C2/C3 security review, note 4) — an index not yet
 * reindexed after the upgrade does not know the `texts.<L>.*` fields, so the query is asked again
 * without `attributesToSearchOn` (every field). That fallback is logged, and it stays inside the
 * one channel's index: both requests name the same index, never another channel's.
 */

const productsPort = { findByIds: async (): Promise<never[]> => [] } as unknown as CatalogProductReadPort;
const ctx = {
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
  resolvedChannel: { id: '00000000-0000-4000-8000-000000000000', code: 'pl_retail', defaultCurrency: 'PLN', defaultLanguage: 'pl-PL' },
};

let server: Server;
let port = 0;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({ url: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (body['attributesToSearchOn'] !== undefined) {
        res.writeHead(400);
        res.end(JSON.stringify({ message: 'Attribute `texts.pl-PL.name` is not searchable.', code: 'invalid_search_attributes_to_search_on', type: 'invalid_request', link: '' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ hits: [], offset: 0, limit: 11, estimatedTotalHits: 0, processingTimeMs: 1, query: body['q'] ?? '' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

afterEach(() => {
  vi.restoreAllMocks();
  requests.length = 0;
});

describe('SearchQueryService — the pre-reindex fallback', () => {
  it('retries without the restriction on the same channel index, and logs a warning', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new SearchQueryService(productsPort, undefined, { meilisearchHost: `http://127.0.0.1:${port}`, meilisearchApiKey: '' });

    await service.listProducts({ q: 'drill', limit: 10 }, ctx);

    const searches = requests.filter((r) => r.url.endsWith('/search'));
    expect(searches).toHaveLength(2);
    expect(searches[0]!.body['attributesToSearchOn']).toBeDefined();
    expect(searches[1]!.body['attributesToSearchOn']).toBeUndefined();
    // One index for both, the channel's own.
    const indexes = new Set(searches.map((r) => r.url.split('/')[2]));
    expect(indexes.size).toBe(1);
    expect([...indexes][0]).toContain('pl_retail');
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('searching every field'), expect.objectContaining({ indexUid: expect.stringContaining('pl_retail') }));
  });
});
