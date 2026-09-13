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
 * This module defaults its two actor-shaped resolvers
 * (`specs/117-instance-bring-up/` Phase 6, FR-033).
 *
 * Both were contributed by `backend/src/composition.ts` and by
 * `backend/test/helpers/test-server.ts` and by **nothing else**, so a
 * composition that is neither of those two could not resolve either name — and
 * every client instance is neither: `endora new instance` writes a tree whose
 * whole composition is one `composeApp({ deploymentRoot })` call. The failure
 * is not a boot failure, which is what made it expensive to find: the names are
 * read per request, so the instance starts, serves, and answers 500 on the
 * first RFQ screen an operator opens.
 *
 * The assertion is therefore *"a composition that contributes nothing gets a
 * working answer"*, which is the state an instance is in. A root that wants a
 * different answer still contributes over it, and the test harness does — its
 * `rfqAdminContextResolver` widens `isPlatformAdmin` on purpose — so this file
 * asserts the default and never that the default is the only answer.
 */

const contextFor = (overrides: Record<string, unknown>) => {
  const container = createRootContainer();
  registerValues(container, {
    emFactory: () => ({}) as never,
    eventBus: new EventBus(),
    auditLogService: {},
    ...overrides,
  });
  const ctx = createModuleContext({
    module: { id: 'quote_requests', version: '1.0.0' },
    container,
    eventBus: new EventBus(),
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  registerModule(ctx);
  return container;
};

const requestWith = (actor: unknown): FastifyRequest => ({ actor }) as unknown as FastifyRequest;

describe('quote_requests — the actor resolvers it defaults', () => {
  it('registers both names, so a composition that contributes nothing can resolve them', () => {
    const container = contextFor({});
    expect(container.hasRegistration('rfqCustomerContextResolver')).toBe(true);
    expect(container.hasRegistration('rfqAdminContextResolver')).toBe(true);
  });

  it('answers the customer context from the actor and the account read port', async () => {
    const container = contextFor({
      customerAccountReadPort: {
        findById: () => Promise.resolve({ role: 'organization_admin' }),
      },
    });
    const resolve = container.cradle
      .rfqCustomerContextResolver as (request: FastifyRequest) => Promise<unknown>;

    await expect(
      resolve(
        requestWith({ kind: 'customer', customerAccountId: 'cust-1', organizationId: 'org-1' }),
      ),
    ).resolves.toEqual({
      customerAccountId: 'cust-1',
      organizationId: 'org-1',
      isOrgAdmin: true,
    });
  });

  it('refuses a non-customer caller with a 401 rather than an undefined context', async () => {
    const container = contextFor({ customerAccountReadPort: { findById: () => Promise.resolve(null) } });
    const resolve = container.cradle
      .rfqCustomerContextResolver as (request: FastifyRequest) => Promise<unknown>;
    await expect(resolve(requestWith({ kind: 'anonymous' }))).rejects.toBeInstanceOf(HttpError);
  });

  it('names the admin role the surface renders, reading it through the two identity ports', async () => {
    const container = contextFor({
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: 'role-1' }) },
      adminRolePort: {
        getById: () => Promise.resolve({ code: 'sales_representative', name: 'Rep' }),
      },
    });
    const resolve = container.cradle
      .rfqAdminContextResolver as (request: FastifyRequest) => Promise<unknown>;

    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'admin-1' }))).resolves.toEqual({
      adminUserId: 'admin-1',
      isPlatformAdmin: false,
      roleLabel: 'Sales representative',
    });
  });

  it('reads an admin with no role as an administrator rather than as a platform admin', async () => {
    const container = contextFor({
      adminUserReadPort: { findById: () => Promise.resolve({ adminRoleId: null }) },
      adminRolePort: { getById: () => Promise.reject(new Error('not asked')) },
    });
    const resolve = container.cradle
      .rfqAdminContextResolver as (request: FastifyRequest) => Promise<unknown>;

    await expect(resolve(requestWith({ kind: 'admin', adminUserId: 'admin-1' }))).resolves.toEqual({
      adminUserId: 'admin-1',
      isPlatformAdmin: false,
      roleLabel: 'Administrator',
    });
  });
});
