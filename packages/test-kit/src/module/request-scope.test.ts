/**
 * `@endora-commerce/test-kit/module`'s request-scope helpers (issue #1072).
 *
 * A module whose subject is which tenant scope a request runs in — `auth`'s
 * route-actor proof is the one that exists — mounts the platform's real
 * per-request scope hook on its own Fastify app and maps actors to contexts
 * the way a composition root does. These are the published spelling of that:
 * `installRequestScope`, `tenantFor` and `systemTenant`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { installRequestScope, systemTenant, tenantFor } from './index.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const REACH = '00000000-0000-4000-8000-0000000000bb';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

describe('tenantFor', () => {
  it('derives a customer\'s single-organization scope', () => {
    const tenant = tenantFor({ kind: 'customer', customerAccountId: 'c-1', organizationId: ORG });

    expect(tenant.mode).toBe('single-org');
    expect(tenant.organizationId).toBe(ORG);
    expect(tenant.actor).toEqual({ kind: 'customer', id: 'c-1' });
  });

  it('derives an admin\'s scope from the reach it is given', () => {
    const tenant = tenantFor(
      { kind: 'admin', adminUserId: 'a-1' },
      { allowAll: false, allowedOrganizationIds: [REACH] },
    );

    expect(tenant.mode).toBe('allowed-set');
    expect(tenant.allowedOrganizationIds).toEqual([REACH]);
    expect(tenant.actor.kind).toBe('admin');
  });
});

describe('systemTenant', () => {
  it('is the system scope, carrying the reason it was given', () => {
    expect(systemTenant('actor:anonymous')).toEqual({
      mode: 'system',
      actor: { kind: 'system' },
      reason: 'actor:anonymous',
    });
  });

  it('names a reason when the test has none to give', () => {
    const tenant = systemTenant();

    expect(tenant.mode).toBe('system');
    expect(tenant.reason).toEqual(expect.any(String));
  });
});

describe('installRequestScope', () => {
  it('runs every request\'s handler inside the context the mapping derives for it', async () => {
    const app = Fastify();
    apps.push(app);
    await installRequestScope(app, {
      buildTenantContext: async (request) =>
        request.headers['x-org']
          ? tenantFor({
              kind: 'customer',
              customerAccountId: 'c-1',
              organizationId: String(request.headers['x-org']),
            })
          : systemTenant('test:anonymous'),
    });
    app.get('/probe', async () => {
      const tenant = getTenantContext();
      return { mode: tenant?.mode ?? null, organizationId: tenant?.organizationId ?? null };
    });
    await app.ready();

    const scoped = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-org': ORG } });
    const anonymous = await app.inject({ method: 'GET', url: '/probe' });

    expect(scoped.json()).toEqual({ mode: 'single-org', organizationId: ORG });
    expect(anonymous.json()).toEqual({ mode: 'system', organizationId: null });
  });

  it('fails the request when the mapping rejects, rather than running it unscoped', async () => {
    const app = Fastify();
    apps.push(app);
    await installRequestScope(app, {
      buildTenantContext: async () => {
        throw new Error('no scope for this actor');
      },
    });
    let ran = false;
    app.get('/probe', async () => {
      ran = true;
      return {};
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/probe' });

    expect(response.statusCode).toBe(500);
    expect(ran).toBe(false);
  });
});
