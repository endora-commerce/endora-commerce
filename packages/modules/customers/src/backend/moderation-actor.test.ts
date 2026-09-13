import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
  registerValues,
} from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { registerModule } from './index.js';

/**
 * This module defaults `customerModerationActorResolver`
 * (`specs/117-instance-bring-up/` Phase 6, FR-033).
 *
 * It was contributed by `backend/src/composition.ts` and by
 * `backend/test/helpers/test-server.ts` and by nothing else, so an instance —
 * whose whole composition is one `composeApp({ deploymentRoot })` call — could
 * not resolve it, and met that as a 500 on the admin customers screen rather
 * than at boot.
 *
 * The production root asked the role question in `knex.raw` over `admin_users`
 * and `admin_roles`, two other modules' tables on this module's
 * `EntityManager`. The default below asks the two owners, which is what the
 * test harness had been doing since T140.
 */

const resolverOver = (
  ports: Record<string, unknown>,
): ((request: FastifyRequest) => Promise<unknown>) => {
  const container = createRootContainer();
  registerValues(container, {
    emFactory: () => ({}) as never,
    eventBus: new EventBus(),
    auditLogService: {},
    ...ports,
  });
  registerModule(
    createModuleContext({
      module: { id: 'customers', version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    }),
  );
  expect(container.hasRegistration('customerModerationActorResolver')).toBe(true);
  return container.cradle.customerModerationActorResolver as (
    request: FastifyRequest,
  ) => Promise<unknown>;
};

const requestWith = (actor: unknown): FastifyRequest => ({ actor }) as unknown as FastifyRequest;

describe('customers — the moderation actor it defaults', () => {
  it('reads a platform admin as unscoped and asks the assignment port nothing', async () => {
    const resolve = resolverOver({
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: 'role-1' }) },
      adminRolePort: { getById: () => Promise.resolve({ code: 'platform_admin' }) },
      organizationSalesRepScopePort: {
        listAssignedOrganizationIds: () => Promise.reject(new Error('not asked')),
      },
    });

    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'admin-1' }))).resolves.toEqual({
      adminUserId: 'admin-1',
      isPlatformAdmin: true,
      allowedOrganizationIds: [],
    });
  });

  it('scopes a sales representative to the organizations the assignment port lists', async () => {
    const resolve = resolverOver({
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: 'role-2' }) },
      adminRolePort: { getById: () => Promise.resolve({ code: 'sales_representative' }) },
      organizationSalesRepScopePort: {
        listAssignedOrganizationIds: () => Promise.resolve(['org-1', 'org-2']),
      },
    });

    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'rep-1' }))).resolves.toEqual({
      adminUserId: 'rep-1',
      isPlatformAdmin: false,
      allowedOrganizationIds: ['org-1', 'org-2'],
    });
  });

  it('refuses a non-admin caller rather than answering an unscoped moderation context', async () => {
    const resolve = resolverOver({
      adminUserReadPort: { findById: () => Promise.resolve(null) },
      adminRolePort: { getById: () => Promise.reject(new Error('not asked')) },
      organizationSalesRepScopePort: {
        listAssignedOrganizationIds: () => Promise.reject(new Error('not asked')),
      },
    });
    await expect(resolve(requestWith({ kind: 'customer' }))).rejects.toBeInstanceOf(HttpError);
  });
});
