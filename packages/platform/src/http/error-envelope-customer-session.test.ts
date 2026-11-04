import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  CustomerSessionRequiredError,
  ERROR_CODES,
  organizationPermissionPreHandler,
  type Actor,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import { registerErrorEnvelope } from './error-envelope.js';

/**
 * `specs/170-organization-roles/` WP-01 — the organization-permission guard is a
 * plain function in `@endora-commerce/contracts`, which cannot construct this
 * package's `HttpError`. Its refusal of a request with no customer is
 * `CustomerSessionRequiredError`, and the envelope answers it exactly as it
 * answers `requireCustomer`: `401 UNAUTHORIZED`, silent, never the logged
 * `500 INTERNAL` an unrecognised `statusCode` gets.
 */
describe('the error envelope answers the permission guard’s missing-customer refusal', () => {
  const port: OrganizationPermissionPort = {
    can: async () => true,
    assert: async () => undefined,
    isAdministrator: async () => false,
    effective: async () => ({ role: { id: 'r', kind: 'member' }, permissions: [] }),
    rolesHolding: async () => [],
  };

  function buildProbe() {
    const app = Fastify();
    registerErrorEnvelope(app);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { actor: Actor }).actor = { kind: 'anonymous' };
    });
    const guard = organizationPermissionPreHandler(() => port, 'carts.create');
    app.get('/guarded', {
      preHandler: async (request) => guard(request as unknown as { actor: Actor }),
    }, async () => ({ ok: true }));
    app.get('/thrown', async () => {
      throw new CustomerSessionRequiredError();
    });
    return app;
  }

  it.each(['/guarded', '/thrown'])('answers 401 UNAUTHORIZED on %s', async (url) => {
    const res = await buildProbe().inject({ method: 'GET', url });
    expect(res.statusCode).toBe(401);
    const { error } = res.json() as { error: { code: string; message: string; requestId?: string } };
    expect(error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(error.message).toBe('Customer session required.');
  });
});
