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
 * Issue #748 — the buyer's `GET /api/v1/me/credit-limit` lists the
 * reservations of the orders the buyer may read; the totals stay the
 * Organization's. The service-backed proof is
 * `backend/test/contract/credit_limits/me-credit-limit-reservation-scope.test.ts`;
 * this file pins the seam calls, which that one cannot see: a holder of
 * `orders.view_organization` is never narrowed and costs no order read, and an
 * empty limit asks neither port.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000aa';
const ME = '00000000-0000-4000-8000-0000000000b1';
const COLLEAGUE = '00000000-0000-4000-8000-0000000000b2';
const MY_ORDER = '00000000-0000-4000-8000-0000000000c1';
const THEIR_ORDER = '00000000-0000-4000-8000-0000000000c2';

const LIMIT = {
  id: '11111111-0000-4000-8000-000000000001',
  organizationId: ORG_ID,
  grantedAmount: '1000.00',
  currency: 'PLN',
  createdAt: new Date('2026-08-17T10:00:00.000Z'),
} as unknown as CreditLimit;

function reservation(orderId: string, amount: string): CreditLimitReservation {
  return { orderId, amount, createdAt: new Date('2026-10-01T00:00:00.000Z') } as CreditLimitReservation;
}

interface Calls {
  can: string[];
  findByIds: string[][];
}

async function build(
  reservations: CreditLimitReservation[],
  holds: boolean,
): Promise<{ app: FastifyInstance; calls: Calls }> {
  const calls: Calls = { can: [], findByIds: [] };
  const orders: Record<string, Pick<OrderRecord, 'id' | 'organizationId' | 'placedByCustomerAccountId'>> = {
    [MY_ORDER]: { id: MY_ORDER, organizationId: ORG_ID, placedByCustomerAccountId: ME },
    [THEIR_ORDER]: { id: THEIR_ORDER, organizationId: ORG_ID, placedByCustomerAccountId: COLLEAGUE },
  };
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerCreditLimitsRoutes(app, {
    creditLimitService: {
      getForOrganization: async () => LIMIT,
      listActiveReservations: async () => reservations,
    } as unknown as CreditLimitService,
    organizationDetailsPort: {} as OrganizationDetailsPort,
    organizationPermissionPort: {
      can: async (_subject, code) => {
        calls.can.push(code);
        return holds;
      },
    } as OrganizationPermissionPort,
    orderReadPort: {
      findByIds: async (ids) => {
        calls.findByIds.push([...ids]);
        return ids.flatMap((id) => (orders[id] ? [orders[id] as OrderRecord] : []));
      },
    } as OrderReadPort,
    requireCustomer: async () => {},
    requireAdmin: () => async () => {},
    resolveCustomerContext: () => ({ customerAccountId: ME, organizationId: ORG_ID }),
    resolveAdminUserId: () => ME,
  });
  await app.ready();
  return { app, calls };
}

describe('GET /api/v1/me/credit-limit — which reservations are listed (issue #748)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function get(built: { app: FastifyInstance }) {
    app = built.app;
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/me/credit-limit' });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as {
      data: { availableAmount: number; activeReservationCount: number; activeReservations: Array<{ orderId: string }> };
    }).data;
  }

  it('narrows a member without orders.view_organization to their own orders, keeping the totals', async () => {
    const built = await build([reservation(MY_ORDER, '100.00'), reservation(THEIR_ORDER, '250.00')], false);
    const data = await get(built);
    expect(data.activeReservations.map((r) => r.orderId)).toEqual([MY_ORDER]);
    expect(data.activeReservationCount).toBe(2);
    expect(data.availableAmount).toBe(650);
    expect(built.calls.can).toEqual(['orders.view_organization']);
    expect(built.calls.findByIds).toEqual([[MY_ORDER, THEIR_ORDER]]);
  });

  it('lists everything to a holder and reads no order', async () => {
    const built = await build([reservation(MY_ORDER, '100.00'), reservation(THEIR_ORDER, '250.00')], true);
    const data = await get(built);
    expect(data.activeReservations.map((r) => r.orderId)).toEqual([MY_ORDER, THEIR_ORDER]);
    expect(data.activeReservationCount).toBe(2);
    expect(built.calls.findByIds).toEqual([]);
  });

  it('asks neither port when the limit holds no reservation', async () => {
    const built = await build([], false);
    const data = await get(built);
    expect(data.activeReservations).toEqual([]);
    expect(data.activeReservationCount).toBe(0);
    expect(built.calls).toEqual({ can: [], findByIds: [] });
  });
});
