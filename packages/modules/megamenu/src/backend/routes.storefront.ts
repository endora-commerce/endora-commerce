import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES, requestScopeLanguage, type ResolvedMegamenu } from '@endora-commerce/contracts';
import { HttpError, productAudienceOf } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { filterForViewer, needsCustomerGroup } from './services/audience.js';
import { resolveMenuViewer, type MegamenuCrossModulePorts } from './services/cross-module-ports.js';
import type { StorefrontResolver } from './services/storefront-resolver.js';

export async function registerMegamenuStorefrontRoutes(
  app: FastifyInstance,
  deps: {
    storefrontResolver: StorefrontResolver;
    ports: Pick<MegamenuCrossModulePorts, 'customerAccounts' | 'organizations'>;
  },
): Promise<void> {
  app.get('/api/v1/megamenu/by-channel', async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    // Issue #1011 — without `?language=`, the channel language `Accept-Language` asks for:
    // q-weighted, matched exactly then by base language (`pl` is the channel's `pl-PL`),
    // else the channel's default (as the catalogue resolves it since #397).
    const header = readHeader(request.headers['accept-language']);
    const language = query['language'] ?? (header ? requestScopeLanguage(getResolvedChannel(request), header) : undefined);

    const resolved = await deps.storefrontResolver.resolveByChannelAndLanguage({
      resolvedChannel: resolvedChannel(request),
      ...(language !== undefined ? { language } : {}),
    });
    if (!resolved) {
      throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'No active Megamenu for the requested scope.');
    }

    // Feature 168 (FR-018, FR-019): the cached tree holds every audience's
    // items; this visitor gets theirs and no trace of the rest. The audience
    // comes off the server-resolved actor (Principle XI).
    const audience = productAudienceOf(request);
    const viewer = await resolveMenuViewer(deps.ports, audience, needsCustomerGroup(resolved.items));
    if (audience.authenticated) {
      // An identified caller's menu may differ from the public one, so it must
      // not enter a shared cache — `markPersonalisedPricing`'s reasoning, and
      // its header. The anonymous answer stays as cacheable as it was.
      reply.header('cache-control', 'private, no-store');
    }
    const data: ResolvedMegamenu = { ...resolved, items: filterForViewer(resolved.items, viewer) };
    return { data };
  });
}

/** Reads the request's already-resolved sales channel (set by the resolver middleware). */
function resolvedChannel(request: FastifyRequest): { id: string; code: string; defaultLanguage: string } {
  const ch = getResolvedChannel(request);
  return { id: ch.id, code: ch.code, defaultLanguage: ch.defaultLanguage };
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
