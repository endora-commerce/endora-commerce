// `config: { rateLimit }` is not on `FastifyContextConfig`: it is a
// declaration-merging augmentation `@fastify/rate-limit` contributes. Inside
// `backend/src` that augmentation arrived ambiently, through the host's own
// dependency and its `types` graph — so nothing in this module ever named it.
// A package compiles against its own manifest, where an unnamed dependency does
// not exist, and the excess property is a TS2353 on the route options object
// rather than the TS2339 the cookie augmentation produces. The import is
// type-only, so it loads the declarations and emits nothing: registering the
// plugin stays the host's job, exactly as before.
import type {} from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { FeedArtefact } from './entities/feed-artefact.entity.js';
import { ProductFeed } from './entities/product-feed.entity.js';
import type { ArtefactStorageBackend, ArtefactStorePort } from './services/artefact-store.js';
import type { CachedFeedArtefact, FeedTokenCache } from './services/feed-cache-invalidator.js';
import {
  hashFeedToken,
  isFeedPubliclyServable,
  isFeedTokenShape,
  tokenHashMatches,
} from './services/feed-token.service.js';
import { extensionFor } from './routes.admin.js';

/**
 * The module's only internet-facing route — feature 067
 * (contracts/public-feed-endpoint.md):
 *
 *   GET /api/v1/public/product-feeds/:token
 *
 * Its consumer is Google Merchant Center's fetcher, not the admin's API
 * client, so it looks unlike every other route here and each difference is
 * deliberate:
 *
 *  - **No JSON envelope.** The body IS the feed file. The one sanctioned
 *    exception to the `dataEnvelope` convention in this module.
 *  - **No authentication.** Providers fetch anonymously on their own schedule;
 *    authorization is the token in the path.
 *  - **No guard bypass.** The anonymous request already carries the ambient
 *    `systemTenantContext('actor:anonymous')` established globally in
 *    `composition.ts`, and both entities it touches are `@GlobalEntity`. There
 *    is therefore **no `withSystemScope` call in this file**, and adding one
 *    would suggest the Principle XI guard was being worked around. A contract
 *    test asserts on this file's source.
 *  - **One `404` for five different causes** (FR-049). No field, status, header
 *    or body length may distinguish "wrong token" from "no such feed", or the
 *    endpoint becomes an existence oracle.
 *  - **`Cache-Control: private`** is not optional: the payload is per-token and
 *    price-bearing, so a shared or CDN cache holding it would be a leak.
 *  - **The handler returns the stream.** `inject()` masks a missing return;
 *    over a real socket it crash-loops with `ERR_HTTP_HEADERS_SENT`.
 */

/** The single not-available body. Serialized once so it cannot drift. */
const NOT_AVAILABLE_BODY = JSON.stringify({
  error: { code: 'not_found', message: 'Feed not available.' },
});

export interface ProductFeedsPublicRoutesDeps {
  emFactory: () => EntityManager;
  artefactStore: ArtefactStorePort;
  tokenCache: FeedTokenCache;
  /** Requests per minute for a valid token; a miss gets a stricter IP-keyed limit. */
  hitRateLimitPerMinute: () => Promise<number>;
}

function notAvailable(reply: FastifyReply): FastifyReply {
  return reply
    .status(404)
    .header('Content-Type', 'application/json; charset=utf-8')
    .header('Cache-Control', 'private, no-store')
    .send(NOT_AVAILABLE_BODY);
}

export async function registerProductFeedsPublicRoutes(
  app: FastifyInstance,
  deps: ProductFeedsPublicRoutesDeps,
): Promise<void> {
  // Per-route rate limiting (FR-050) on top of the global ceiling already
  // registered in `http/server.ts`. Two ceilings, because a legitimate provider
  // polls a handful of times an hour with a valid token while a scanner
  // produces a stream of misses: the key is the token for a well-shaped
  // request and the client IP otherwise, so one scanner cannot consume a real
  // provider's budget.
  const rateLimit = {
    max: async (request: { params?: unknown }): Promise<number> => {
      const token = (request.params as { token?: string } | undefined)?.token ?? '';
      if (!isFeedTokenShape(token)) return 10;
      return deps.hitRateLimitPerMinute();
    },
    timeWindow: '1 minute',
    keyGenerator: (request: { params?: unknown; ip: string }): string => {
      const token = (request.params as { token?: string } | undefined)?.token ?? '';
      return isFeedTokenShape(token) ? `feed:${hashFeedToken(token)}` : `ip:${request.ip}`;
    },
  };

  app.get<{ Params: { token: string } }>(
    '/api/v1/public/product-feeds/:token',
    { config: { rateLimit } },
    async (request, reply) => {
      const token = request.params.token;

      // Cheap rejection of scanners, before any database work. The shape check
      // leaks nothing: it is a property of the request, not of our data.
      if (!isFeedTokenShape(token)) return notAvailable(reply);

      const tokenHash = hashFeedToken(token);
      const cached = await deps.tokenCache.get(tokenHash);
      const resolved = cached ?? (await resolveFromDatabase(deps, tokenHash));
      if (!resolved) return notAvailable(reply);
      if (!cached) await deps.tokenCache.set(tokenHash, resolved);

      const producedAt = new Date(resolved.producedAtIso);
      const etag = resolved.checksumSha256 ? `"${resolved.checksumSha256}"` : undefined;

      // Conditional requests (FR-048): a provider polling every 15 minutes
      // against a feed regenerated every 4 hours costs one indexed read and
      // never opens the object.
      const ifNoneMatch = request.headers['if-none-match'];
      const ifModifiedSince = request.headers['if-modified-since'];
      const notModified =
        (etag && typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((v) => v.trim() === etag)) ||
        (typeof ifModifiedSince === 'string' &&
          !Number.isNaN(Date.parse(ifModifiedSince)) &&
          Math.floor(producedAt.getTime() / 1000) <=
            Math.floor(Date.parse(ifModifiedSince) / 1000));

      reply
        .header('Cache-Control', 'private, max-age=0, must-revalidate')
        .header('Last-Modified', producedAt.toUTCString());
      if (etag) reply.header('ETag', etag);

      if (notModified) return reply.status(304).send();

      const stream = await deps.artefactStore
        .open({
          backend: resolved.storageBackend as ArtefactStorageBackend,
          locator: resolved.storageLocator,
        })
        .catch(() => null);
      // A missing object is indistinguishable from a missing feed — the
      // provider must not learn that the row exists but the file is gone.
      if (!stream) return notAvailable(reply);

      reply
        .header('Content-Type', resolved.contentType)
        .header('Content-Length', String(resolved.byteSize))
        .header(
          'Content-Disposition',
          `inline; filename="${resolved.slug}.${extensionFor(resolved.contentType)}"`,
        );
      return reply.send(stream);
    },
  );
}

/**
 * The two indexed reads. Returns null for every not-serving condition, which
 * the caller turns into the one identical response.
 */
async function resolveFromDatabase(
  deps: ProductFeedsPublicRoutesDeps,
  tokenHash: string,
): Promise<CachedFeedArtefact | null> {
  const em = deps.emFactory();
  const feed = await em.findOne(ProductFeed, { tokenHash });
  if (!feed) return null;
  // Constant-time compare of the stored hash: the lookup above already matched,
  // but comparing here keeps the code honest if the lookup ever widens.
  if (!tokenHashMatches(tokenHash, feed.tokenHash ?? null)) return null;
  if (!isFeedPubliclyServable(feed)) return null;

  const artefact = await em.findOne(FeedArtefact, { id: String(feed.publishedArtefactId) });
  if (!artefact) return null;

  return {
    feedId: feed.id,
    slug: feed.slug,
    artefactId: artefact.id,
    storageBackend: artefact.storageBackend,
    storageLocator: artefact.storageLocator,
    contentType: artefact.contentType,
    byteSize: Number(artefact.byteSize),
    checksumSha256: artefact.checksumSha256 ?? null,
    producedAtIso: artefact.producedAt.toISOString(),
  };
}
