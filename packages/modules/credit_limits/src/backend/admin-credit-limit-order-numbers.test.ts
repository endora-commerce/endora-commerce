import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  OrderReadPort,
  OrderRecord,
  OrganizationDetailsPort,
  OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import { registerCreditLimitsRoutes } from './routes.js';
import type { CreditLimitService } from './services/credit-limit-service.js';
import type { CreditLimit } from './entities/credit-limit.entity.js';
import type { CreditLimitReservation } from './entities/credit-limit-reservation.entity.js';

/**
 * Issue #1178 (item 1) — the admin credit-limit screen showed the first eight
 * characters of a reservation's order database id. The admin views now answer
 * each reservation's customer-facing order number (`orderBusinessId`), as the
 * buyer's view has since issue #661, and they ask `orders` for it **once per
 * request**: the list of every granted limit makes one batched order read for
 * the reservations of all of them, never one per limit or per reservation.
 */

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000ab';
const ORDER_1 = '00000000-0000-4000-8000-0000000000c1';
const ORDER_2 = '00000000-0000-4000-8000-0000000000c2';
const ORDER_3 = '00000000-0000-4000-8000-0000000000c3';
const GONE = '00000000-0000-4000-8000-0000000000c9';

function limit(id: string, organizationId: string): CreditLimit {
  return {
    id,
    organizationId,
    grantedAmount: '1000.00',
    currency: 'PLN',
    createdAt: new Date('2026-08-17T10:00:00.000Z'),
  } as unknown as CreditLimit;
}

const LIMIT_A = limit('11111111-0000-4000-8000-000000000001', ORG_A);
const LIMIT_B = limit('11111111-0000-4000-8000-000000000002', ORG_B);

function reservation(orderId: string, amount: string): CreditLimitReservation {
  return { orderId, amount, createdAt: new Date('2026-10-01T00:00:00.000Z') } as CreditLimitReservation;
}

const RESERVATIONS: Record<string, CreditLimitReservation[]> = {
  [LIMIT_A.id]: [reservation(ORDER_1, '100.00'), reservation(ORDER_2, '50.00')],
  [LIMIT_B.id]: [reservation(ORDER_3, '25.00'), reservation(GONE, '10.00')],
};

const ORDERS: Record<string, Pick<OrderRecord, 'id' | 'businessId'>> = {
  [ORDER_1]: { id: ORDER_1, businessId: 'ORD-0001-2026' },
  [ORDER_2]: { id: ORDER_2, businessId: 'ORD-0002-2026' },
  [ORDER_3]: { id: ORDER_3, businessId: 'ORD-0003-2026' },
};

async function build(
  reservations: Record<string, CreditLimitReservation[]> = RESERVATIONS,
): Promise<{ app: FastifyInstance; findByIds: string[][] }> {
  const findByIds: string[][] = [];
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerCreditLimitsRoutes(app, {
    creditLimitService: {
      listAll: async () => [LIMIT_A, LIMIT_B],
      getForOrganization: async (orgId: string) => (orgId === ORG_A ? LIMIT_A : orgId === ORG_B ? LIMIT_B : null),
      listActiveReservations: async (limitId: string) => reservations[limitId] ?? [],
    } as unknown as CreditLimitService,
    organizationDetailsPort: {
      findByIds: async () => [],
    } as unknown as OrganizationDetailsPort,
    organizationPermissionPort: {} as OrganizationPermissionPort,
    orderReadPort: {
      findByIds: async (ids) => {
        findByIds.push([...ids]);
        return ids.flatMap((id) => (ORDERS[id] ? [ORDERS[id] as OrderRecord] : []));
      },
    } as OrderReadPort,
    requireCustomer: async () => {},
    requireAdmin: () => async () => {},
    resolveCustomerContext: () => ({ customerAccountId: 'x', organizationId: ORG_A }),
    resolveAdminUserId: () => 'admin',
  });
  await app.ready();
  return { app, findByIds };
}

type Reservations = Array<{ orderId: string; orderBusinessId?: string | null }>;

describe('admin credit-limit views — reservation order numbers (issue #1178)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /api/v1/admin/credit-limits answers every number in one order read for the page', async () => {
    const built = await build();
    app = built.app;
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits' });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Array<{ organizationId: string; activeReservations: Reservations }> }).data;
    expect(data.map((l) => l.activeReservations.map((r) => r.orderBusinessId))).toEqual([
      ['ORD-0001-2026', 'ORD-0002-2026'],
      ['ORD-0003-2026', null],
    ]);
    expect(built.findByIds).toEqual([[ORDER_1, ORDER_2, ORDER_3, GONE]]);
  });

  it('GET /api/v1/admin/organizations/:id/credit-limit answers each number in one order read', async () => {
    const built = await build();
    app = built.app;
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${ORG_A}/credit-limit`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { activeReservations: Reservations } }).data;
    expect(data.activeReservations.map((r) => r.orderBusinessId)).toEqual(['ORD-0001-2026', 'ORD-0002-2026']);
    expect(built.findByIds).toEqual([[ORDER_1, ORDER_2]]);
  });

  it('asks orders nothing when no listed limit holds a reservation', async () => {
    const built = await build({});
    app = built.app;
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits' });
    expect(res.statusCode, res.body).toBe(200);
    expect(built.findByIds).toEqual([]);
  });
});
