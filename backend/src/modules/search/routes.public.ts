import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ERROR_CODES,
  RecordPhraseRequestSchema,
  SearchSuggestQuerySchema,
  SEARCH_PHRASE_MAX_LENGTH,
  SEARCH_SUGGEST_LIMIT_MAX,
  type RecordPhraseResponse,
  type SearchSuggestResponse,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import {
  QueryTooShort,
  SearchBackendUnavailable,
  type SearchSuggestService,
} from './services/search-suggest.service.js';
import type { SearchPhraseRecorder } from './services/search-phrase-recorder.service.js';

/**
 * Public HTTP surface — feature 006 / US1 (T013) and US3 (T036).
 *
 * Routes mounted under `/api/v1/search/*`:
 *   - GET  /suggest  — typeahead popup feed.
 *   - POST /record   — analytics ingest. Returns 202 immediately;
 *                      persistence is queued via the recorder service
 *                      so the storefront response is never delayed
 *                      (FR-015).
 *
 * Sales-channel scoping mirrors the catalog public routes: the channel
 * is resolved from `request.salesChannel` (set by the resolver
 * middleware) with a header fallback for the contract-level read in
 * `readContext`.
 */

const salesChannelHeaderSchema = z.string().optional();
const acceptLanguageHeaderSchema = z.string().optional();

export interface SearchPublicDeps {
  suggestService: SearchSuggestService;
  /** When provided, `POST /api/v1/search/record` is mounted (US3). */
  phraseRecorder?: SearchPhraseRecorder;
}

export async function registerSearchPublicRoutes(
  app: FastifyInstance,
  deps: SearchPublicDeps,
): Promise<void> {
  const { suggestService, phraseRecorder } = deps;

  // POST /api/v1/search/record — feature 006 / US3 / T036.
  // Mounted only when a recorder was wired (search/plugin.ts gates
  // this on `settingsService` being provided so the recorder can read
  // the per-channel minimum-length threshold).
  if (phraseRecorder) {
    app.post('/api/v1/search/record', async (request, reply) => {
      const parseResult = RecordPhraseRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        // The two negative paths the contract calls out
        // (PHRASE_REQUIRED, PHRASE_TOO_LONG) are derived from the Zod
        // issue codes so the wire surface is stable.
        const issue = parseResult.error.issues[0];
        const code =
          issue?.path[0] === 'phrase' && issue?.code === 'too_big'
            ? ERROR_CODES.PHRASE_TOO_LONG
            : issue?.path[0] === 'resultCount'
              ? ERROR_CODES.RESULT_COUNT_INVALID
              : ERROR_CODES.PHRASE_REQUIRED;
        throw new HttpError(
          400,
          code,
          issue?.message ?? 'Invalid record phrase request.',
          parseResult.error.issues.map((i) => ({
            path: i.path.join('.') || '(root)',
            issue: i.message,
          })),
        );
      }

      // The resolver middleware (sales_channels module) attaches
      // `request.salesChannel`. Storefront paths fall back to the
      // system-default channel; admin paths refuse with
      // MISSING_SALES_CHANNEL_CONTEXT before reaching this handler.
      const salesChannelId = request.salesChannel?.id;
      if (!salesChannelId) {
        throw new HttpError(
          400,
          ERROR_CODES.MISSING_SALES_CHANNEL_CONTEXT,
          'No sales channel could be resolved for this request.',
        );
      }

      // Fire-and-forget: the recorder swallows its own errors and the
      // storefront response is not delayed by persistence (FR-015).
      void phraseRecorder.record({
        phrase: parseResult.data.phrase,
        salesChannelId,
        resultCount: parseResult.data.resultCount ?? 0,
      });

      return reply.code(202).send({ ok: true } satisfies RecordPhraseResponse);
    });
  }

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
