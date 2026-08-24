import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  registerApiKeysAdminRoutes,
  type ApiKeysAdminDeps,
} from '../../../src/modules/api_keys/routes.js';
import type { ApiKey } from '../../../src/modules/api_keys/entities/api-key.entity.js';
import type { ApiKeyService } from '../../../src/modules/api_keys/services/api-key-service.js';

/**
 * Feature 080, T051 — who created an API key is read from the **production**
 * actor, not from the test harness's decoration.
 *
 * `POST /api/v1/admin/api-keys` recorded `createdByAdminUserId` from
 * `testAdminUserId(request)`, which reads `request.testActor` — a field only
 * `test/helpers/test-actors.ts` ever writes. Nothing under `src/` sets it, so
 * in production the column was silently left null on every key ever created,
 * and every harness test passed because `registerTestAuth` mirrors its actor
 * onto both fields.
 *
 * That is why this test builds its own request shape rather than going through
 * the harness: an actor on `request.actor` and **no** `testActor` is exactly
 * the production request, and it is the one shape the old read cannot see.
 *
 * The reach that made it visible is the packaging one —
 * `contracts/host-package.md` §1.4j classifies `http/test-actor-carrier` **A**,
 * an installed package having no relationship to this repository's harness —
 * but the defect underneath it is a product defect and is what this asserts.
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';

const CREATED = {
  id: '11111111-0000-4000-8000-000000000001',
  name: 'integration',
  lastFour: 'abcd',
  scopes: ['catalog:read'],
  status: 'active',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date('2026-08-24T10:00:00.000Z'),
  updatedAt: new Date('2026-08-24T10:00:00.000Z'),
  organizationId: null,
  salesChannelId: null,
  customerAccountId: null,
  expiresAt: null,
} as unknown as ApiKey;

describe('POST /api/v1/admin/api-keys — the acting admin', () => {
  let app: FastifyInstance;
  let created: { createdByAdminUserId?: string } | null = null;

  beforeEach(async () => {
    created = null;
    const apiKeyService = {
      create: async (input: { createdByAdminUserId?: string }) => {
        created = input;
        return { apiKey: CREATED, bearerToken: 'sk_live_x' };
      },
    } as unknown as ApiKeyService;

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
    const deps: ApiKeysAdminDeps = {
      apiKeyService,
      requireAdmin: () => async () => {},
      resolveAdminUserId: (request) =>
        (request as unknown as { actor: { adminUserId: string } }).actor.adminUserId,
    };
    await registerApiKeysAdminRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('attributes the key to the admin on `request.actor`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'integration', scopes: ['catalog:read'] },
    });

    expect(res.statusCode).toBe(201);
    expect(created).not.toBeNull();
    expect(created?.createdByAdminUserId).toBe(ADMIN_ID);
  });
});
