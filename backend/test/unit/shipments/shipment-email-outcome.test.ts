// Issue #78 — the shipment-created notifier used to throw the send outcome away.
//
// `notify` answered `void`, and so a parcel whose customer was never told read
// exactly like one whose customer was. The subscriber that calls this has no
// result to inspect, so the log carries the answer for the operator and the
// return value carries it for a caller and for this test.

import { describe, expect, it } from 'vitest';
import type {
  TransactionalEmailSendInput,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@b2b/contracts';
import {
  ShipmentEmailNotifier,
  type ShipmentEmailNotifierDeps,
} from '../../../src/modules/shipments/services/shipment-email-notifier.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';

const ORDER_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SHIPMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const CHANNEL_ID = 'bbbbbbbb-0000-4000-8000-0000000000aa';

interface Logged {
  message: string;
  context: Record<string, unknown>;
}

class CapturingSender implements TransactionalEmailSender {
  readonly sent: TransactionalEmailSendInput[] = [];
  constructor(private readonly outcome: TransactionalSendOutcome = { status: 'sent' }) {}
  async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
    this.sent.push(input);
    return this.outcome;
  }
}

function fakeEmFactory(rows: {
  order?: unknown;
  customer?: unknown;
  channel?: unknown;
}): ShipmentEmailNotifierDeps['emFactory'] {
  return () =>
    ({
      async findOne(entity: { name: string }) {
        if (entity.name === 'Order') return rows.order ?? null;
        if (entity.name === 'CustomerAccount') return rows.customer ?? null;
        return rows.channel ?? null;
      },
    }) as unknown as ReturnType<ShipmentEmailNotifierDeps['emFactory']>;
}

function notifier(
  sender: TransactionalEmailSender | undefined,
  logged: Logged[],
  rows: { order?: unknown; customer?: unknown; channel?: unknown } = {},
): ShipmentEmailNotifier {
  return new ShipmentEmailNotifier({
    emFactory: fakeEmFactory({
      order: {
        id: ORDER_ID,
        businessId: 'ORD-2',
        salesChannelId: CHANNEL_ID,
        placedByCustomerAccountId: 'customer-1',
      },
      customer: { id: 'customer-1', email: 'buyer@example.com' },
      channel: { id: CHANNEL_ID, defaultLanguage: 'en-US' },
      ...rows,
    }),
    getTransactionalEmailSender: () => sender,
    log: (message, context) => logged.push({ message, context }),
  });
}

describe('shipments — the shipment-created notifier reports what happened (#78)', () => {
  it('reports a delivered e-mail and logs nothing', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender();

    await expect(notifier(sender, logged).notify(ORDER_ID, SHIPMENT_ID)).resolves.toEqual({
      sent: true,
    });
    expect(sender.sent).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it('reports the e-mail the operator switched off', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender({ status: 'deactivated' }), logged).notify(ORDER_ID, SHIPMENT_ID),
    ).resolves.toEqual({ sent: false, reason: 'deactivated' });
    expect(logged[0]!.context).toMatchObject({
      orderId: ORDER_ID,
      shipmentId: SHIPMENT_ID,
      reason: 'deactivated',
    });
  });

  it('reports a composition with no transport', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender({ status: 'no_transport' }), logged).notify(
        ORDER_ID,
        SHIPMENT_ID,
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_transport' });
    expect(logged).toHaveLength(1);
  });

  it('reports the absence of a sender rather than a silent return', async () => {
    const logged: Logged[] = [];

    await expect(notifier(undefined, logged).notify(ORDER_ID, SHIPMENT_ID)).resolves.toEqual({
      sent: false,
      reason: 'no_sender',
    });
    expect(logged).toHaveLength(1);
  });

  it('separates "no recipient" from a delivered message', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender(), logged, {
        customer: { id: 'customer-1', email: null },
      }).notify(ORDER_ID, SHIPMENT_ID),
    ).resolves.toEqual({ sent: false, reason: 'no_recipient' });
  });

  it('contains a throwing send but names it in the result and the log', async () => {
    const logged: Logged[] = [];
    const throwing: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new Error('smtp down');
      },
    };

    await expect(notifier(throwing, logged).notify(ORDER_ID, SHIPMENT_ID)).resolves.toEqual({
      sent: false,
      reason: 'failed',
    });
    expect(String(logged[0]!.context['error'])).toContain('smtp down');
  });

  it('lets a switched-off module through the tolerance', async () => {
    const logged: Logged[] = [];
    const disabled: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new ModuleDisabledError('transactional_emails');
      },
    };

    await expect(
      notifier(disabled, logged).notify(ORDER_ID, SHIPMENT_ID),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
