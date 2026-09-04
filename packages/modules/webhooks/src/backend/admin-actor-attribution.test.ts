import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  registerWebhooksAdminRoutes,
  type WebhooksAdminDeps,
} from './routes.js';
import type { Webhook } from './entities/webhook.entity.js';
import type { WebhookService } from './services/webhook-service.js';

/**
 * Feature 080, T051 — who created a webhook is read from the **production**
 * actor, not from the test harness's decoration.
 *
 * The twin of `test/unit/api_keys/admin-actor-attribution.test.ts`; the reason
 * is written out in full there. `POST /api/v1/admin/webhooks` read
 * `testAdminUserId(request)`, which answers from `request.testActor` — a field
 * only `test/helpers/test-actors.ts` writes — so `createdByAdminUserId` was
 * null on every webhook a production operator ever created.
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';

const CREATED = {
  id: '11111111-0000-4000-8000-000000000002',
  name: 'order-sink',
  url: 'https://example.test/hook',
  eventTypes: ['order.created.v1'],
  status: 'active',
  secret: 'whsec_x',
  organizationId: null,
  createdAt: new Date('2026-08-24T10:00:00.000Z'),
  updatedAt: new Date('2026-08-24T10:00:00.000Z'),
} as unknown as Webhook;

describe('POST /api/v1/admin/webhooks — the acting admin', () => {
  let app: FastifyInstance;
  let created: { createdByAdminUserId?: string } | null = null;

  beforeEach(async () => {
    created = null;
    const webhookService = {
      create: async (input: { createdByAdminUserId?: string }) => {
        created = input;
        return CREATED;
      },
    } as unknown as WebhookService;

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // The production request shape: the auth plugin decorates `request.actor`
    // and nothing decorates `request.testActor`.
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as unknown as { actor: { kind: string; adminUserId: string } }).actor = {
        kind: 'admin',
        adminUserId: ADMIN_ID,
      };
    });
    const deps: WebhooksAdminDeps = {
      webhookService,
      requireAdmin: () => async () => {},
      resolveAdminUserId: (request) =>
        (request as unknown as { actor: { adminUserId: string } }).actor.adminUserId,
    };
    await registerWebhooksAdminRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('attributes the webhook to the admin on `request.actor`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks',
      payload: {
        name: 'order-sink',
        url: 'https://example.test/hook',
        eventTypes: ['order.created.v1'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(created).not.toBeNull();
    expect(created?.createdByAdminUserId).toBe(ADMIN_ID);
  });
});
