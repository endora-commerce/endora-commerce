import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { composeModuleForTest } from '@endora-commerce/test-kit/module';
import { registerModule } from './index.js';

/**
 * This module defaults `ordersAdminScopeResolver`
 * (`specs/117-instance-bring-up/` Phase 6, FR-033).
 *
 * It was contributed by `backend/src/composition.ts` and by
 * `backend/test/helpers/test-server.ts` and by nothing else. The admin orders
 * list is one of the first screens an operator opens, so on a scaffolded
 * instance the absence was a 500 at the front of the admin surface after a boot
 * that looked fine.
 *
 * T118b left it out of the platform's actor-shaped nine for a reason that is
 * still right and pointed at the wrong home: the body decides on
 * `admin_roles.code === 'sales_representative'`, which is a module's business
 * rule over a module's table, so it may not live in `@endora-commerce/platform`
 * — and what follows from that is *this* module, not a composition root. The
 * root asked the same question in `knex.raw` over two other modules' tables;
 * the default below asks the two owners through their ports, which this
 * manifest now declares.
 */

const resolverOver = (
  ports: Record<string, unknown>,
): ((
  request: FastifyRequest,
) => Promise<{ allowAll: boolean }>) => {
  const { container } = composeModuleForTest({
    module: { id: 'orders', registerModule },
    values: {
      emFactory: () => ({}) as never,
      commandBus: {},
      auditLogService: {},
      redis: undefined,
      ...ports,
    },
  });
  expect(container.hasRegistration('ordersAdminScopeResolver')).toBe(true);
  return container.cradle.ordersAdminScopeResolver as never;
};

const requestWith = (actor: unknown): FastifyRequest => ({ actor }) as unknown as FastifyRequest;

const refusingPorts = {
  adminUserReadPort: { findById: () => Promise.reject(new Error('not asked')) },
  adminRolePort: { getById: () => Promise.reject(new Error('not asked')) },
  organizationSalesRepScopePort: {
    listAssignedOrganizationIds: () => Promise.reject(new Error('not asked')),
  },
};

describe('orders — the admin orders scope it defaults', () => {
  it('answers "no scope to apply" for a non-admin caller without asking any port', async () => {
    const resolve = resolverOver(refusingPorts);
    await expect(resolve(requestWith({ kind: 'anonymous' }))).resolves.toEqual({ allowAll: true });
  });

  it('leaves an admin who is not a sales representative unscoped', async () => {
    const resolve = resolverOver({
      ...refusingPorts,
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: 'role-1' }) },
      adminRolePort: { getById: () => Promise.resolve({ code: 'platform_admin' }) },
    });
    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'admin-1' }))).resolves.toEqual({
      allowAll: true,
    });
  });

  // Issue #305 — the resolver says only *that* a sales representative's list is
  // scoped; *what* it reaches is the ambient tenant context's, derived by
  // `organizations`' one reach rule (unassigned organizations included).
  it('scopes a sales representative, and asks the assignment port nothing', async () => {
    const resolve = resolverOver({
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: 'role-2' }) },
      adminRolePort: { getById: () => Promise.resolve({ code: 'sales_representative' }) },
      organizationSalesRepScopePort: {
        listAssignedOrganizationIds: () => Promise.reject(new Error('the reach is not the resolver’s to read')),
      },
    });
    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'rep-1' }))).resolves.toEqual({
      allowAll: false,
    });
  });

  it('leaves an admin with no role unscoped rather than scoping them to nothing', async () => {
    const resolve = resolverOver({
      ...refusingPorts,
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: null }) },
    });
    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'admin-2' }))).resolves.toEqual({
      allowAll: true,
    });
  });
});
