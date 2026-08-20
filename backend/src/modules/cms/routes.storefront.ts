import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { StorefrontResolver } from './services/storefront-resolver.js';

/**
 * The request's sales channel, resolved once by the canonical resolver
 * middleware (feature 053 / FR-002). Storefront modules read this instead of
 * re-parsing the `x-sales-channel` header.
 */
function resolvedChannel(request: FastifyRequest): {
  id: string;
  code: string;
  defaultLanguage: string;
} {
  const ch = getResolvedChannel(request);
  return { id: ch.id, code: ch.code, defaultLanguage: ch.defaultLanguage };
}

export async function registerCmsStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: StorefrontResolver },
): Promise<void> {
  app.get('/api/v1/cms/pages/by-slug', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const slug = query['slug'];
    if (!slug) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS page slug.');
    }

    const page = await deps.storefrontResolver.resolvePageBySlug({
      slug,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!page) {
      throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
    }
    return { data: page };
  });

  app.get('/api/v1/cms/blocks/by-code', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const code = query['code'];
    if (!code) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS block code.');
    }

    const block = await deps.storefrontResolver.resolveBlockByCode({
      code,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!block) {
      throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
    }
    return { data: block };
  });

  app.get('/api/v1/cms/hooks/by-code', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const code = query['code'];
    if (!code) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS hook code.');
    }

    const hook = await deps.storefrontResolver.resolveHookByCode({
      code,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!hook) {
      throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
    }
    return { data: hook };
  });
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
