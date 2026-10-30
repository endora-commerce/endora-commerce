import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { ANALYTICS_INGEST_RATE_LIMIT, registerAnalyticsRoutes } from './routes.js';
import type { AnalyticsIngestService } from './services/analytics-ingest.service.js';
import type { AnalyticsQueryService } from './services/analytics-query.service.js';

/**
 * `POST /api/v1/analytics/events` — the public ingest door. Identity comes from
 * `request.actor`, the channel from the resolved request channel, and the route
 * carries its own per-client rate limit.
 */
const CUSTOMER = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';
const CHANNEL = '66666666-6666-4666-8666-666666666666';
const BODY_ID = '11111111-1111-4111-8111-111111111111';

type IngestInput = Parameters<AnalyticsIngestService['ingest']>[0];

let app: FastifyInstance | null = null;

async function appWith(actor: Actor, calls: IngestInput[]): Promise<FastifyInstance> {
  const instance = Fastify();
  instance.setValidatorCompiler(validatorCompiler);
  await instance.register(rateLimit, { global: false });
  instance.decorateRequest('actor', null as never);
  instance.addHook('onRequest', async (request) => {
    request.actor = actor;
  });
  await registerAnalyticsRoutes(instance, {
    ingestService: {
      ingest: async (input: IngestInput) => {
        calls.push(input);
        return { accepted: input.events.length, rejected: [] };
      },
    } as unknown as AnalyticsIngestService,
    queryService: {} as AnalyticsQueryService,
    requireAdmin: (() => async () => undefined) as unknown as RequireAdminFactory,
    resolveChannelId: () => CHANNEL,
  });
  app = instance;
  return instance;
}

const payload = {
  events: [
    {
      type: 'product.viewed',
      customerAccountId: BODY_ID,
      organizationId: BODY_ID,
      salesChannelId: BODY_ID,
    },
  ],
};

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('POST /api/v1/analytics/events', () => {
  it('accepts body identity fields but ingests with no identity for an anonymous caller', async () => {
    const calls: IngestInput[] = [];
    const server = await appWith({ kind: 'anonymous' }, calls);
    const res = await server.inject({ method: 'POST', url: '/api/v1/analytics/events', payload });
    expect(res.statusCode).toBe(202);
    expect(calls[0]!.context).toEqual({
      salesChannelId: CHANNEL,
      customerAccountId: null,
      organizationId: null,
    });
  });

  it('ingests with the signed-in customer and their organization', async () => {
    const calls: IngestInput[] = [];
    const server = await appWith(
      { kind: 'customer', customerAccountId: CUSTOMER, organizationId: ORG } as Actor,
      calls,
    );
    const res = await server.inject({ method: 'POST', url: '/api/v1/analytics/events', payload });
    expect(res.statusCode).toBe(202);
    expect(calls[0]!.context).toEqual({
      salesChannelId: CHANNEL,
      customerAccountId: CUSTOMER,
      organizationId: ORG,
    });
  });

  it('records no organization for a customer session that carries none', async () => {
    const calls: IngestInput[] = [];
    const server = await appWith(
      { kind: 'customer', customerAccountId: CUSTOMER, organizationId: '' } as Actor,
      calls,
    );
    await server.inject({ method: 'POST', url: '/api/v1/analytics/events', payload });
    expect(calls[0]!.context.organizationId).toBeNull();
  });

  it('refuses a client that exceeds the per-route ceiling with 429', async () => {
    const server = await appWith({ kind: 'anonymous' }, []);
    const max = ANALYTICS_INGEST_RATE_LIMIT.max;
    for (let i = 0; i < max; i += 1) {
      const ok = await server.inject({ method: 'POST', url: '/api/v1/analytics/events', payload });
      expect(ok.statusCode).toBe(202);
    }
    const refused = await server.inject({ method: 'POST', url: '/api/v1/analytics/events', payload });
    expect(refused.statusCode).toBe(429);
  });
});
