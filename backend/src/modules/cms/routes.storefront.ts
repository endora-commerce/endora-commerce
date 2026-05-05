import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { StorefrontResolver } from './services/storefront-resolver.js';

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
      salesChannelCode: readHeader(request.headers['x-sales-channel']),
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
      salesChannelCode: readHeader(request.headers['x-sales-channel']),
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
      salesChannelCode: readHeader(request.headers['x-sales-channel']),
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
