// Issue #78 — the order-scoped e-mail helper used to throw the send outcome away.
//
// `sendOrderTransactionalEmail` answered `void`, and all four order surfaces
// that send through it (`order_confirmation`, `order_comment`,
// `reorder_created`, `admin_created_order`) read that `void` the same way: as
// "handled — do not use the legacy in-code builder". Since issue #67 the sender
// distinguishes a delivered message from a deactivated template, a
// transport-less composition and a code with no definition; the helper dropped
// all three and each caller then returned as though the customer had been told.

import { describe, expect, it } from 'vitest';
import type {
  TransactionalEmailSendInput,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  orderEmailNotSent,
  sendOrderTransactionalEmail,
} from '../../../src/modules/orders/services/transactional-email-helper.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';

const ORDER_ID = 'dddddddd-0000-4000-8000-000000000001';
const CHANNEL_ID = 'dddddddd-0000-4000-8000-0000000000aa';

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

/** The one read the helper makes: the order's channel, for its default language. */
const em = {
  async findOne() {
    return { id: CHANNEL_ID, defaultLanguage: 'pl-PL' };
  },
} as unknown as EntityManager;

const order = { id: ORDER_ID, salesChannelId: CHANNEL_ID };

const message = {
  orderId: ORDER_ID,
  code: 'order_comment',
  to: 'buyer@example.com',
  messageId: 'order_comment:1',
  variables: { order: { businessId: 'ORD-1' } },
};

describe('orders — the order e-mail helper reports what happened (#78)', () => {
  it('reports a delivered e-mail, resolving the channel default language', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender();

    await expect(
      sendOrderTransactionalEmail(em, sender, order, message, (m, c) => logged.push({ message: m, context: c })),
    ).resolves.toEqual({ sent: true });
    expect(sender.sent[0]!.language).toBe('pl-PL');
    expect(logged).toHaveLength(0);
  });

  it('reports the e-mail the operator switched off', async () => {
    const logged: Logged[] = [];

    await expect(
      sendOrderTransactionalEmail(em, new CapturingSender({ status: 'deactivated' }), order, message, (m, c) =>
        logged.push({ message: m, context: c }),
      ),
    ).resolves.toEqual({ sent: false, reason: 'deactivated' });
    expect(logged[0]!.context).toMatchObject({
      orderId: ORDER_ID,
      code: 'order_comment',
      reason: 'deactivated',
    });
  });

  it('reports a composition with no transport', async () => {
    const logged: Logged[] = [];

    await expect(
      sendOrderTransactionalEmail(em, new CapturingSender({ status: 'no_transport' }), order, message, (m, c) =>
        logged.push({ message: m, context: c }),
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_transport' });
    expect(logged).toHaveLength(1);
  });

  it('reports a code with no definition', async () => {
    const logged: Logged[] = [];

    await expect(
      sendOrderTransactionalEmail(em, new CapturingSender({ status: 'no_definition' }), order, message, (m, c) =>
        logged.push({ message: m, context: c }),
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_definition' });
    expect(logged).toHaveLength(1);
  });

  it('contains a throwing send but names it in the result and the log', async () => {
    const logged: Logged[] = [];
    const throwing: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new Error('smtp down');
      },
    };

    await expect(
      sendOrderTransactionalEmail(em, throwing, order, message, (m, c) =>
        logged.push({ message: m, context: c }),
      ),
    ).resolves.toEqual({ sent: false, reason: 'failed' });
    expect(String(logged[0]!.context['error'])).toContain('smtp down');
  });

  it('lets a switched-off module through the tolerance', async () => {
    const disabled: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new ModuleDisabledError('transactional_emails');
      },
    };

    await expect(
      sendOrderTransactionalEmail(em, disabled, order, message),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

describe('orders — the reasons a caller reports without reaching the sender', () => {
  it('names them and writes them to the log', () => {
    const logged: Logged[] = [];
    const log = (m: string, c: Record<string, unknown>): number =>
      logged.push({ message: m, context: c });

    expect(orderEmailNotSent(log, { orderId: ORDER_ID, code: 'reorder_created' }, 'no_recipient')).toEqual({
      sent: false,
      reason: 'no_recipient',
    });
    expect(logged[0]!.context).toMatchObject({ code: 'reorder_created', reason: 'no_recipient' });
  });
});
