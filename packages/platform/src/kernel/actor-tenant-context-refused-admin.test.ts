import { asValue } from 'awilix';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AdminTenantScopePort } from '@endora-commerce/contracts';
import { orgConstraintFor } from '../tenancy/derived-scope.js';
import { createRootContainer } from './container.js';
import { tenantContextMappingFor } from './actor-tenant-context.js';

/**
 * An admin whose reach the owning module **refuses** — rather than cannot
 * answer — is confined to no organization, and the refusal is raised where a
 * tenant predicate is built.
 *
 * The owning module answers this for an administrator that holds no role. The
 * property held here is the platform's half: whatever error the port's answer
 * carries as `unresolved` reaches the tenant guard unchanged, never widens the
 * context, and leaves an execution that builds no predicate alone.
 */
describe('an admin scope that carries a refusal', () => {
  const refusal = Object.assign(new Error('refused'), { statusCode: 403, code: 'ADMIN_ROLE_REQUIRED' });

  async function contextFor(port: AdminTenantScopePort) {
    const container = createRootContainer();
    container.register({ adminTenantScopePort: asValue(port) });
    const request = { actor: { kind: 'admin', adminUserId: 'admin-1' } } as unknown as FastifyRequest;
    return tenantContextMappingFor(container)(request);
  }

  it('is confined to no organization, with the admin still the recorded actor', async () => {
    const tenant = await contextFor({
      resolveForAdmin: async () => ({ allowAll: false, allowedOrganizationIds: [], unresolved: refusal }),
    });

    expect(tenant.mode).toBe('allowed-set');
    expect(tenant.allowedOrganizationIds).toEqual([]);
    expect(tenant.actor).toEqual({ kind: 'admin', id: 'admin-1' });
    expect(tenant.scopeUnresolved).toBe(refusal);
  });

  it('raises that refusal when a tenant predicate is built from it', async () => {
    const tenant = await contextFor({
      resolveForAdmin: async () => ({ allowAll: false, allowedOrganizationIds: [], unresolved: refusal }),
    });

    expect(() => orgConstraintFor(tenant)).toThrow(refusal);
  });
});
