import type { EntityManager } from '@mikro-orm/postgresql';
import type { Queue } from 'bullmq';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type {
  CustomerAccountReadPort,
  CustomerAccountRecord,
  CustomerGroupReadPort,
  CustomerGroupRecord,
  OrganizationDetailsPort,
  OrganizationRecord,
} from '@b2b/contracts';
import {
  registerPwaAdminRoutes,
  type PwaAdminRoutesDeps,
} from '../../../src/modules/pwa/routes.admin.js';
import { PushMessageService } from '../../../src/modules/pwa/services/push-message-service.js';

/**
 * Feature 075, Phase C — `pwa` asks `customer_accounts`, `organizations` and
 * `price_lists` for their rows instead of querying their tables (FR-012).
 *
 * Every one of the five edges was an `em.find(<their entity>, …)` written from
 * inside this module, which is the shape Principle XVII cannot gate:
 * deactivation drops no tables, so the push Rule Builder went on listing
 * organisations, customer groups and buyer e-mail addresses out of modules an
 * operator had switched off, and a rule-targeted send went on resolving its
 * audience from them. Through a port the same read answers 503
 * `MODULE_DISABLED`.
 *
 * These cases assert the demand rather than the plumbing: an `EntityManager`
 * that **refuses** to serve a foreign entity, plus stub ports, must be enough.
 * A fake that would notice the old query is what makes the test able to fail.
 */

/**
 * An `EntityManager` that serves this module's own rows and refuses every other
 * module's. `handlers` is keyed by entity class name.
 */
function fakeEm(handlers: Record<string, unknown>): () => EntityManager {
  const dispatch = (entity: { name?: string }, fallback: unknown): unknown => {
    const name = entity.name ?? '(anonymous)';
    if (!(name in handlers)) {
      throw new Error(`pwa queried '${name}' directly — that row belongs to another module`);
    }
    return handlers[name] ?? fallback;
  };
  const em = {
    findOne: async (entity: { name?: string }) => dispatch(entity, null),
    find: async (entity: { name?: string }) => dispatch(entity, []),
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'msg-1', ...data }),
    persistAndFlush: async () => undefined,
  };
  return () => em as unknown as EntityManager;
}

function accountRecord(
  id: string,
  overrides: Partial<CustomerAccountRecord> = {},
): CustomerAccountRecord {
  return {
    id,
    organizationId: null,
    email: `${id}@example.test`,
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'regular_user',
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    customFieldValues: {},
    deletedAt: null,
    customerGroupId: null,
    subtreeRollupEnabled: false,
    blockedAt: null,
    blockReason: null,
    blockSource: null,
    blockedByAdminUserId: null,
    blockedByCustomerAccountId: null,
    deletionRequestedByAdminUserId: null,
    anonymizedAt: null,
    ...overrides,
  };
}

function organizationRecord(
  id: string,
  overrides: Partial<OrganizationRecord> = {},
): OrganizationRecord {
  return {
    id,
    name: `Org ${id}`,
    legalName: null,
    taxId: `PL${id}`,
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    customerGroupId: null,
    registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    orderConfirmationEmails: [],
    vatValidatedAt: null,
    vatValidationProvider: null,
    vatValidationOutcome: null,
    blockedReason: null,
    blockedAt: null,
    rejectedReason: null,
    rejectedAt: null,
    approvedAt: null,
    approvedByAdminUserId: null,
    requiresCartApproval: false,
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: null,
    path: `/${id}/`,
    creditInheritanceMode: null,
    customFieldValues: {},
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function groupRecord(id: string, code: string): CustomerGroupRecord {
  return {
    id,
    code,
    name: `Group ${code}`,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const unusedPort = new Proxy(
  {},
  {
    get: (_target, property) => () => {
      throw new Error(`pwa unexpectedly called '${String(property)}'`);
    },
  },
);

/**
 * A bare Fastify instance carrying only the picker routes' dependencies. The
 * three under test read nothing else, so every other dependency is a stub that
 * throws if it is reached.
 */
async function pickerApp(overrides: {
  customerAccounts: CustomerAccountReadPort;
  organizationDetails: OrganizationDetailsPort;
  customerGroups: CustomerGroupReadPort;
}): Promise<FastifyInstance> {
  const app = Fastify();
  const deps: PwaAdminRoutesDeps = {
    requireAdmin: () => async () => undefined,
    emFactory: fakeEm({ SalesChannel: [] }),
    configResolver: unusedPort as PwaAdminRoutesDeps['configResolver'],
    iconService: unusedPort as PwaAdminRoutesDeps['iconService'],
    subscriptionService: unusedPort as PwaAdminRoutesDeps['subscriptionService'],
    messageService: unusedPort as PwaAdminRoutesDeps['messageService'],
    settingsWrite: unusedPort as PwaAdminRoutesDeps['settingsWrite'],
    settingsRead: unusedPort as PwaAdminRoutesDeps['settingsRead'],
    resolveScopeChannelId: async () => null,
    channelCodeForId: async () => null,
    resolveAuditContext: () => ({ actorAdminUserId: null }),
    ...overrides,
  };
  await registerPwaAdminRoutes(app, deps);
  await app.ready();
  return app;
}

describe('pwa — the Rule Builder pickers read published ports', () => {
  it('lists customer groups over customerGroupReadPort', async () => {
    const app = await pickerApp({
      customerAccounts: unusedPort as CustomerAccountReadPort,
      organizationDetails: unusedPort as OrganizationDetailsPort,
      customerGroups: {
        findById: async () => null,
        findByIds: async () => [],
        listAll: async () => [groupRecord('grp-1', 'wholesale')],
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/pwa/rule-targets/customer-groups',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([
      { id: 'grp-1', code: 'wholesale', name: 'Group wholesale' },
    ]);
    await app.close();
  });

  it('searches organisations over organizationDetailsPort, passing query and limit', async () => {
    const asked: Array<[string, number]> = [];
    const app = await pickerApp({
      customerAccounts: unusedPort as CustomerAccountReadPort,
      organizationDetails: {
        findById: async () => null,
        findByIds: async () => [],
        countByIds: async () => 0,
        searchByName: async (query, limit) => {
          asked.push([query, limit]);
          return [organizationRecord('org-1')];
        },
        searchIdsByName: async () => [],
      },
      customerGroups: unusedPort as CustomerGroupReadPort,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/pwa/rule-targets/organizations?search=lodz&limit=25',
    });

    expect(response.statusCode).toBe(200);
    expect(asked).toEqual([['lodz', 25]]);
    expect(response.json().data.items).toEqual([
      { id: 'org-1', name: 'Org org-1', taxId: 'PLorg-1' },
    ]);
    await app.close();
  });

  it('searches customers over customerAccountReadPort, passing query and limit', async () => {
    const asked: Array<[string, number]> = [];
    const customerAccounts = {
      searchByEmail: async (query: string, limit: number) => {
        asked.push([query, limit]);
        return [accountRecord('cust-1', { organizationId: 'org-1' })];
      },
    } as unknown as CustomerAccountReadPort;

    const app = await pickerApp({
      customerAccounts,
      organizationDetails: unusedPort as OrganizationDetailsPort,
      customerGroups: unusedPort as CustomerGroupReadPort,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/pwa/rule-targets/customers?search=ada&limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(asked).toEqual([['ada', 10]]);
    expect(response.json().data.items).toEqual([
      { id: 'cust-1', email: 'cust-1@example.test', organizationId: 'org-1' },
    ]);
    await app.close();
  });
});

describe('pwa — rule-audience targeting resolves customer context over ports', () => {
  it('reads accounts and their organisations through the ports, never their tables', async () => {
    const askedAccounts: string[][] = [];
    const askedOrganizations: string[][] = [];

    const customerAccounts = {
      findByIds: async (ids: readonly string[]) => {
        askedAccounts.push([...ids]);
        return [
          accountRecord('cust-1', { organizationId: 'org-1' }),
          accountRecord('cust-2', { organizationId: 'org-1', customerGroupId: 'grp-own' }),
        ];
      },
    } as unknown as CustomerAccountReadPort;

    const organizationDetails = {
      findByIds: async (ids: readonly string[]) => {
        askedOrganizations.push([...ids]);
        return [organizationRecord('org-1', { customerGroupId: 'grp-inherited' })];
      },
    } as unknown as OrganizationDetailsPort;

    const enqueued: unknown[] = [];
    const queue = {
      addBulk: async (jobs: unknown[]) => {
        enqueued.push(...jobs);
        return jobs;
      },
    } as unknown as Queue<{ deliveryId: string }>;

    const service = new PushMessageService(
      fakeEm({
        PushMessage: null,
        PushSubscription: [
          { id: 'sub-1', customerAccountId: 'cust-1' },
          { id: 'sub-2', customerAccountId: 'cust-2' },
          { id: 'sub-3', customerAccountId: null },
        ],
        PushMessageDelivery: [],
      }),
      queue,
      customerAccounts,
      organizationDetails,
    );

    const result = await service.createAndEnqueue({
      salesChannelId: 'chan-1',
      title: 'Hello',
      body: 'World',
      audience: {
        kind: 'rule',
        rule: { kind: 'criterion', type: 'customerGroup', values: ['grp-inherited'] },
      },
      trigger: 'admin',
    });

    // `cust-1` inherits `grp-inherited` from its organisation and matches;
    // `cust-2` has its own group and does not; the anonymous subscriber cannot.
    expect(askedAccounts).toEqual([['cust-1', 'cust-2']]);
    expect(askedOrganizations).toEqual([['org-1']]);
    expect(result.queuedDeliveries).toBe(1);
    expect(enqueued).toHaveLength(1);
  });

  it('does not persist a message it cannot resolve an audience for', async () => {
    const customerAccounts = {
      findByIds: async () => {
        throw new Error('MODULE_DISABLED');
      },
    } as unknown as CustomerAccountReadPort;

    const persisted: unknown[] = [];
    const em = {
      findOne: async () => null,
      find: async (entity: { name?: string }) =>
        entity.name === 'PushSubscription' ? [{ id: 'sub-1', customerAccountId: 'cust-1' }] : [],
      create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'msg-1', ...data }),
      persistAndFlush: async (value: unknown) => {
        persisted.push(value);
      },
    } as unknown as EntityManager;

    const service = new PushMessageService(
      () => em,
      { addBulk: async () => [] } as unknown as Queue<{ deliveryId: string }>,
      customerAccounts,
      { findByIds: async () => [] } as unknown as OrganizationDetailsPort,
    );

    await expect(
      service.createAndEnqueue({
        salesChannelId: 'chan-1',
        title: 'Hello',
        body: 'World',
        audience: { kind: 'rule', rule: { kind: 'all' } },
        trigger: 'admin',
      }),
    ).rejects.toThrow('MODULE_DISABLED');

    expect(persisted).toEqual([]);
  });
});
