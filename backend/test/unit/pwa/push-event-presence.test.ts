import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import type { PushMessageService } from '../../../../packages/modules/pwa/src/backend/services/push-message-service.js';
import {
  createPushEventHandlers,
  type PushEventLogger,
  type PushEventTarget,
} from '../../../../packages/modules/pwa/src/backend/services/push-event-subscriber.js';

/**
 * The FR-024 auto-triggers absorb their own failures on purpose: a push is
 * best-effort and must not break the transaction that announced itself. That
 * tolerance used to absorb a **presence** answer too — `PushMessageService`
 * resolves `customer_accounts` and `organizations` through gated ports, so a
 * rule-targeted send raises `ModuleDisabledError`, and the handler turned it
 * into the same `console.warn` as a dropped database connection.
 *
 * "No push" is the right outcome for both. Sharing one silent no-op is not:
 * one is an operator's own switch doing what it says, the other is an incident.
 * These cases pin the two apart, at the two seams the subscriber owns.
 */

interface Recorded {
  readonly level: 'warn' | 'error';
  readonly fields: Record<string, unknown>;
  readonly event: string;
}

function recordingLogger(): { logger: PushEventLogger; lines: Recorded[] } {
  const lines: Recorded[] = [];
  const push =
    (level: 'warn' | 'error') =>
    (fields: object, event: string): void => {
      lines.push({ level, fields: fields as Record<string, unknown>, event });
    };
  return {
    logger: { info: () => {}, warn: push('warn'), error: push('error') },
    lines,
  };
}

const TARGET: PushEventTarget = {
  salesChannelId: 'ch-1',
  customerAccountId: 'cust-1',
  title: 'Order update',
  body: 'Order B-1 is now shipped.',
};

function handlersWith(
  createAndEnqueue: () => Promise<never>,
  logger: PushEventLogger,
): ReturnType<typeof createPushEventHandlers> {
  return createPushEventHandlers({
    messageService: {
      createAndEnqueue,
    } as unknown as PushMessageService,
    resolveOrderTarget: async () => TARGET,
    resolveQuoteTarget: async () => TARGET,
    isPushEnabled: async () => true,
    log: () => logger,
  });
}

const ORDER_EVENT = {
  eventId: 'evt-1',
  orderId: 'ord-1',
  salesChannelId: 'ch-1',
  from: 'paid',
  to: 'shipped',
};

const QUOTE_EVENT = { eventId: 'evt-2', quoteRequestId: 'qr-1' };

describe('pwa FR-024 auto-triggers — a switched-off owner is not a failure', () => {
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

  it('records a quote-request push skipped by a disabled module, naming the module', async () => {
    const { logger, lines } = recordingLogger();
    const handlers = handlersWith(async () => {
      throw new ModuleDisabledError('organizations');
    }, logger);

    await expect(handlers.onQuoteRequestUpdated(QUOTE_EVENT)).resolves.toBeUndefined();

    expect(lines).toHaveLength(1);
    expect(lines[0]?.event).toBe('pwa.push_skipped_module_disabled');
    expect(lines[0]?.fields).toMatchObject({
      module: 'organizations',
      trigger: 'quote_request',
      eventId: 'evt-2',
    });
  });

  it('keeps a transient failure separate — a different event name, at error level', async () => {
    const { logger, lines } = recordingLogger();
    const handlers = handlersWith(async () => {
      throw new Error('connection terminated unexpectedly');
    }, logger);

    await expect(handlers.onOrderStatusChanged(ORDER_EVENT)).resolves.toBeUndefined();

    expect(lines).toHaveLength(1);
    expect(lines[0]?.event).toBe('pwa.push_enqueue_failed');
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.fields).not.toHaveProperty('module');
  });

  it('still absorbs both, so the announcing transaction is never broken', async () => {
    const { logger } = recordingLogger();
    const disabled = handlersWith(async () => {
      throw new ModuleDisabledError('organizations');
    }, logger);
    const broken = handlersWith(async () => {
      throw new Error('boom');
    }, logger);

    await expect(disabled.onOrderStatusChanged(ORDER_EVENT)).resolves.toBeUndefined();
    await expect(broken.onQuoteRequestUpdated(QUOTE_EVENT)).resolves.toBeUndefined();
  });
});
