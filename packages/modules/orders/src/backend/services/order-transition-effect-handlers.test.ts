import { describe, expect, it, vi } from 'vitest';
import {
  createOrderTransitionEffectHandlers,
  type OrderTransitionEffectHandlerDeps,
} from './order-transition-effect-handlers.js';

/**
 * The two follow-up handlers (`specs/142-order-transition-atomicity/`, D2, D3).
 *
 * The property that matters most is the first one in each block: with the
 * owning module absent, the port is **not touched** — not resolved, not called
 * — and the answer is a value. A handler that resolved the gated port first
 * would raise `ModuleDisabledError` out of a path that has just committed a
 * status, which is the defect this feature closes.
 */

const ORDER_ID = '00000000-0000-4000-8000-000000000a01';

function deps(overrides: Partial<OrderTransitionEffectHandlerDeps> = {}) {
  const releaseByOrder = vi.fn(async () => ({ ok: true, reservationId: 'r1' }) as unknown);
  const releaseStock = vi.fn(async () => ({ released: 2 }));
  const creditLimit = vi.fn(() => ({ releaseByOrder }));
  const base: OrderTransitionEffectHandlerDeps = {
    isPresent: () => true,
    creditLimit: creditLimit as unknown as OrderTransitionEffectHandlerDeps['creditLimit'],
    releaseStock,
  };
  return { deps: { ...base, ...overrides }, releaseByOrder, releaseStock, creditLimit };
}

describe('credit.release', () => {
  it('answers `blocked` without touching the port while `credit_limits` is absent', async () => {
    const d = deps({ isPresent: (id) => id !== 'credit_limits' });
    const handlers = createOrderTransitionEffectHandlers(d.deps);

    const outcome = await handlers['credit.release']({ orderId: ORDER_ID, reason: 'order_cancelled' });

    expect(outcome).toEqual({ outcome: 'blocked', moduleId: 'credit_limits' });
    expect(d.creditLimit).not.toHaveBeenCalled();
    expect(d.releaseByOrder).not.toHaveBeenCalled();
  });

  it('calls the port once, with the order and the reason the row carries', async () => {
    const d = deps();
    const handlers = createOrderTransitionEffectHandlers(d.deps);

    const outcome = await handlers['credit.release']({ orderId: ORDER_ID, reason: 'invoice_paid' });

    expect(d.releaseByOrder).toHaveBeenCalledTimes(1);
    expect(d.releaseByOrder).toHaveBeenCalledWith({ orderId: ORDER_ID, reason: 'invoice_paid' });
    expect(outcome).toEqual({ outcome: 'done', result: { ok: true } });
  });

  it.each(['ALREADY_RELEASED', 'RESERVATION_NOT_FOUND'])(
    'treats %s as done — there is nothing left to release',
    async (code) => {
      const d = deps();
      d.releaseByOrder.mockResolvedValueOnce({ ok: false, code });
      const handlers = createOrderTransitionEffectHandlers(d.deps);

      const outcome = await handlers['credit.release']({
        orderId: ORDER_ID,
        reason: 'order_cancelled',
      });

      expect(outcome).toEqual({ outcome: 'done', result: { ok: false, code } });
    },
  );

  it('lets a failure of the port propagate, so the caller records an attempt', async () => {
    const d = deps();
    d.releaseByOrder.mockRejectedValueOnce(new Error('lock timeout'));
    const handlers = createOrderTransitionEffectHandlers(d.deps);

    await expect(
      handlers['credit.release']({ orderId: ORDER_ID, reason: 'order_cancelled' }),
    ).rejects.toThrow('lock timeout');
  });
});

describe('stock.release', () => {
  it('answers `blocked` without touching the port while `inventory` is absent', async () => {
    const d = deps({ isPresent: (id) => id !== 'inventory' });
    const handlers = createOrderTransitionEffectHandlers(d.deps);

    const outcome = await handlers['stock.release']({ orderId: ORDER_ID, reason: 'order_cancelled' });

    expect(outcome).toEqual({ outcome: 'blocked', moduleId: 'inventory' });
    expect(d.releaseStock).not.toHaveBeenCalled();
  });

  it('releases once and reports how many allocations it released', async () => {
    const d = deps();
    const handlers = createOrderTransitionEffectHandlers(d.deps);

    const outcome = await handlers['stock.release']({ orderId: ORDER_ID, reason: 'order_cancelled' });

    expect(d.releaseStock).toHaveBeenCalledTimes(1);
    expect(d.releaseStock).toHaveBeenCalledWith(ORDER_ID);
    expect(outcome).toEqual({ outcome: 'done', result: { released: 2 } });
  });

  it('completes as a no-op for an order that holds nothing', async () => {
    const d = deps();
    d.releaseStock.mockResolvedValueOnce({ released: 0 });
    const handlers = createOrderTransitionEffectHandlers(d.deps);

    expect(
      await handlers['stock.release']({ orderId: ORDER_ID, reason: 'order_cancelled' }),
    ).toEqual({ outcome: 'done', result: { released: 0 } });
  });
});
