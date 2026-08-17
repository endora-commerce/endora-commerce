// Issue #78 — the return notifier used to throw the send outcome away.
//
// `authorized` / `rejected` answered `void`. Reaching the transactional sender
// counted as done: the method returned right after the send whatever the send
// reported, so a deactivated template, a composition with no transport and a
// code with no definition were all indistinguishable from a delivered message —
// and from the legacy-builder path, which is the only one that actually put an
// e-mail somewhere in those cases.
//
// The legacy builder still runs only when no sender is wired at all. That is
// deliberately unchanged here: which message goes out is a product decision,
// not a reporting repair. What changes is that the caller can now see which of
// the two happened, and why nothing happened when nothing did.

import { describe, expect, it } from 'vitest';
import type {
  TransactionalEmailSendInput,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@b2b/contracts';
import { ReturnEmailNotifier } from '../../../src/modules/returns/services/return-email-notifier.js';
import type { ReturnCase } from '../../../src/modules/returns/entities/return-case.entity.js';
import type {
  Mailer,
  MailerSendInput,
  MailerSendOutcome,
} from '../../../src/modules/email/services/mailer.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';

const CHANNEL_ID = 'cccccccc-0000-4000-8000-0000000000aa';

interface Logged {
  message: string;
  context: Record<string, unknown>;
}

function returnCase(overrides: Partial<ReturnCase> = {}): ReturnCase {
  return {
    id: 'cccccccc-0000-4000-8000-000000000001',
    customerAccountId: 'customer-1',
    salesChannelId: CHANNEL_ID,
    rmaNumber: 'RMA-1',
    rejectionReason: 'Out of the return window',
    ...overrides,
  } as unknown as ReturnCase;
}

class CapturingMailer implements Mailer {
  readonly sent: MailerSendInput[] = [];
  async send(email: MailerSendInput): Promise<MailerSendOutcome> {
    this.sent.push(email);
    return { status: 'sent' };
  }
}

class CapturingSender implements TransactionalEmailSender {
  readonly sent: TransactionalEmailSendInput[] = [];
  constructor(private readonly outcome: TransactionalSendOutcome = { status: 'sent' }) {}
  async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
    this.sent.push(input);
    return this.outcome;
  }
}

function notifier(
  mailer: Mailer,
  sender: TransactionalEmailSender | undefined,
  logged: Logged[],
  recipient: string | null = 'buyer@example.com',
): ReturnEmailNotifier {
  return new ReturnEmailNotifier(mailer, async () => recipient, {
    ...(sender ? { getTransactionalEmailSender: () => sender } : {}),
    resolveLanguage: async () => 'en-US',
    log: (message, context) => logged.push({ message, context }),
  });
}

describe('returns — the authorize/reject notifier reports what happened (#78)', () => {
  it('reports a delivered authorization e-mail and logs nothing', async () => {
    const logged: Logged[] = [];
    const sender = new CapturingSender();

    await expect(notifier(new CapturingMailer(), sender, logged).authorized(returnCase())).resolves.toEqual(
      { sent: true },
    );
    expect(sender.sent).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it('reports the template the operator switched off, and sends nothing', async () => {
    const logged: Logged[] = [];
    const mailer = new CapturingMailer();

    await expect(
      notifier(mailer, new CapturingSender({ status: 'deactivated' }), logged).authorized(returnCase()),
    ).resolves.toEqual({ sent: false, reason: 'deactivated' });
    // Off means off: the legacy builder is not a way around the switch.
    expect(mailer.sent).toHaveLength(0);
    expect(logged[0]!.context).toMatchObject({ reason: 'deactivated', kind: 'return_authorized' });
  });

  it('reports a composition with no transport', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingMailer(), new CapturingSender({ status: 'no_transport' }), logged).rejected(
        returnCase(),
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_transport' });
    expect(logged[0]!.context).toMatchObject({ reason: 'no_transport', kind: 'return_rejected' });
  });

  it('reports a code with no definition — the legacy builder is not reached today', async () => {
    const logged: Logged[] = [];
    const mailer = new CapturingMailer();

    await expect(
      notifier(mailer, new CapturingSender({ status: 'no_definition' }), logged).authorized(returnCase()),
    ).resolves.toEqual({ sent: false, reason: 'no_definition' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('reports the legacy builder path as sent when no sender is wired', async () => {
    const logged: Logged[] = [];
    const mailer = new CapturingMailer();

    await expect(notifier(mailer, undefined, logged).rejected(returnCase())).resolves.toEqual({
      sent: true,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it('separates "no recipient" from a delivered message', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingMailer(), new CapturingSender(), logged, null).authorized(returnCase()),
    ).resolves.toEqual({ sent: false, reason: 'no_recipient' });
    expect(logged).toHaveLength(1);
  });

  it('names a case with no RMA number instead of returning the same nothing', async () => {
    const logged: Logged[] = [];

    await expect(
      notifier(new CapturingMailer(), new CapturingSender(), logged).authorized(
        returnCase({ rmaNumber: null }),
      ),
    ).resolves.toEqual({ sent: false, reason: 'no_rma' });
  });

  it('contains a throwing send but names it in the result and the log', async () => {
    const logged: Logged[] = [];
    const throwing: TransactionalEmailSender = {
      async send(): Promise<TransactionalSendOutcome> {
        throw new Error('smtp down');
      },
    };

    await expect(
      notifier(new CapturingMailer(), throwing, logged).authorized(returnCase()),
    ).resolves.toEqual({ sent: false, reason: 'failed' });
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
      notifier(new CapturingMailer(), disabled, logged).rejected(returnCase()),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
