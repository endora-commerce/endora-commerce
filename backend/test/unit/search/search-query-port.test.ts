import { describe, expect, it } from 'vitest';
import type { SearchListResult, SearchQueryContext } from '@b2b/contracts';
import { createSearchQueryPort } from '../../../src/modules/search/services/search-query-port.js';
import { SearchBackendUnavailable } from '../../../src/modules/search/services/search-query.service.js';

/**
 * `searchQueryPort` answers "the index was unreachable" in its return type
 * (feature 075, issue #153).
 *
 * The point of the conversion is what the *consumer* is then unable to write:
 * `catalog`'s listing route used to fall back to Postgres from inside
 * `catch (err) { if (err instanceof SearchBackendUnavailable) … else throw err }`,
 * which is the conditional re-throw `check:port-catches` refuses around a port
 * call — a status test lets `ModuleDisabledError` through by accident rather
 * than by decision. With the degrade expressed here, on the owner's side, the
 * consumer reads a field.
 */

const ctx: SearchQueryContext = {
  resolvedChannel: {
    id: '00000000-0000-0000-0000-0000000000c1',
    code: 'pl_retail',
    isPublic: true,
    defaultCurrency: 'PLN',
    defaultLanguage: 'pl',
  },
  preferredLanguage: 'pl',
};

const page: SearchListResult = {
  data: [],
  pagination: { cursor: null, hasMore: false, limit: 20 },
};

describe('createSearchQueryPort', () => {
  it('hands a successful page back under the `ok` arm', async () => {
    const port = createSearchQueryPort({
      listProducts: async () => page,
    });

    const outcome = await port.listProducts({ limit: 20 }, ctx);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.result).toEqual(page);
  });

  it('converts SearchBackendUnavailable into the `index-unavailable` arm', async () => {
    const port = createSearchQueryPort({
      listProducts: async () => {
        throw new SearchBackendUnavailable('connect ECONNREFUSED 127.0.0.1:7700');
      },
    });

    const outcome = await port.listProducts({ limit: 20 }, ctx);

    expect(outcome.status).toBe('index-unavailable');
    if (outcome.status !== 'index-unavailable') throw new Error('expected an unavailable outcome');
    expect(outcome.reason).toContain('ECONNREFUSED');
  });

  it('lets every other failure through — the conversion is not a `catch`-all', async () => {
    // A 400 on an unfilterable attribute is the search module's own answer and
    // must reach the caller. Swallowing it here would be the fail-open the
    // whole conversion exists to prevent, one layer lower down.
    const boom = new Error('Attribute "colour" is not filterable.');
    const port = createSearchQueryPort({
      listProducts: async () => {
        throw boom;
      },
    });

    await expect(port.listProducts({ limit: 20 }, ctx)).rejects.toBe(boom);
  });
});
