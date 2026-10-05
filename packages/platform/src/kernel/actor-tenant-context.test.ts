import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asFunction, asValue } from 'awilix';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@endora-commerce/contracts';
import { getTenantContext, type TenantContext } from '../tenancy/tenant-context.js';
import { customerFilterCond, orgFilterCond } from '../tenancy/filters.js';
import { orgConstraintFor } from '../tenancy/derived-scope.js';
import { systemTenantContext } from '../tenancy/resolve-tenant-context.js';
import { createRootContainer, type KernelContainer } from './container.js';
import { tenantContextMappingFor } from './actor-tenant-context.js';
import { ModuleDisabledError } from './lifecycle/plugin-helpers.js';
import { registerRequestScopeHook } from './request-scope-hook.js';

/**
 * The tenant context a composition gives a request when its root supplied no
 * mapping of its own (Principle XI).
 *
 * That is the composition an instance runs: its entry point calls
 * `composeApp({ deploymentRoot })` and nothing else. The property held here is
 * that such a composition confines a customer and an admin — to what the
 * modules it composed say they may reach, and to less when a module is missing,
 * never to more.
 *
 * The first block enters where a browser does: a real Fastify lifecycle, the
 * real scope hook, and a handler that reports the ambient context it ran in.
 * The actor is set by a stand-in for `auth`'s hook, read off a header, because
 * the subject is what the mapping does with an actor and not how one is
 * authenticated.
 */

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_A_CHILD = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

const customer: Actor = {
  kind: 'customer',
  customerAccountId: 'customer-1',
  organizationId: ORG_A,
} as Actor;
const admin: Actor = { kind: 'admin', adminUserId: 'admin-1' } as Actor;
const boundKey: Actor = {
  kind: 'api_key',
  apiKeyId: 'key-1',
  organizationId: ORG_A,
  customerAccountId: 'service-1',
  scopes: [],
} as unknown as Actor;
const unboundKey: Actor = { kind: 'api_key', apiKeyId: 'key-2', scopes: [] } as unknown as Actor;
const anonymous: Actor = { kind: 'anonymous' } as Actor;

async function appOver(
  container: KernelContainer,
  supplied?: Parameters<typeof tenantContextMappingFor>[1],
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('actor', null as never);
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-test-actor'];
    if (typeof header === 'string') request.actor = JSON.parse(header) as Actor;
  });
  await registerRequestScopeHook(app, {
    buildTenantContext: tenantContextMappingFor(container, supplied),
  });
  app.get('/context', async () => getTenantContext());
  return app;
}

async function contextFor(app: FastifyInstance, actor: Actor | null): Promise<{
  status: number;
  tenant: TenantContext;
}> {
  const response = await app.inject({
    method: 'GET',
    url: '/context',
    headers: actor === null ? {} : { 'x-test-actor': JSON.stringify(actor) },
  });
  return { status: response.statusCode, tenant: response.json() };
}

/** A container holding what `customer_accounts` and `organizations` register. */
function composedContainer(options: {
  readonly rollup: boolean;
  readonly adminScope: { allowAll: true } | { allowAll: false; allowedOrganizationIds: string[] };
}): KernelContainer {
  const container = createRootContainer();
  container.register({
    customerRollupScopePort: asValue({
      resolveSubtreeIds: async (
        _customerAccountId: string,
        organizationId: string | null,
        subtreeIds: (id: string) => Promise<string[]>,
      ) => (options.rollup && organizationId !== null ? subtreeIds(organizationId) : undefined),
    }),
    organizationTreeService: asValue({
      subtreeIds: async (id: string) => (id === ORG_A ? [ORG_A, ORG_A_CHILD] : [id]),
    }),
    adminTenantScopePort: asValue({ resolveForAdmin: async () => options.adminScope }),
  } as never);
  return container;
}

describe('the tenant context of a composition that supplied no mapping', () => {
  it('confines a customer to its own organization', async () => {
    const app = await appOver(composedContainer({ rollup: false, adminScope: { allowAll: true } }));
    const { status, tenant } = await contextFor(app, customer);
    expect(status).toBe(200);
    expect(tenant.mode).toBe('single-org');
    expect(tenant.organizationId).toBe(ORG_A);
    expect(tenant.customerAccountId).toBe('customer-1');
    expect(tenant.actor).toEqual({ kind: 'customer', id: 'customer-1' });
  });

  it('widens a roll-up customer to its subtree and no further', async () => {
    const app = await appOver(composedContainer({ rollup: true, adminScope: { allowAll: true } }));
    const { tenant } = await contextFor(app, customer);
    expect(tenant.mode).toBe('allowed-set');
    expect(tenant.allowedOrganizationIds).toEqual([ORG_A, ORG_A_CHILD]);
    expect(tenant.allowedOrganizationIds).not.toContain(ORG_B);
  });

  it('gives an admin the reach its role resolves to, and names it as the actor', async () => {
    const all = await appOver(composedContainer({ rollup: false, adminScope: { allowAll: true } }));
    const platformAdmin = await contextFor(all, admin);
    expect(platformAdmin.tenant.mode).toBe('all');
    expect(platformAdmin.tenant.actor).toEqual({ kind: 'admin', id: 'admin-1' });

    const scoped = await appOver(
      composedContainer({
        rollup: false,
        adminScope: { allowAll: false, allowedOrganizationIds: [ORG_B] },
      }),
    );
    const rep = await contextFor(scoped, admin);
    expect(rep.tenant.mode).toBe('allowed-set');
    expect(rep.tenant.allowedOrganizationIds).toEqual([ORG_B]);
    expect(rep.tenant.actor).toEqual({ kind: 'admin', id: 'admin-1' });
  });

  it('pins a bound API key to its organization and leaves an unbound one in system scope', async () => {
    const app = await appOver(composedContainer({ rollup: false, adminScope: { allowAll: true } }));
    const bound = await contextFor(app, boundKey);
    expect(bound.tenant.mode).toBe('single-org');
    expect(bound.tenant.organizationId).toBe(ORG_A);
    expect(bound.tenant.customerAccountId).toBe('service-1');
    expect(bound.tenant.actor).toEqual({ kind: 'api_key', id: 'key-1' });

    const unbound = await contextFor(app, unboundKey);
    expect(unbound.tenant.mode).toBe('system');
  });

  it('keeps system scope for a request that identifies nobody', async () => {
    const app = await appOver(composedContainer({ rollup: false, adminScope: { allowAll: true } }));
    expect((await contextFor(app, anonymous)).tenant.mode).toBe('system');
    // No auth plugin composed at all, so nothing decorated the actor.
    expect((await contextFor(app, null)).tenant.mode).toBe('system');
  });
});

describe('a composition missing the modules the mapping asks', () => {
  it('still confines a customer to its own organization', async () => {
    const app = await appOver(createRootContainer());
    const { status, tenant } = await contextFor(app, customer);
    expect(status).toBe(200);
    expect(tenant.mode).toBe('single-org');
    expect(tenant.organizationId).toBe(ORG_A);
  });

  it('confines an admin to no organization rather than to all of them', async () => {
    const app = await appOver(createRootContainer());
    const { status, tenant } = await contextFor(app, admin);
    expect(status).toBe(200);
    expect(tenant.mode).toBe('allowed-set');
    expect(tenant.allowedOrganizationIds).toEqual([]);
    expect(tenant.actor).toEqual({ kind: 'admin', id: 'admin-1' });
  });

  it('does not widen a customer when only half of the roll-up is composed', async () => {
    const container = createRootContainer();
    container.register({
      customerRollupScopePort: asValue({
        resolveSubtreeIds: async () => [ORG_A, ORG_B],
      }),
    } as never);
    const { tenant } = await contextFor(await appOver(container), customer);
    expect(tenant.mode).toBe('single-org');
    expect(tenant.organizationId).toBe(ORG_A);
  });

  it('confines an admin to no organization when an owner behind the port is absent', async () => {
    // Both places the presence answer can come from: the port's own gate, at
    // resolution, and a module its implementation reads, inside the call.
    const atCall = createRootContainer();
    atCall.register({
      adminTenantScopePort: asValue({
        resolveForAdmin: async () => {
          throw new ModuleDisabledError('admin_roles');
        },
      }),
    } as never);
    const atResolution = createRootContainer();
    atResolution.register({
      adminTenantScopePort: asFunction(() => {
        throw new ModuleDisabledError('organizations');
      }).transient(),
    } as never);

    for (const container of [atCall, atResolution]) {
      const { status, tenant } = await contextFor(await appOver(container), admin);
      // Not a 503: the hook runs before every route, the ones over global data
      // included.
      expect(status).toBe(200);
      expect(tenant.mode).toBe('allowed-set');
      expect(tenant.allowedOrganizationIds).toEqual([]);
    }
  });

  it('defers that refusal to the first tenant-scoped read instead of dropping it', async () => {
    const container = createRootContainer();
    container.register({
      adminTenantScopePort: asValue({
        resolveForAdmin: async () => {
          throw new ModuleDisabledError('organizations');
        },
      }),
    } as never);
    const app = await appOver(container);
    // What a handler over organization data runs: each of the three places that
    // turn the ambient context into a tenant predicate.
    app.get('/org-scoped', async () => orgFilterCond());
    app.get('/customer-scoped', async () => customerFilterCond('present'));
    app.get('/derived', async () => orgConstraintFor());
    const asAdmin = { 'x-test-actor': JSON.stringify(admin) };

    for (const url of ['/org-scoped', '/customer-scoped', '/derived']) {
      const response = await app.inject({ method: 'GET', url, headers: asAdmin });
      // Not an empty list: the truthful answer is that a module is off.
      expect(response.statusCode, url).toBe(503);
      expect(response.body, url).toContain('organizations');
    }
    // A route over global data builds no tenant predicate and answers.
    expect((await app.inject({ method: 'GET', url: '/context', headers: asAdmin })).statusCode).toBe(
      200,
    );
    // And an admin with no port at all is confined quietly: nobody refused.
    const quiet = await appOver(createRootContainer());
    quiet.get('/org-scoped', async () => orgFilterCond());
    const none = await quiet.inject({ method: 'GET', url: '/org-scoped', headers: asAdmin });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ organizationId: { $in: [] } });
  });

  it('does not degrade a customer when the roll-up owner is absent — the request is refused', async () => {
    const container = createRootContainer();
    container.register({
      customerRollupScopePort: asValue({
        resolveSubtreeIds: async () => {
          throw new ModuleDisabledError('customer_accounts');
        },
      }),
      organizationTreeService: asValue({ subtreeIds: async (id: string) => [id] }),
    } as never);
    const response = await (await appOver(container)).inject({
      method: 'GET',
      url: '/context',
      headers: { 'x-test-actor': JSON.stringify(customer) },
    });
    expect(response.statusCode).toBe(503);
  });

  it('touches the tree owner only for an account that rolls up', async () => {
    // `organizationTreeService` is a gated port: with its owner absent the
    // **resolution** refuses, before any method is called. Only a roll-up
    // account's traversal may meet that refusal — a customer who does not roll
    // up never asked the tree anything and is confined as always.
    const treeOwnerAbsent = (rollup: boolean): KernelContainer => {
      const container = createRootContainer();
      container.register({
        customerRollupScopePort: asValue({
          resolveSubtreeIds: async (
            _customerAccountId: string,
            organizationId: string | null,
            subtreeIds: (id: string) => Promise<string[]>,
          ) => (rollup && organizationId !== null ? subtreeIds(organizationId) : undefined),
        }),
        organizationTreeService: asFunction(() => {
          throw new ModuleDisabledError('organizations');
        }),
      } as never);
      return container;
    };

    const flat = await contextFor(await appOver(treeOwnerAbsent(false)), customer);
    expect(flat.status).toBe(200);
    expect(flat.tenant.mode).toBe('single-org');
    expect(flat.tenant.organizationId).toBe(ORG_A);

    const rollingUp = await (await appOver(treeOwnerAbsent(true))).inject({
      method: 'GET',
      url: '/context',
      headers: { 'x-test-actor': JSON.stringify(customer) },
    });
    expect(rollingUp.statusCode).toBe(503);
  });

  it('lets any other failure of a registered port fail the request instead of widening it', async () => {
    const container = createRootContainer();
    container.register({
      adminTenantScopePort: asValue({
        resolveForAdmin: async () => {
          throw new Error('the database is unreachable');
        },
      }),
    } as never);
    const response = await (await appOver(container)).inject({
      method: 'GET',
      url: '/context',
      headers: { 'x-test-actor': JSON.stringify(admin) },
    });
    expect(response.statusCode).toBe(500);
  });
});

describe("a deployment's own mapping", () => {
  const everyoneIsSystem = async (): Promise<TenantContext> => systemTenantContext('stub');

  it('is refused when it answers a customer or an admin with a system scope', async () => {
    const app = await appOver(createRootContainer(), everyoneIsSystem);
    for (const actor of [customer, admin]) {
      const response = await app.inject({
        method: 'GET',
        url: '/context',
        headers: { 'x-test-actor': JSON.stringify(actor) },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('"mode":"system"');
    }
  });

  it('is refused when it answers a bound API key with a system scope', async () => {
    const app = await appOver(createRootContainer(), everyoneIsSystem);
    const response = await app.inject({
      method: 'GET',
      url: '/context',
      headers: { 'x-test-actor': JSON.stringify(boundKey) },
    });
    expect(response.statusCode).toBe(500);
  });

  it('is refused when it answers a customer or a bound API key with every organization', async () => {
    const everyoneIsAll = async (): Promise<TenantContext> =>
      ({ mode: 'all', actor: { kind: 'admin', id: 'stub' } }) as TenantContext;
    const app = await appOver(createRootContainer(), everyoneIsAll);
    for (const actor of [customer, boundKey]) {
      const response = await app.inject({
        method: 'GET',
        url: '/context',
        headers: { 'x-test-actor': JSON.stringify(actor) },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('"mode":"all"');
    }
    // `all` is what a platform administrator holds, so it is an admin's to have.
    expect((await contextFor(app, admin)).tenant.mode).toBe('all');
  });

  it('is used as written for everything else', async () => {
    const app = await appOver(createRootContainer(), everyoneIsSystem);
    expect((await contextFor(app, anonymous)).tenant.reason).toBe('stub');
    expect((await contextFor(app, unboundKey)).tenant.reason).toBe('stub');
  });
});

describe('a composition whose admins would all be confined to nothing', () => {
  it('says so once, at assembly, and names the remedy', () => {
    const warn = vi.fn();
    tenantContextMappingFor(createRootContainer(), undefined, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("'adminTenantScopePort'");
    expect(warn.mock.calls[0]?.[0]).toContain('Upgrade all `@endora-commerce/*` packages together');
  });

  it('is silent when the port is registered, and when the deployment maps for itself', () => {
    const warn = vi.fn();
    tenantContextMappingFor(
      composedContainer({ rollup: false, adminScope: { allowAll: true } }),
      undefined,
      { warn },
    );
    tenantContextMappingFor(createRootContainer(), async () => systemTenantContext('own'), { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * `composeApp` itself opens a PostgreSQL and a Redis before it composes
 * anything, so what it does with the option is read off its source: the hook is
 * handed the result of `tenantContextMappingFor`, and no system context is
 * built for it there.
 */
describe('composeApp', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../composition/compose-app.ts', import.meta.url)),
    'utf8',
  );

  it('takes its tenant-context mapping from tenantContextMappingFor', () => {
    expect(source).toMatch(
      /const buildTenantContext = tenantContextMappingFor\(\s*container,\s*options\.buildTenantContext,\s*\{/,
    );
    // And the warning has somewhere to go.
    expect(source).toMatch(/warn: \(message\) => console\.warn\(message\)/);
    expect(source).toMatch(/registerRequestScopeHook\(app, \{ buildTenantContext \}\)/);
  });

  it('builds no system context of its own for a request', () => {
    expect(source).not.toMatch(/systemTenantContext\(`\$\{request\.method\}/);
    expect(source).not.toMatch(/options\.buildTenantContext\s*\?\?/);
  });
});
