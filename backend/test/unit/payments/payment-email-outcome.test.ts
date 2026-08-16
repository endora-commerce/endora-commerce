// Issue #78 — the payment-status notifier used to throw the send outcome away.
//
// `notify` answered `void`. Four situations reached that same `void`: no sender
// wired, no order behind the id, no address on the customer, and a bare `catch`
// that absorbed everything the send raised — and, once `send` learned to report
// (issue #67), three more, because `deactivated`, `no_transport` and
// `no_definition` were dropped on the floor with the rest. The subscriber that
// calls this cannot look at a result, so the log is what carries the answer;
// the result is what a test and any future caller read.

import { describe, expect, it } from 'vitest';
import type {
  TransactionalEmailSendInput,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@b2b/contracts';
import {
  PaymentEmailNotifier,
  type PaymentEmailNotifierDeps,
} from '../../../src/modules/payments/services/payment-email-notifier.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';

const ORDER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHANNEL_ID = 'aaaaaaaa-0000-4000-8000-0000000000aa';

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
 * The three reads `notify` makes, keyed by entity so one fake serves all of
 * them. `null` for a key is that read finding nothing.
 */
function fakeEmFactory(rows: {
  order?: unknown;
  customer?: unknown;
  channel?: unknown;
}): PaymentEmailNotifierDeps['emFactory'] {
  return () =>
    ({
      async findOne(entity: { name: string }) {
        if (entity.name === 'Order') return rows.order ?? null;
        if (entity.name === 'CustomerAccount') return rows.customer ?? null;
        return rows.channel ?? null;
      },
    }) as unknown as ReturnType<PaymentEmailNotifierDeps['emFactory']>;
}

function notifier(
  sender: TransactionalEmailSender | undefined,
  logged: Logged[],
  rows: { order?: unknown; customer?: unknown; channel?: unknown } = {},
): PaymentEmailNotifier {
  return new PaymentEmailNotifier({
    emFactory: fakeEmFactory({
      order: {
        id: ORDER_ID,
        businessId: 'ORD-1',
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

describe('payments — the payment-status notifier reports what happened (#78)', () => {
  it('reports a delivered e-mail and logs nothing', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender();

    await expect(notifier(sender, logged).notify(ORDER_ID, 'paid', null)).resolves.toEqual({
      sent: true,
    });
    expect(sender.sent).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it('reports the e-mail the operator switched off, instead of looking delivered', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender({ status: 'deactivated' });

    await expect(notifier(sender, logged).notify(ORDER_ID, 'paid', null)).resolves.toEqual({
      sent: false,
      reason: 'deactivated',
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.context).toMatchObject({ orderId: ORDER_ID, reason: 'deactivated' });
  });

  it('reports a composition with no transport', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender({ status: 'no_transport' }), logged).notify(
        ORDER_ID,
        'failed',
        'card declined',
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_transport' });
    expect(logged[0]!.context).toMatchObject({ reason: 'no_transport' });
  });

  it('reports the absence of a sender rather than a silent return', async () => {
    const logged: Logged[] = [];

    await expect(notifier(undefined, logged).notify(ORDER_ID, 'paid', null)).resolves.toEqual({
      sent: false,
      reason: 'no_sender',
    });
    expect(logged).toHaveLength(1);
  });

  it('separates "no recipient" from a delivered message', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingSender(), logged, { customer: { id: 'customer-1', email: null } }).notify(
        ORDER_ID,
        'paid',
        null,
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_recipient' });
    expect(logged[0]!.context).toMatchObject({ reason: 'no_recipient' });
  });

  it('contains a throwing send but names it in the result and the log', async () => {
    const logged: Logged[] = [];
    const throwing: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new Error('smtp down');
      },
    };

    await expect(notifier(throwing, logged).notify(ORDER_ID, 'paid', null)).resolves.toEqual({
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

    // A presence answer is about the whole operation, not this one message:
    // absorbing it would report "nothing was sent" where the truthful answer is
    // "this capability is off".
    await expect(notifier(disabled, logged).notify(ORDER_ID, 'paid', null)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });
});
