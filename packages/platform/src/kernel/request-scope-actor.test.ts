import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Actor, AdminTenantScope } from '@endora-commerce/contracts';
import { actorFromContext } from '../commands/actor.js';
import { withSystemScope } from '../tenancy/escape-hatch.js';
import { getTenantContext, type TenantContext } from '../tenancy/tenant-context.js';
import { actorTenantContext, refusingWiderScopeThanTheActorMayHold } from './actor-tenant-context.js';
import { registerRequestScopeHook, scopeRequestToActor } from './request-scope-hook.js';
import { getCurrentPlatformScope } from './scope.js';

/**
 * The request is scoped to the actor its route's gate accepted (Principle XI).
 *
 * The scope hook opens a request's tenant context in `onRequest`, from the
 * ambient actor. A gate runs later and may put a different actor on the
 * request — `auth`'s admin guard promotes the admin session of a browser that
 * also holds a customer one. What is held here is the platform's half of that:
 * once a gate says so, everything that reads the ambient context reads the one
 * the accepted actor maps to, and nothing else can move it.
 *
 * The stand-in gates below do what `auth`'s do — put an actor on the request
 * and call `scopeRequestToActor` — because the subject is the seam, not how a
 * session is resolved. `auth`'s own test holds the selection rule over real
 * cookies.
 */

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

const customer = {
  kind: 'customer',
  customerAccountId: 'customer-1',
  organizationId: ORG_A,
  impersonatorAdminUserId: null,
} as unknown as Actor;
const impersonated = {
  kind: 'customer',
  customerAccountId: 'customer-1',
  organizationId: ORG_A,
  impersonatorAdminUserId: 'admin-1',
} as unknown as Actor;
const admin = { kind: 'admin', adminUserId: 'admin-1' } as unknown as Actor;

interface Carrier {
  actor: Actor;
  adminActor: Actor | null;
}

interface Report {
  readonly actorKind: string;
  readonly tenant: TenantContext;
  readonly scopeTenantMode: string | undefined;
  readonly commandActor: ReturnType<typeof actorFromContext>;
}

function report(request: FastifyRequest): Report {
  const tenant = getTenantContext() as TenantContext;
  return {
    actorKind: (request as unknown as Carrier).actor.kind,
    tenant,
    scopeTenantMode: getCurrentPlatformScope()?.tenant.mode,
    commandActor: actorFromContext(tenant),
  };
}

/** What `auth`'s admin guard does, without the session table behind it. */
async function adminGate(request: FastifyRequest): Promise<void> {
  const carrier = request as unknown as Carrier;
  if (carrier.actor.kind !== 'admin' && carrier.adminActor) carrier.actor = carrier.adminActor;
  if (carrier.actor.kind !== 'admin') throw Object.assign(new Error('admin'), { statusCode: 401 });
  await scopeRequestToActor(request);
}

async function customerGate(request: FastifyRequest): Promise<void> {
  if ((request as unknown as Carrier).actor.kind !== 'customer') {
    throw Object.assign(new Error('customer'), { statusCode: 401 });
  }
  await scopeRequestToActor(request);
}

interface AppOptions {
  readonly adminScope?: (adminUserId: string) => Promise<AdminTenantScope>;
  readonly withScopeHook?: boolean;
}

async function appWith(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('actor', null as never);
  app.decorateRequest('adminActor', null as never);
  app.addHook('onRequest', async (request) => {
    const carrier = request as unknown as Carrier;
    const ambient = request.headers['x-ambient'];
    const candidate = request.headers['x-admin-candidate'];
    carrier.actor =
      typeof ambient === 'string' ? (JSON.parse(ambient) as Actor) : ({ kind: 'anonymous' } as Actor);
    carrier.adminActor = typeof candidate === 'string' ? (JSON.parse(candidate) as Actor) : null;
  });
  if (options.withScopeHook !== false) {
    await registerRequestScopeHook(app, {
      buildTenantContext: refusingWiderScopeThanTheActorMayHold(
        actorTenantContext({
          customerRollupScope: () => undefined,
          organizationSubtree: () => undefined,
          adminTenantScope: () => ({
            resolveForAdmin: options.adminScope ?? (async () => ({ allowAll: true })),
          }),
        }),
      ),
    });
  }
  app.get('/open', async (request) => report(request));
  app.get('/admin', { preHandler: adminGate }, async (request) => report(request));
  app.get('/customer', { preHandler: customerGate }, async (request) => report(request));
  app.get('/admin/widened', { preHandler: adminGate }, async (request) => ({
    inside: await withSystemScope('test: a widening inside a rebound request', async () =>
      getTenantContext()?.mode,
    ),
    after: report(request),
  }));
  app.get(
    '/admin/before-and-after',
    {
      preHandler: [
        async (request) => {
          (request as unknown as { seen: string | undefined }).seen = getTenantContext()?.mode;
        },
        adminGate,
      ],
    },
    async (request) => ({
      before: (request as unknown as { seen: string | undefined }).seen,
      after: report(request),
    }),
  );
  return app;
}

function headers(ambient: Actor | null, candidate: Actor | null): Record<string, string> {
  return {
    ...(ambient === null ? {} : { 'x-ambient': JSON.stringify(ambient) }),
    ...(candidate === null ? {} : { 'x-admin-candidate': JSON.stringify(candidate) }),
  };
}

async function ask(
  app: FastifyInstance,
  url: string,
  ambient: Actor | null,
  candidate: Actor | null,
): Promise<{ status: number; body: Report }> {
  const response = await app.inject({ method: 'GET', url, headers: headers(ambient, candidate) });
  return { status: response.statusCode, body: response.json() };
}

describe('a request is scoped to the actor its gate accepted', () => {
  it('scopes an admin route to the admin when the ambient actor is a customer', async () => {
    const app = await appWith();

    const { status, body } = await ask(app, '/admin', customer, admin);

    expect(status).toBe(200);
    expect(body.actorKind).toBe('admin');
    expect(body.tenant.mode).toBe('all');
    expect(body.tenant.actor).toEqual({ kind: 'admin', id: 'admin-1' });
    expect(body.tenant.customerAccountId).toBeUndefined();
    await app.close();
  });

  it('gives that admin the reach its own scope resolves to, not the customer`s organization', async () => {
    const app = await appWith({
      adminScope: async () => ({ allowAll: false, allowedOrganizationIds: [ORG_B] }),
    });

    const { body } = await ask(app, '/admin', customer, admin);

    expect(body.tenant.mode).toBe('allowed-set');
    expect(body.tenant.allowedOrganizationIds).toEqual([ORG_B]);
    expect(body.tenant.organizationId).toBeUndefined();
    await app.close();
  });

  it('names the admin as the Command actor on an admin route, with no impersonation', async () => {
    const app = await appWith();

    const whileImpersonating = await ask(app, '/admin', impersonated, admin);

    expect(whileImpersonating.body.commandActor).toEqual({
      actorAdminUserId: 'admin-1',
      impersonatedCustomerAccountId: null,
      kind: 'admin',
    });
    expect(whileImpersonating.body.tenant.impersonation).toBeUndefined();
    await app.close();
  });

  it('keeps a customer route in the customer`s scope when an admin session is present too', async () => {
    const app = await appWith();

    const { status, body } = await ask(app, '/customer', customer, admin);

    expect(status).toBe(200);
    expect(body.actorKind).toBe('customer');
    expect(body.tenant.mode).toBe('single-org');
    expect(body.tenant.organizationId).toBe(ORG_A);
    expect(body.commandActor.actorAdminUserId).toBeNull();
    await app.close();
  });

  it('keeps the impersonated customer`s view on a customer route, with the admin as impersonator', async () => {
    const app = await appWith();

    const { body } = await ask(app, '/customer', impersonated, admin);

    expect(body.tenant.mode).toBe('single-org');
    expect(body.tenant.organizationId).toBe(ORG_A);
    expect(body.commandActor).toEqual({
      actorAdminUserId: 'admin-1',
      impersonatedCustomerAccountId: 'customer-1',
      kind: 'customer',
    });
    await app.close();
  });

  it('leaves a route with no gate in the ambient actor`s scope', async () => {
    const app = await appWith();

    const both = await ask(app, '/open', customer, admin);
    const nobody = await ask(app, '/open', null, null);

    expect(both.body.tenant.mode).toBe('single-org');
    expect(both.body.tenant.organizationId).toBe(ORG_A);
    expect(nobody.body.tenant.mode).toBe('system');
    await app.close();
  });

  it('refuses an admin route with no admin session, and a customer route with only an admin one', async () => {
    const app = await appWith();

    expect((await ask(app, '/admin', customer, null)).status).toBe(401);
    expect((await ask(app, '/admin', null, null)).status).toBe(401);
    expect((await ask(app, '/customer', admin, admin)).status).toBe(401);
    await app.close();
  });

  it('is the context the handler runs in, and the earlier one only before the gate', async () => {
    const app = await appWith();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/before-and-after',
      headers: headers(customer, admin),
    });
    const body = response.json() as { before: string; after: Report };

    expect(body.before).toBe('single-org');
    expect(body.after.tenant.mode).toBe('all');
    expect(body.after.scopeTenantMode).toBe('all');
    await app.close();
  });

  it('leaves an escape-hatch widening inside the request its own, and returns to the rebound context', async () => {
    const app = await appWith();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/widened',
      headers: headers(customer, admin),
    });
    const body = response.json() as { inside: string; after: Report };

    expect(body.inside).toBe('system');
    expect(body.after.tenant.mode).toBe('all');
    await app.close();
  });

  it('does not derive again when the gate accepted the actor the context came from', async () => {
    let asked = 0;
    const app = await appWith({
      adminScope: async () => {
        asked += 1;
        return { allowAll: true };
      },
    });

    const { status } = await ask(app, '/admin', admin, admin);

    expect(status).toBe(200);
    expect(asked).toBe(1);
    await app.close();
  });

  it('refuses the request when the accepted actor`s scope cannot be derived', async () => {
    const app = await appWith({
      adminScope: async () => {
        throw new Error('the scope port failed');
      },
    });

    const { status } = await ask(app, '/admin', customer, admin);

    expect(status).toBe(500);
    await app.close();
  });

  it('keeps one request`s rebinding out of the next', async () => {
    const app = await appWith();

    const [first, second] = await Promise.all([
      ask(app, '/admin', customer, admin),
      ask(app, '/customer', customer, admin),
    ]);

    expect(first.body.tenant.mode).toBe('all');
    expect(second.body.tenant.mode).toBe('single-org');
    await app.close();
  });

  it('does nothing in a composition that mounts a gate without the scope hook', async () => {
    const app = await appWith({ withScopeHook: false });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/before-and-after',
      headers: headers(customer, admin),
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
