import type { FastifyRequest } from 'fastify';
import { requestScopeLanguage } from '@endora-commerce/contracts';
import { productAudienceOf } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { ComparisonViewer } from './services/comparison-service.js';

/**
 * Feature 163 — the reader as a comparison view takes it: the session's
 * audience and the request's language tag, which the scope language L of the
 * column's availability is resolved from. One definition for the owner routes
 * and the share route (final code review C-n1), so they cannot answer the same
 * reader differently.
 */
export function buyerViewerOf(request: FastifyRequest): ComparisonViewer {
  const tag = languageTagOf(request);
  return {
    kind: 'buyer',
    audience: productAudienceOf(request),
    ...(tag ? { languageTag: tag } : {}),
  };
}

/**
 * The channel language the request's `Accept-Language` asks for, or `undefined` without the
 * header (the service then reads in the channel's default, as before).
 *
 * Issue #1011 — `requestScopeLanguage` over the whole header, as the catalogue resolves it since
 * #397: the tags in descending `q`, each matched against the resolved channel's languages
 * (exactly, then by base language), the first one the channel offers winning, else the
 * channel's default. This used to be the header's first tag alone, so `en;q=0.2, pl-PL;q=0.9`
 * read English and `de-DE, pl;q=0.5` the default.
 */
export function languageTagOf(request: FastifyRequest): string | undefined {
  const header = request.headers['accept-language'];
  if (header === undefined || header.length === 0) return undefined;
  return requestScopeLanguage(getResolvedChannel(request), header);
}
