import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  createPushEventHandlers,
  type PushEventLogger,
} from '../../../../packages/modules/pwa/src/backend/services/push-event-subscriber.js';
import type {
  OrderStatusPushEvent,
  StatusPushComposer,
} from '../../../../packages/modules/pwa/src/backend/services/status-push-composer.js';

/**
 * The automatic status pushes absorb their own failures on purpose: a push is
 * best-effort and must not break the transaction that announced itself
 * (`specs/149-pwa-order-status-push/` FR-015). That tolerance used to absorb a
 * **presence** answer too — `PushMessageService` resolves `customer_accounts`
 * and `organizations` through gated ports, so a send can raise
 * `ModuleDisabledError`, and the handler turned it into the same `console.warn`
 * as a dropped database connection.
 *
 * "No push" is the right outcome for both. Sharing one silent no-op is not:
 * one is an operator's own switch doing what it says, the other is an incident.
 * These cases pin the two apart, and pin what a malformed payload does:
 * nothing, and no error line. The quote trigger is gone since
 * `specs/179-rfq-and-customer-notifications/` WP-10 (FR-061); quote pushes go
 * through `customerPushPort`, whose caller keeps the outcome on a record.
 */

interface Recorded {
  readonly level: 'debug' | 'warn' | 'error';
  readonly fields: Record<string, unknown>;
  readonly event: string;
}

function recordingLogger(): { logger: PushEventLogger; lines: Recorded[] } {
  const lines: Recorded[] = [];
  const push =
    (level: Recorded['level']) =>
    (fields: object, event: string): void => {
      lines.push({ level, fields: fields as Record<string, unknown>, event });
    };
  return {
    logger: {
      info: () => {},
      debug: push('debug'),
      warn: push('warn'),
      error: push('error'),
    } as unknown as PushEventLogger,
    lines,
  };
}

interface Calls {
  orders: OrderStatusPushEvent[];
}

function handlersWith(
  fail: () => Promise<never>,
  logger: PushEventLogger,
  calls: Calls = { orders: [] },
): ReturnType<typeof createPushEventHandlers> {
  const composer: StatusPushComposer = {
    order: async (event) => {
      calls.orders.push(event);
      return fail();
    },
  };
  return createPushEventHandlers({ composer, log: () => logger });
}

const ORDER_EVENT = {
  eventId: 'evt-1',
  orderId: 'ord-1',
  salesChannelId: 'ch-1',
  from: 'paid',
  to: 'shipment_sent',
};

describe('pwa status pushes — a switched-off owner is not a failure', () => {
  it('records an order-status push skipped by a disabled module, naming the module', async () => {
    const { logger, lines } = recordingLogger();
    const handlers = handlersWith(async () => {
      throw new ModuleDisabledError('customer_accounts');
    }, logger);

    await expect(handlers.onOrderStatusChanged(ORDER_EVENT)).resolves.toBeUndefined();

    expect(lines).toHaveLength(1);
    expect(lines[0]?.event).toBe('pwa.push_skipped_module_disabled');
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.fields).toMatchObject({
      module: 'customer_accounts',
      trigger: 'order_status',
      eventId: 'evt-1',
    });
  });

  it('keeps a transient failure separate — a different event name, at error level', async () => {
    const { logger, lines } = recordingLogger();
    const handlers = handlersWith(async () => {
      throw new Error('connection terminated unexpectedly');
    }, logger);

    await expect(handlers.onOrderStatusChanged(ORDER_EVENT)).resolves.toBeUndefined();

    expect(lines.map((l) => [l.level, l.event])).toEqual([['error', 'pwa.push_enqueue_failed']]);
    expect(lines[0]?.fields).not.toHaveProperty('module');
    expect(lines[0]?.fields).toMatchObject({ trigger: 'order_status', eventId: 'evt-1' });
  });

  it('hands the composer what it needs', async () => {
    const { logger } = recordingLogger();
    const calls: Calls = { orders: [] };
    const handlers = handlersWith(async () => 'enqueued' as never, logger, calls);

    await handlers.onOrderStatusChanged(ORDER_EVENT);

    expect(calls.orders).toEqual([{ eventId: 'evt-1', orderId: 'ord-1', to: 'shipment_sent' }]);
  });

  it('drops a payload missing what it needs, without an error line', async () => {
    const { logger, lines } = recordingLogger();
    const calls: Calls = { orders: [] };
    const handlers = handlersWith(async () => 'enqueued' as never, logger, calls);

    await handlers.onOrderStatusChanged({ ...ORDER_EVENT, eventId: undefined });
    await handlers.onOrderStatusChanged({ ...ORDER_EVENT, orderId: 42 });
    await handlers.onOrderStatusChanged({ ...ORDER_EVENT, to: '' });
    await handlers.onOrderStatusChanged(null);
    await handlers.onOrderStatusChanged('not an object');

    expect(calls).toEqual({ orders: [] });
    expect(lines.filter((l) => l.level === 'error')).toEqual([]);
  });
});
