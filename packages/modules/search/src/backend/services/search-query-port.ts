import type {
  SearchListOutcome,
  SearchListProductsParams,
  SearchListResult,
  SearchQueryContext,
  SearchQueryPort,
} from '@endora-commerce/contracts';
import { SearchBackendUnavailable } from './search-query.service.js';

/**
 * The `searchQueryPort` adapter — where the Meilisearch degrade lives
 * (feature 075, issue #153).
 *
 * `SearchQueryService` throws {@link SearchBackendUnavailable} when the index
 * refuses or times out, and that was fine while its one cross-module caller
 * constructed the class: a `catch` around a plain object is a plain `catch`.
 * It stops being fine the moment the caller resolves a **port**, because the
 * same clause then also stands between the caller and `ModuleDisabledError` —
 * `catch (err) { if (err instanceof SearchBackendUnavailable) … else throw }`
 * is the conditional re-throw `check:port-catches` refuses, and it refuses it
 * because a status test lets a switched-off module through by accident rather
 * than by decision.
 *
 * So the conversion happens here, on the owner's side of the boundary, and the
 * published `SearchQueryPort` states the two outcomes in its return type. This
 * is the module's own error class caught inside the module that raises it —
 * not a tolerance bolted onto a port call.
 *
 * Nothing else is caught. A 400 on an unfilterable attribute is `search`'s
 * answer to a bad request and reaches the caller unchanged.
 */

/** The read side of `SearchQueryService`, as this adapter consumes it. */
export interface SearchQueryBackend {
  listProducts(
    params: SearchListProductsParams,
    ctx: SearchQueryContext,
  ): Promise<SearchListResult>;
}

export function createSearchQueryPort(backend: SearchQueryBackend): SearchQueryPort {
  return {
    async listProducts(
      params: SearchListProductsParams,
      ctx: SearchQueryContext,
    ): Promise<SearchListOutcome> {
      try {
        return { status: 'ok', result: await backend.listProducts(params, ctx) };
      } catch (err) {
        // Narrow by construction: only this module's own unavailability
        // signal is converted, and every other failure — including anything
        // the container could raise — is re-thrown unconditionally.
        if (err instanceof SearchBackendUnavailable) {
          return { status: 'index-unavailable', reason: err.message };
        }
        throw err;
      }
    },
  };
}
