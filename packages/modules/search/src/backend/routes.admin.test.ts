import Fastify, { type FastifyInstance } from 'fastify';
import { MeilisearchApiError, MeilisearchRequestError } from 'meilisearch';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { registerSearchAdminRoutes } from './routes.admin.js';
import type { LlmToggleService } from './services/llm-toggle.service.js';
import type { SearchReindexWorker } from './services/search-reindex-worker.js';

/**
 * `POST /api/v1/admin/search/reindex` when the search engine cannot be used.
 *
 * The operator pressing "Reindex now" is the one person who can act on a search
 * container that is down, so the answer has to name the condition: the same
 * `503 SEARCH_BACKEND_UNAVAILABLE` the storefront's suggest route gives a buyer
 * for it, rather than an untyped 500 that reads as "the platform is broken".
 *
 * A bare Fastify instance, so the assertion is on what the handler **raised** —
 * the status and the code Fastify reads off the thrown error. The platform's
 * own envelope around it is exercised by the contract suite.
 */
const allowEveryone: RequireAdminFactory = (() => async () => undefined) as RequireAdminFactory;

async function appWith(reindex: () => Promise<unknown>): Promise<FastifyInstance> {
  const app = Fastify();
  await registerSearchAdminRoutes(app, {
    llmToggleService: {} as LlmToggleService,
    reindexWorker: { reindex } as unknown as SearchReindexWorker,
    requireAdmin: allowEveryone,
  });
  return app;
}

describe('POST /api/v1/admin/search/reindex — an unusable search backend [unit]', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const post = (a: FastifyInstance) =>
    a.inject({ method: 'POST', url: '/api/v1/admin/search/reindex', payload: {} });

  it('answers 503 SEARCH_BACKEND_UNAVAILABLE when the engine is unreachable', async () => {
    app = await appWith(async () => {
      throw new MeilisearchRequestError(
        'http://127.0.0.1:7700/indexes',
        new TypeError('fetch failed'),
      );
    });
    const res = await post(app);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe(ERROR_CODES.SEARCH_BACKEND_UNAVAILABLE);
  });

  it('answers the same code when the engine refuses the request, and says why', async () => {
    app = await appWith(async () => {
      throw new MeilisearchApiError(new Response(null, { status: 403 }), {
        message: 'The provided API key is invalid.',
        code: 'invalid_api_key',
        type: 'auth',
        link: 'https://docs.meilisearch.com/errors#invalid_api_key',
      });
    });
    const res = await post(app);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe(ERROR_CODES.SEARCH_BACKEND_UNAVAILABLE);
    expect(res.json().message).toContain('The provided API key is invalid.');
  });

  it('does not relabel a failure that is not the search engine', async () => {
    app = await appWith(async () => {
      throw new Error('connection to the database was lost');
    });
    const res = await post(app);
    expect(res.statusCode).toBe(500);
    expect(res.json().code).not.toBe(ERROR_CODES.SEARCH_BACKEND_UNAVAILABLE);
  });

  it('still answers the summary when the reindex succeeds', async () => {
    app = await appWith(async () => ({ channelsReindexed: 2, documentCount: 7 }));
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ channelsReindexed: 2, documentCount: 7 });
  });
});
