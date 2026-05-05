import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { StorefrontResolver } from './services/storefront-resolver.js';

export async function registerMegamenuStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: StorefrontResolver },
): Promise<void> {
  app.get('/api/v1/megamenu/by-channel', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const language = query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0];
    const salesChannelCode = readHeader(request.headers['x-sales-channel']);

    const resolved = await deps.storefrontResolver.resolveByChannelAndLanguage({
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      ...(language !== undefined ? { language } : {}),
    });
    if (!resolved) {
      throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'No active Megamenu for the requested scope.');
    }
    return { data: resolved };
  });
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
