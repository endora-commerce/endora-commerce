import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { StorefrontResolver } from './services/storefront-resolver.js';

export async function registerMegamenuStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: StorefrontResolver },
): Promise<void> {
  app.get('/api/v1/megamenu/by-channel', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const language = query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0];

    const resolved = await deps.storefrontResolver.resolveByChannelAndLanguage({
      resolvedChannel: resolvedChannel(request),
      ...(language !== undefined ? { language } : {}),
    });
    if (!resolved) {
      throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'No active Megamenu for the requested scope.');
    }
    return { data: resolved };
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
