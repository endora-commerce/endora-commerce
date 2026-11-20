import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import type { OrderPaymentStatus } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { Order } from '../entities/order.entity.js';
import { OrderPaymentStatusApplyService } from './order-payment-status-apply-port.js';
import type { OrderTransitionEffectService } from './order-transition-effect-service.js';

const ORDER_ID = '00000000-0000-4000-8000-000000000001';

function fakeOrder(
  paymentMethodSnapshot: { kind?: string } | null = { kind: 'credit_limit' },
  paymentStatus: OrderPaymentStatus = 'deferred',
) {
  return { id: ORDER_ID, organizationId: 'org-1', status: 'new', paymentMethodSnapshot, paymentStatus };
}

type FindOneCall = {
  entity: unknown;
  where: { id: string };
  options: { lockMode: LockMode; refresh: boolean };
};

function fakeEm(order: ReturnType<typeof fakeOrder> | null, calls: FindOneCall[] = []) {
  return {
    findOne: async (entity: unknown, where: { id: string }, options: FindOneCall['options']) => {
      calls.push({ entity, where, options });
      return order;
    },
  } as unknown as EntityManager;
}

function makeTransitionEffects(record: (...args: unknown[]) => Promise<number>) {
  return { record } as unknown as OrderTransitionEffectService;
}

describe('OrderPaymentStatusApplyService', () => {
  it('records owed effects on the same em when a credit-limit order is marked paid', async () => {
    const order = fakeOrder();
    const calls: FindOneCall[] = [];
    const em = fakeEm(order, calls);
    const recordArgs: unknown[] = [];
    const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async (...args) => {
      recordArgs.push(...args);
      return 1;
    }));

    const result = await port.applyPaymentStatus(em, { orderId: ORDER_ID, paymentStatus: 'paid' });

    expect(result).toEqual({
      orderId: ORDER_ID, status: 'new', paymentStatus: 'paid', outcome: 'applied', owesEffects: true,
    });
    expect(order.paymentStatus).toBe('paid');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.entity).toBe(Order);
    expect(calls[0]!.where).toEqual({ id: ORDER_ID });
    expect(calls[0]!.options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    expect(recordArgs[0]).toBe(em);
    expect(recordArgs[1]).toBe(order);
    expect(recordArgs[2]).toEqual([{ effect: 'credit.release', reason: 'invoice_paid' }]);
    expect(recordArgs[3]).toBe('transition');
  });

  it('still owes effects when record() inserts 0 rows (ON CONFLICT DO NOTHING)', async () => {
    const order = fakeOrder();
    const em = fakeEm(order);
    const recordArgs: unknown[] = [];
    const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async (...args) => {
      recordArgs.push(...args);
      return 0;
    }));

    const result = await port.applyPaymentStatus(em, { orderId: ORDER_ID, paymentStatus: 'paid' });

    expect(result).toMatchObject({ outcome: 'applied', owesEffects: true });
    expect(recordArgs[0]).toBe(em);
    expect(recordArgs[1]).toBe(order);
    expect(recordArgs[2]).toEqual([{ effect: 'credit.release', reason: 'invoice_paid' }]);
    expect(recordArgs[3]).toBe('transition');
  });

  it.each([{ kind: 'bank_transfer' }, null])(
    'owes nothing and does not record without a credit-limit snapshot (%j)',
    async (snapshot) => {
      const order = fakeOrder(snapshot);
      let recordCalled = false;
      const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async () => {
        recordCalled = true;
        return 1;
      }));

      const result = await port.applyPaymentStatus(fakeEm(order), { orderId: ORDER_ID, paymentStatus: 'paid' });

      expect(result).toMatchObject({ outcome: 'applied', paymentStatus: 'paid', owesEffects: false });
      expect(recordCalled).toBe(false);
    },
  );

  it('owes nothing and does not record when a paid credit-limit order is refunded', async () => {
    const order = fakeOrder({ kind: 'credit_limit' }, 'paid');
    let recordCalled = false;
    const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async () => {
      recordCalled = true;
      return 1;
    }));

    const result = await port.applyPaymentStatus(fakeEm(order), { orderId: ORDER_ID, paymentStatus: 'refunded' });

    expect(result).toMatchObject({ outcome: 'applied', paymentStatus: 'refunded', owesEffects: false });
    expect(recordCalled).toBe(false);
  });

  it('returns null and does not record when the order is missing', async () => {
    const calls: FindOneCall[] = [];
    const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async () => {
      throw new Error('record must not be called for a missing order');
    }));

    const result = await port.applyPaymentStatus(fakeEm(null, calls), { orderId: ORDER_ID, paymentStatus: 'paid' });

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.entity).toBe(Order);
    expect(calls[0]!.where).toEqual({ id: ORDER_ID });
  });

  it.each([
    ['paid', 'unchanged'],
    ['refunded', 'refused'],
  ] as const)('owes nothing and does not record for %s -> paid (%s)', async (from, outcome) => {
    const order = fakeOrder({ kind: 'credit_limit' }, from);
    let recordCalled = false;
    const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async () => {
      recordCalled = true;
      return 1;
    }));

    const result = await port.applyPaymentStatus(fakeEm(order), { orderId: ORDER_ID, paymentStatus: 'paid' });

    expect(result).toMatchObject({ outcome, paymentStatus: from, owesEffects: false });
    expect(order.paymentStatus).toBe(from);
    expect(recordCalled).toBe(false);
  });

  it('returns null for a non-UUID orderId without looking up or recording anything', async () => {
    const calls: FindOneCall[] = [];
    const port = new OrderPaymentStatusApplyService(makeTransitionEffects(async () => {
      throw new Error('record must not be called for an invalid order id');
    }));

    const result = await port.applyPaymentStatus(fakeEm(fakeOrder(), calls), { orderId: 'ord-invalid', paymentStatus: 'paid' });

    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });
});
