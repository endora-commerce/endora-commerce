import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dictionaryEntryTypeSchema } from '@endora-commerce/contracts';
import type { DictionaryReadService } from './services/dictionary-read-service.js';

export interface DictionaryStorefrontRoutesDeps {
  readService: DictionaryReadService;
}

const registryQuerySchema = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).optional(),
  channel: z.string().trim().min(1).max(32).optional(),
});

const byCodeQuerySchema = z.object({
  type: dictionaryEntryTypeSchema,
  code: z.string().trim().min(1).max(12),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).optional(),
});

const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';

export async function registerDictionaryStorefrontRoutes(
  app: FastifyInstance,
  deps: DictionaryStorefrontRoutesDeps,
): Promise<void> {
  app.get('/api/v1/dictionary', async (request, reply) => {
    const query = registryQuerySchema.parse(request.query);
    const payload = await deps.readService.getRegistry({
      ...(query.locale !== undefined ? { locale: query.locale } : {}),
      ...(query.channel !== undefined ? { channelCode: query.channel } : {}),
    });
    reply.header('Cache-Control', CACHE_CONTROL);
    return payload;
  });

  app.get('/api/v1/dictionary/by-code', async (request, reply) => {
    const query = byCodeQuerySchema.parse(request.query);
    const payload = await deps.readService.getByCode({
      entryType: query.type,
      entryCode: query.code,
      ...(query.locale !== undefined ? { locale: query.locale } : {}),
    });
    reply.header('Cache-Control', CACHE_CONTROL);
    return payload;
  });
}

