import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_PRODUCT_AUDIENCE, type CatalogProductReadPort } from '@endora-commerce/contracts';
import {
  SearchBackendUnavailable,
  SearchQueryService,
} from '../../../src/modules/search/services/search-query.service.js';

/**
 * Issue #287 — the degrade may be a degrade, but it may not be a fiction.
 *
 * Every failure of the Meilisearch call was wrapped as
 * `SearchBackendUnavailable` and answered `index-unavailable` on the port, so
 * `catalog`'s listing logged "meilisearch unavailable; falling back to
 * postgres" over a Meilisearch that was up, healthy and *refusing the query*
 * — `invalid_search_sort`, because the index carried no sortable attributes.
 * A permanent misconfiguration filed under the one heading an operator reads
 * as "transient, will pass" is how a broken sort survived five live indexes.
 *
 * So the two are distinguished at the point where the answer is known: a
 * refusal names the engine's own error code, in the reason string the port
 * hands the caller for its log line, and the module reports it itself — once
 * per code, because an index setting is a deployment fact and a public
 * listing would otherwise log it on every request.
 */

const productsPort = {
  findByIds: async (): Promise<never[]> => [],
} as unknown as CatalogProductReadPort;

const ctx = {
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
  resolvedChannel: {
    id: '00000000-0000-4000-8000-000000000000',
    code: 'pl_retail',
    isPublic: true,
    defaultCurrency: 'PLN',
    defaultLanguage: 'pl-PL',
  },
};

/**
 * A Meilisearch that is up and says no. The code it refuses with is read off
 * the request path, so each case in this file can use a code of its own and
 * the once-per-condition reporting stays observable without a reset hook.
 */
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const indexUid = decodeURIComponent(req.url ?? '').split('/')[2] ?? '';
    const code = indexUid.replace(/^products_/, '') || 'unknown_code';
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        message: 'Attribute `name` is not sortable. This index does not have configured sortable attributes.',
        code,
        type: 'invalid_request',
        link: 'https://docs.meilisearch.com/errors#invalid_search_sort',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function serviceAgainst(host: string): SearchQueryService {
  return new SearchQueryService(productsPort, undefined, {
    meilisearchHost: host,
    meilisearchApiKey: '',
  });
}

async function failureOf(
  service: SearchQueryService,
  channelCode: string,
): Promise<SearchBackendUnavailable> {
  try {
    await service.listProducts(
      { limit: 10, sort: 'name' },
      { ...ctx, resolvedChannel: { ...ctx.resolvedChannel, code: channelCode } },
    );
  } catch (err) {
    if (err instanceof SearchBackendUnavailable) return err;
    throw err;
  }
  throw new Error('expected the query to fail');
}

describe('SearchQueryService — a refused query is not an outage', () => {
  it('names the engine error code in the reason the caller logs', async () => {
    const failure = await failureOf(serviceAgainst(`http://127.0.0.1:${port}`), 'invalid_search_sort');

    expect(failure.kind).toBe('refused');
    expect(failure.code).toBe('invalid_search_sort');
    // `SearchListOutcome.reason` is the caller's log line, and until now it
    // said "unavailable" about an engine that answered in milliseconds.
    expect(failure.message).toContain('invalid_search_sort');
    expect(failure.message).not.toContain('unavailable');
  });

  it('reports the refusal itself, once per code', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = serviceAgainst(`http://127.0.0.1:${port}`);

    await failureOf(service, 'index_primary_key_no_candidate_found');
    await failureOf(service, 'index_primary_key_no_candidate_found');

    const lines = reported.mock.calls.map((c) => String(c[0]));
    const naming = lines.filter((l) => l.includes('index_primary_key_no_candidate_found'));
    expect(naming).toHaveLength(1);
    expect(naming[0]).toContain('products_index_primary_key_no_candidate_found');
  });

  it('still calls an engine it cannot reach unavailable, and leaves that log line to the caller', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failure = await failureOf(serviceAgainst('http://127.0.0.1:1'), 'pl_retail');

    expect(failure.kind).toBe('unreachable');
    expect(failure.code).toBeNull();
    expect(failure.message).toContain('unavailable');
    // The consumer already logs an unreachable index per request, and that
    // diagnosis is the true one — a second, module-level report would only
    // duplicate it.
    expect(reported).not.toHaveBeenCalled();
  });
});
