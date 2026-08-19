// Issue #78 — the shipment-created notifier used to throw the send outcome away.
//
// `notify` answered `void`, and so a parcel whose customer was never told read
// exactly like one whose customer was. The subscriber that calls this has no
// result to inspect, so the log carries the answer for the operator and the
// return value carries it for a caller and for this test.

import { describe, expect, it } from 'vitest';
import type {
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrderReadPort,
  OrderRecord,
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

/**
 * Feature 075 Phase C — the notifier's `EntityManager` refuses every entity but
 * `SalesChannel`.
 *
 * The order and the buyer used to come out of `em.findOne(Order, …)` and
 * `em.findOne(CustomerAccount, …)`: two of somebody else's tables, queried on
 * this module's connection, answering rows whatever state their owner was in.
 * They come from `orderReadPort` and `customerAccountReadPort` now, so the only
 * entity left is the kernel's `SalesChannel`.
 *
 * The refusal is the assertion. A stub that quietly returned `null` for a
 * foreign entity would let the read creep back and be read as "no such order";
 * this one names the module that was queried directly.
 */
function fakeEmFactory(channel: unknown): ShipmentEmailNotifierDeps['emFactory'] {
  return () =>
    ({
      async findOne(entity: { name: string }) {
        if (entity.name !== 'SalesChannel') {
          throw new Error(
            `shipments queried '${entity.name}' directly — it belongs to another module, ` +
              'and its owner publishes a port for it (feature 075, FR-012).',
          );
        }
        return channel;
      },
    }) as unknown as ReturnType<ShipmentEmailNotifierDeps['emFactory']>;
}

function orderReadPort(order: OrderRecord | null): OrderReadPort {
  return {
    findById: async () => order,
    findByIds: async () => (order ? [order] : []),
    listAll: async () => (order ? [order] : []),
    listItems: async () => [],
    findIdsByBusinessIdLike: async () => [],
  };
}

function customerAccountReadPort(customer: CustomerAccountRecord | null): CustomerAccountReadPort {
  return {
    findById: async () => customer,
    findByIds: async () => (customer ? [customer] : []),
  } as unknown as CustomerAccountReadPort;
}

function notifier(
  sender: TransactionalEmailSender | undefined,
  logged: Logged[],
  rows: {
    order?: OrderRecord | null;
    customer?: CustomerAccountRecord | null;
    channel?: unknown;
  } = {},
): ShipmentEmailNotifier {
  const order = {
    id: ORDER_ID,
    businessId: 'ORD-2',
    salesChannelId: CHANNEL_ID,
    placedByCustomerAccountId: 'customer-1',
  } as unknown as OrderRecord;
  const customer = { id: 'customer-1', email: 'buyer@example.com' } as unknown as CustomerAccountRecord;
  return new ShipmentEmailNotifier({
    emFactory: fakeEmFactory(
      'channel' in rows ? rows.channel : { id: CHANNEL_ID, defaultLanguage: 'en-US' },
    ),
    orderRead: orderReadPort('order' in rows ? (rows.order ?? null) : order),
    customerAccountRead: customerAccountReadPort(
      'customer' in rows ? (rows.customer ?? null) : customer,
    ),
    getTransactionalEmailSender: () => sender,
    log: (message, context) => logged.push({ message, context }),
  });
}

describe('shipments — the shipment-created notifier reports what happened (#78)', () => {
  it('reports a delivered e-mail and logs nothing', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender();

    await expect(notifier(sender, logged).notify(ORDER_ID, SHIPMENT_ID, 'pending')).resolves.toEqual({
      sent: true,
    });
    expect(sender.sent).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  /**
   * Issue #250 — the send that must not happen. A `pending_manual` shipment is
   * one no carrier was ever asked for, so "your order has shipped" would name
   * a parcel nobody is carrying. The sender is a working one here on purpose:
   * the refusal has to come from the shipment's state, not from the plumbing
   * being absent, or the test would pass for the wrong reason.
   */
  it('sends nothing for a shipment no carrier was asked for, and says which reason it was', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender();

    await expect(
      notifier(sender, logged).notify(ORDER_ID, SHIPMENT_ID, 'pending_manual'),
    ).resolves.toEqual({ sent: false, reason: 'carrier_not_contacted' });
    expect(sender.sent).toHaveLength(0);
    expect(logged[0]!.context).toMatchObject({
      orderId: ORDER_ID,
      shipmentId: SHIPMENT_ID,
      reason: 'carrier_not_contacted',
    });
  });

  it('reports the e-mail the operator switched off', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender({ status: 'deactivated' }), logged).notify(ORDER_ID, SHIPMENT_ID, 'pending'),
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
        'pending',
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_transport' });
    expect(logged).toHaveLength(1);
  });

  it('reports the absence of a sender rather than a silent return', async () => {
    const logged: Logged[] = [];

    await expect(notifier(undefined, logged).notify(ORDER_ID, SHIPMENT_ID, 'pending')).resolves.toEqual({
      sent: false,
      reason: 'no_sender',
    });
    expect(logged).toHaveLength(1);
  });

  it('separates "no recipient" from a delivered message', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender(), logged, {
        customer: { id: 'customer-1', email: null } as unknown as CustomerAccountRecord,
      }).notify(ORDER_ID, SHIPMENT_ID, 'pending'),
    ).resolves.toEqual({ sent: false, reason: 'no_recipient' });
  });

  it('reports an order the read port cannot find', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender(), logged, { order: null }).notify(ORDER_ID, SHIPMENT_ID, 'pending'),
    ).resolves.toEqual({ sent: false, reason: 'order_not_found' });
  });

  it('lets a switched-off order module refuse rather than reading its table', async () => {
    const logged: Logged[] = [];
    const refusing: OrderReadPort = {
      findById: async () => {
        throw new ModuleDisabledError('orders');
      },
      findByIds: async () => [],
      listAll: async () => [],
      listItems: async () => [],
      findIdsByBusinessIdLike: async () => [],
    };

    const subject = new ShipmentEmailNotifier({
      emFactory: fakeEmFactory({ id: CHANNEL_ID, defaultLanguage: 'en-US' }),
      orderRead: refusing,
      customerAccountRead: customerAccountReadPort(null),
      getTransactionalEmailSender: () => new CapturingSender(),
      log: (message, context) => logged.push({ message, context }),
    });

    await expect(subject.notify(ORDER_ID, SHIPMENT_ID, 'pending')).rejects.toBeInstanceOf(ModuleDisabledError);
    // Not logged as `failed`: a capability that is off is not a send that broke.
    expect(logged).toHaveLength(0);
  });

  it('contains a throwing send but names it in the result and the log', async () => {
    const logged: Logged[] = [];
    const throwing: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new Error('smtp down');
      },
    };

    await expect(notifier(throwing, logged).notify(ORDER_ID, SHIPMENT_ID, 'pending')).resolves.toEqual({
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
      notifier(disabled, logged).notify(ORDER_ID, SHIPMENT_ID, 'pending'),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
