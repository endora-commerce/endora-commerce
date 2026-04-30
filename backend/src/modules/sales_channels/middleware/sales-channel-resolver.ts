import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CachedChannel } from '../services/sales-channels-cache.js';
import type { SalesChannelResolverService } from '../services/sales-channel-resolver.service.js';

/**
 * Sales-channel resolver middleware — feature 005 / T015.
 *
 * Runs as a Fastify `onRequest` hook on every `/api/v1/*` request and
 * decorates `request.salesChannel` with the resolved channel (research
 * R-5).
 *
 * Resolution order:
 *
 *   1. `X-Sales-Channel: <code>` header
 *   2. `?salesChannel=<code>` query parameter — IGNORED on
 *      `/api/v1/admin/*` paths to prevent cross-channel admin bleed.
 *   3. Host-based mapping (env-configured `SALES_CHANNEL_HOST_MAP`).
 *   4. System-default fallback — ONLY on storefront / integration
 *      paths. Admin paths refuse with `MISSING_SALES_CHANNEL_CONTEXT`.
 *
 * If a step matches a code that does not exist or is inactive, the
 * middleware refuses with `UNKNOWN_SALES_CHANNEL` /
 * `INACTIVE_SALES_CHANNEL`. The fallback NEVER applies in those cases
 * (FR-014).
 *
 * Every response carries `X-Sales-Channel: <resolvedCode>` so HTTP
 * caches and dev tools can see the effective channel.
 *
 * Paths that should bypass resolution entirely (e.g. health checks)
 * are excluded by the {@link SHOULD_RESOLVE} predicate so liveness
 * probes do not depend on the channel registry being available.
 */

declare module 'fastify' {
  interface FastifyRequest {
    salesChannel?: CachedChannel;
  }
}

export interface SalesChannelResolverPluginOptions {
  resolver: SalesChannelResolverService;
  /**
   * When true, admin paths refuse with `MISSING_SALES_CHANNEL_CONTEXT`
   * if no signal resolves to a channel (FR-014 spirit). When false
   * (default), admin paths fall back to the system default just like
   * storefront paths so the existing admin UI keeps working until it
   * is updated to send `X-Sales-Channel` (T034+). The US3 resolver
   * contract tests (T046) construct a server with `strictAdmin: true`
   * to exercise the production behaviour.
   */
  strictAdmin?: boolean;
}

const HEADER_NAME = 'x-sales-channel';
const ECHO_HEADER = 'x-sales-channel';
const ADMIN_PATH_PREFIX = '/api/v1/admin/';
const API_PATH_PREFIX = '/api/v1/';
const HEALTH_PATH = '/api/v1/health';

function shouldResolve(path: string): boolean {
  if (!path.startsWith(API_PATH_PREFIX)) return false;
  if (path === HEALTH_PATH || path.startsWith(`${HEALTH_PATH}/`)) return false;
  return true;
}

function isAdminPath(path: string): boolean {
  return path.startsWith(ADMIN_PATH_PREFIX);
}

export async function registerSalesChannelResolverMiddleware(
  app: FastifyInstance,
  options: SalesChannelResolverPluginOptions,
): Promise<void> {
  const { resolver } = options;
  const strictAdmin = options.strictAdmin ?? false;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url ?? '';
    // Strip query string for path-prefix matching.
    const path = url.split('?', 1)[0]!;
    if (!shouldResolve(path)) return;

    const headerValue = request.headers[HEADER_NAME];
    const headerCode = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const queryCode = !isAdminPath(path)
      ? readChannelCodeFromQuery(request.query)
      : undefined;

    const adminPath = isAdminPath(path);

    // Steps 1 + 2 — explicit signals always win, and an unknown / inactive
    // signal always refuses (no silent fallback per FR-014).
    const explicit = headerCode ?? queryCode;
    if (explicit && explicit.trim() !== '') {
      const result = await resolver.resolveActive(explicit);
      if (!result.ok) {
        throw resolverErrorToHttp(result.error, result.code);
      }
      request.salesChannel = result.channel;
      reply.header(ECHO_HEADER, result.channel.code);
      return;
    }

    // Step 3 — host map.
    const hostHeader = request.headers.host;
    const hostBased = resolver.resolveHost(
      Array.isArray(hostHeader) ? hostHeader[0] : hostHeader,
    );
    if (hostBased) {
      const result = await resolver.resolveActive(hostBased);
      if (!result.ok) {
        // If host map points at an unknown / inactive channel, refuse
        // explicitly — this is operator misconfiguration, not a missing
        // signal.
        throw resolverErrorToHttp(result.error, result.code);
      }
      request.salesChannel = result.channel;
      reply.header(ECHO_HEADER, result.channel.code);
      return;
    }

    // Step 4 — fallback. Storefront / integration always; admin only when
    // `strictAdmin` is off (the default during the initial Phase 2 rollout —
    // FR-014's strict refusal is enabled in T046's contract tests).
    if (adminPath && strictAdmin) {
      throw new HttpError(
        400,
        ERROR_CODES.MISSING_SALES_CHANNEL_CONTEXT,
        'Admin requests must specify the sales channel via X-Sales-Channel header.',
      );
    }

    const fallback = await resolver.getSystemDefault();
    if (fallback === null) {
      // The boot-time reconciler should have run; if no Default exists,
      // the platform is in a critical state. Refuse loud and clear.
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Sales channel registry is empty; default-channel reconciler did not run.',
      );
    }
    request.salesChannel = fallback;
    reply.header(ECHO_HEADER, fallback.code);
  });
}

function readChannelCodeFromQuery(query: unknown): string | undefined {
  if (typeof query !== 'object' || query === null) return undefined;
  const v = (query as Record<string, unknown>)['salesChannel'];
  if (typeof v !== 'string') return undefined;
  return v;
}

function resolverErrorToHttp(
  kind: 'unknown_sales_channel' | 'inactive_sales_channel',
  code: string,
): HttpError {
  if (kind === 'unknown_sales_channel') {
    return new HttpError(
      400,
      ERROR_CODES.UNKNOWN_SALES_CHANNEL,
      `Sales channel "${code}" is not registered.`,
    );
  }
  return new HttpError(
    400,
    ERROR_CODES.INACTIVE_SALES_CHANNEL,
    `Sales channel "${code}" is not currently active.`,
  );
}

/** Helper used by route handlers downstream. Throws if not resolved. */
export function getResolvedChannel(request: FastifyRequest): CachedChannel {
  if (!request.salesChannel) {
    throw new HttpError(
      500,
      ERROR_CODES.INTERNAL,
      'Sales channel was not resolved; resolver middleware did not run on this path.',
    );
  }
  return request.salesChannel;
}
