import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ERROR_CODES,
  SearchSuggestQuerySchema,
  SEARCH_PHRASE_MAX_LENGTH,
  SEARCH_SUGGEST_LIMIT_MAX,
  type SearchSuggestResponse,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import {
  QueryTooShort,
  SearchBackendUnavailable,
  type SearchSuggestService,
} from './services/search-suggest.service.js';

/**
 * Public HTTP surface — feature 006 / US1 (T013) and US3 (T036).
 *
 * Routes mounted under `/api/v1/search/*`:
 *   - GET  /suggest  — typeahead popup feed.
 *   - POST /record   — analytics ingest (US3, registered when the recorder
 *                      is wired in via `SearchPublicDeps.phraseRecorder`).
 *
 * Sales-channel scoping mirrors the catalog public routes: the channel is
 * resolved from the `X-Sales-Channel` header (the `sales_channels`
 * resolver middleware will eventually hydrate `request.salesChannel`
 * directly; until then we read the header in here, same as catalog).
 */

const salesChannelHeaderSchema = z.string().optional();
const acceptLanguageHeaderSchema = z.string().optional();

export interface SearchPublicDeps {
  suggestService: SearchSuggestService;
  // phraseRecorder?: SearchPhraseRecorder;  // wired in T037 (US3)
}

export async function registerSearchPublicRoutes(
  app: FastifyInstance,
  deps: SearchPublicDeps,
): Promise<void> {
  const { suggestService } = deps;

  // GET /api/v1/search/suggest
  app.get('/api/v1/search/suggest', async (request) => {
    const parsed = parseSuggestQuery(request);
    const ctx = readContext(request);

    try {
      const result = await suggestService.suggest(
        {
          q: parsed.q,
          ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
        },
        ctx,
      );
      return result satisfies SearchSuggestResponse;
    } catch (err) {
      if (err instanceof QueryTooShort) {
        throw new HttpError(
          400,
          ERROR_CODES.QUERY_TOO_SHORT,
          `Query is shorter than the minimum length of ${err.minimumQueryLength} characters.`,
          [{ path: 'q', issue: 'phrase below minimum length' }],
        );
      }
      if (err instanceof SearchBackendUnavailable) {
        throw new HttpError(
          503,
          ERROR_CODES.SEARCH_BACKEND_UNAVAILABLE,
          'Search is temporarily unavailable.',
        );
      }
      throw err;
    }
  });
}

/**
 * Parses + validates `?q=…&limit=N`. Returns the canonicalised pair or
 * raises an HttpError that the route handler does NOT need to translate.
 *
 * We hand-parse instead of letting Zod's `safeParse` populate the body
 * because we want the search-specific error codes (`QUERY_TOO_LONG`,
 * `LIMIT_OUT_OF_RANGE`) rather than the generic `VALIDATION_FAILED`.
 */
function parseSuggestQuery(request: FastifyRequest): {
  q: string;
  limit?: number | undefined;
} {
  const raw = (request.query ?? {}) as Record<string, unknown>;
  const qRaw = typeof raw['q'] === 'string' ? raw['q'] : undefined;
  const limitRaw =
    typeof raw['limit'] === 'string' ? Number(raw['limit']) : undefined;

  if (qRaw === undefined || qRaw.length === 0) {
    throw new HttpError(
      400,
      ERROR_CODES.QUERY_TOO_SHORT,
      'Query parameter "q" is required.',
      [{ path: 'q', issue: 'missing' }],
    );
  }
  if (qRaw.length > SEARCH_PHRASE_MAX_LENGTH) {
    throw new HttpError(
      400,
      ERROR_CODES.QUERY_TOO_LONG,
      `Query exceeds the maximum length of ${SEARCH_PHRASE_MAX_LENGTH} characters.`,
      [{ path: 'q', issue: 'phrase too long' }],
    );
  }

  let limit: number | undefined;
  if (limitRaw !== undefined) {
    if (
      !Number.isInteger(limitRaw) ||
      limitRaw <= 0 ||
      limitRaw > SEARCH_SUGGEST_LIMIT_MAX
    ) {
      throw new HttpError(
        400,
        ERROR_CODES.LIMIT_OUT_OF_RANGE,
        `Limit must be an integer between 1 and ${SEARCH_SUGGEST_LIMIT_MAX}.`,
        [{ path: 'limit', issue: 'out of range' }],
      );
    }
    limit = limitRaw;
  }

  // Round-trip through the contract schema so the type system knows the
  // values match the wire shape exactly. The schema mirrors the manual
  // checks above, so this never throws — but it would catch any future
  // drift between the route and the contract.
  SearchSuggestQuerySchema.parse({ q: qRaw, ...(limit !== undefined ? { limit } : {}) });

  return { q: qRaw, ...(limit !== undefined ? { limit } : {}) };
}

function readContext(request: FastifyRequest): {
  salesChannelCode?: string | undefined;
  preferredLanguage?: string | undefined;
} {
  const salesChannelCode = salesChannelHeaderSchema.parse(
    request.headers['x-sales-channel'],
  );
  const acceptLanguage = acceptLanguageHeaderSchema.parse(
    request.headers['accept-language'],
  );
  const preferredLanguage = acceptLanguage
    ? acceptLanguage.split(',')[0]?.trim()
    : undefined;
  return {
    ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
    ...(preferredLanguage !== undefined ? { preferredLanguage } : {}),
  };
}
