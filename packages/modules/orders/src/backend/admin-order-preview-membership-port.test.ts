import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { registerOrderRoutes, type OrdersDeps } from './routes.js';

/**
 * Feature 145, FR-027 / Principle XII — the admin order preview checks each
 * line's assortment through the `salesChannelMembership` bridge accessor. The
 * dependency is optional on `OrdersDeps`, so the route must fail closed when it
 * is not wired: `500 INTERNAL`, before any line is read, priced or judged.
 * Treating "not wired" as "every product is in the assortment" would quote an
 * order the channel cannot sell.
 */

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000b1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000c9';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000101';

describe('POST /api/v1/admin/orders/preview — the membership port is required', () => {
  let app: FastifyInstance;
  const touchedAfterGuard = {
    organizationDetails: vi.fn(),
    findByIds: vi.fn(),
    resolveLinePrice: vi.fn(),
    assertMethodsAllowedForOrganization: vi.fn(),
  };

  beforeEach(async () => {
    for (const fn of Object.values(touchedAfterGuard)) fn.mockReset();

    const em = {
      findOne: async (entity: unknown, where: { id?: string }) =>
        entity === SalesChannel && where.id === CHANNEL_ID
          ? ({ id: CHANNEL_ID, code: 'b2b', status: 'active' } as unknown as SalesChannel)
          : null,
    } as unknown as EntityManager;

    const deps = {
      emFactory: () => em,
      requireCustomer: async () => {},
      requireAdmin: () => async () => {},
      resolveCustomerContext: () => ({
        customerAccountId: CUSTOMER_ID,
        organizationId: ORGANIZATION_ID,
      }),
      customerAccountRead: {
        findById: async (id: string) =>
          id === CUSTOMER_ID ? { id: CUSTOMER_ID, organizationId: ORGANIZATION_ID } : null,
      },
      organizationDetails: { findById: touchedAfterGuard.organizationDetails },
      catalogProductRead: { findByIds: touchedAfterGuard.findByIds },
      catalogProductAvailability: { filterAvailable: touchedAfterGuard.findByIds },
      pricingService: { resolveLinePrice: touchedAfterGuard.resolveLinePrice },
      orderService: {
        assertMethodsAllowedForOrganization: touchedAfterGuard.assertMethodsAllowedForOrganization,
      },
      // Deliberately absent: salesChannelMembership.
    } as unknown as OrdersDeps;

    app = Fastify();
    // The route declares Zod schemas and parses its body with Zod itself; this
    // package does not depend on the Zod type provider, so the compilers are
    // pass-throughs rather than Ajv trying to compile a Zod object.
    app.setValidatorCompiler(() => (data) => ({ value: data }));
    app.setSerializerCompiler(() => (data) => JSON.stringify(data));
    await registerOrderRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 500 INTERNAL and evaluates no line', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      payload: {
        customerAccountId: CUSTOMER_ID,
        salesChannelId: CHANNEL_ID,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
      },
    });

    expect(res.statusCode, res.body).toBe(500);
    expect((res.json() as { code: string }).code).toBe(ERROR_CODES.INTERNAL);
    expect(res.body).not.toContain('unitPrice');
    for (const fn of Object.values(touchedAfterGuard)) expect(fn).not.toHaveBeenCalled();
  });

  it('refuses an unknown channel the same way: without the port nothing is judged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      payload: {
        customerAccountId: CUSTOMER_ID,
        salesChannelId: '00000000-0000-4000-8000-0000000000c1',
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
      },
    });

    // Issue #515 — the channel is judged against the Organization's channels,
    // which the port answers; the port check therefore comes first.
    expect(res.statusCode, res.body).toBe(500);
    expect((res.json() as { code: string }).code).toBe(ERROR_CODES.INTERNAL);
  });
});

/**
 * Issue #515 — the preview answers the refusal creating the order would raise:
 * a channel that is not one of the customer's Organization's active assigned
 * channels — unassigned, inactive or nonexistent — is `422
 * ORDER_SALES_CHANNEL_NOT_ALLOWED`, before any line is read, priced or judged.
 */
describe('POST /api/v1/admin/orders/preview — the Organization\'s channels', () => {
  const INACTIVE_ID = '00000000-0000-4000-8000-0000000000c8';
  const UNASSIGNED_ID = '00000000-0000-4000-8000-0000000000c7';
  let app: FastifyInstance;
  const touchedAfterGuard = {
    organizationDetails: vi.fn(),
    findByIds: vi.fn(),
    resolveLinePrice: vi.fn(),
    assertMethodsAllowedForOrganization: vi.fn(),
  };
  const listChannelsForEntity = vi.fn(async () => [
    { id: CHANNEL_ID, active: true },
    { id: INACTIVE_ID, active: false },
  ]);

  beforeEach(async () => {
    for (const fn of Object.values(touchedAfterGuard)) fn.mockReset();
    listChannelsForEntity.mockClear();
    const em = {
      // Every channel id exists here: the refusal must come from the
      // Organization's assignment, not from a missing row.
      findOne: async (entity: unknown, where: { id?: string }) =>
        entity === SalesChannel
          ? ({ id: where.id, code: 'any', active: true } as unknown as SalesChannel)
          : null,
    } as unknown as EntityManager;
    const deps = {
      emFactory: () => em,
      requireCustomer: async () => {},
      requireAdmin: () => async () => {},
      resolveCustomerContext: () => ({ customerAccountId: CUSTOMER_ID, organizationId: ORGANIZATION_ID }),
      customerAccountRead: {
        findById: async (id: string) =>
          id === CUSTOMER_ID ? { id: CUSTOMER_ID, organizationId: ORGANIZATION_ID } : null,
      },
      organizationDetails: { findById: touchedAfterGuard.organizationDetails },
      catalogProductRead: { findByIds: touchedAfterGuard.findByIds },
      catalogProductAvailability: { filterAvailable: touchedAfterGuard.findByIds },
      pricingService: { resolveLinePrice: touchedAfterGuard.resolveLinePrice },
      orderService: {
        assertMethodsAllowedForOrganization: touchedAfterGuard.assertMethodsAllowedForOrganization,
      },
      salesChannelMembership: { listChannelsForEntity },
    } as unknown as OrdersDeps;
    app = Fastify();
    app.setValidatorCompiler(() => (data) => ({ value: data }));
    app.setSerializerCompiler(() => (data) => JSON.stringify(data));
    await registerOrderRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['a channel the Organization is not assigned to', UNASSIGNED_ID],
    ['an inactive channel the Organization is assigned to', INACTIVE_ID],
    ['an id naming no channel', '00000000-0000-4000-8000-00000000dead'],
  ])('refuses %s with 422 ORDER_SALES_CHANNEL_NOT_ALLOWED and evaluates no line', async (_label, channelId) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      payload: {
        customerAccountId: CUSTOMER_ID,
        salesChannelId: channelId,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
      },
    });

    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { code: string }).code).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
    expect(listChannelsForEntity).toHaveBeenCalledWith('organization', ORGANIZATION_ID);
    for (const fn of Object.values(touchedAfterGuard)) expect(fn).not.toHaveBeenCalled();
  });
});
