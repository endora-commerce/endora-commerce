import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreditLimitReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_CREDIT_LIMIT_ORDER_ID,
  seedCreditLimitWithActiveReservation,
} from '../../helpers/seed-credit-limit.js';

/**
 * `CreditLimitReadPort.activeReservationsForOrders`
 * (`specs/142-order-transition-atomicity/`, D9).
 *
 * `orders`' repair command has to learn which cancelled or paid orders still
 * hold credit before it proposes to release anything, and it may not read
 * `credit_limit_reservations` itself. This is the owner answering.
 */
describe('creditLimitReadPort.activeReservationsForOrders (spec 142, D9)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const port = (): CreditLimitReadPort =>
    h.container.resolve('creditLimitReadPort') as CreditLimitReadPort;

  it('answers the active reservation of an order, with its amount as stored', async () => {
    const held = await port().activeReservationsForOrders([SEED_CREDIT_LIMIT_ORDER_ID]);

    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ orderId: SEED_CREDIT_LIMIT_ORDER_ID, currency: 'PLN' });
    // The decimal string the row stores, never a float.
    expect(held[0]!.amount).toMatch(/^\d+\.\d{2}$/);
  });

  it('leaves an order with no reservation out of the answer', async () => {
    const stranger = randomUUID();
    const held = await port().activeReservationsForOrders([stranger, SEED_CREDIT_LIMIT_ORDER_ID]);

    expect(held.map((r) => r.orderId)).toEqual([SEED_CREDIT_LIMIT_ORDER_ID]);
  });

  it('answers the empty list for no orders', async () => {
    expect(await port().activeReservationsForOrders([])).toEqual([]);
  });

  it('leaves out a reservation that has been released', async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `update "credit_limit_reservations"
            set "status" = 'released', "released_at" = now(), "released_reason" = 'order_cancelled'
          where "order_id" = ?`,
        [SEED_CREDIT_LIMIT_ORDER_ID],
      );

    expect(await port().activeReservationsForOrders([SEED_CREDIT_LIMIT_ORDER_ID])).toEqual([]);
  });
});
