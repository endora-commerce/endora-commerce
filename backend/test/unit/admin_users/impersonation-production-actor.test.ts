import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  registerImpersonationRoutes,
  type ImpersonationDeps,
} from '../../../src/modules/admin_users/routes.impersonation.js';
import type { ImpersonationService } from '../../../src/modules/admin_users/services/impersonation-service.js';

/**
 * Feature 080, T051 — impersonation identifies the acting admin from the
 * **production** actor.
 *
 * `POST /api/v1/admin/organizations/:id/impersonate` resolved the admin by
 * reading `request.testActor` and answered `401 Admin session required` when it
 * was absent. Nothing under `src/` ever writes that field —
 * `test/helpers/test-actors.ts` is its only author — so the route answered 401
 * to every production request that reached it, whatever session the operator
 * held. The `requireAdmin('customers:impersonate')` guard in front of it was
 * already doing the real gating; the inline check was a second, broken copy.
 *
 * The test builds its own request shape for the reason its `api_keys` sibling
 * does: an actor on `request.actor` and **no** `testActor` is exactly the
 * production request, and it is the one shape the old read could not see.
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';
const ORG_ID = '00000000-0000-4000-8000-0000000000aa';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a1';

describe('POST /api/v1/admin/organizations/:id/impersonate — the acting admin', () => {
  let app: FastifyInstance;
  let started: { adminUserId: string } | null = null;

  beforeEach(async () => {
    started = null;
    const impersonationService = {
      start: async (input: { adminUserId: string }) => {
        started = input;
        return {
          impersonationSessionId: 'imp-1',
          impersonationCookieValue: 'imp-1.raw',
          impersonationExpiresAt: new Date('2026-08-24T12:00:00.000Z'),
          adminShadowSessionCookieValue: 'admin-1.raw',
          impersonatedCustomerAccount: {
            id: CUSTOMER_ID,
            email: 'buyer@example.test',
            firstName: 'Buyer',
            lastName: 'One',
            role: 'buyer',
          },
        };
      },
    } as unknown as ImpersonationService;

    app = Fastify();
    await app.register(cookie);
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
    const deps: ImpersonationDeps = {
      impersonationService,
      requireAdmin: () => async () => {},
      resolveAdminUserId: (request) =>
        (request as unknown as { actor: { adminUserId: string } }).actor.adminUserId,
    };
    await registerImpersonationRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts impersonation for the admin on `request.actor`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${ORG_ID}/impersonate`,
      payload: { customerAccountId: CUSTOMER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(started).not.toBeNull();
    expect(started?.adminUserId).toBe(ADMIN_ID);
  });
});
