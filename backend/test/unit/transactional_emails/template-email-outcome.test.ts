// Feature 072 (issue 67) — what the template-email adapter's boolean means.
//
// `trySend` answers "handled, do not use your legacy in-code builder". Before
// this test the adapter answered `true` for every send that reached a sender,
// including the ones where the service returned early without delivering
// anything: an unknown code and a missing transport both suppressed the
// caller's fallback while no email was sent. Only "this code has no definition
// yet" justifies the fallback; a deactivated email is an operator decision and
// must stay silent.

import { describe, expect, it } from 'vitest';
import type { TransactionalEmailSendInput, TransactionalSendOutcome } from '@endora-commerce/contracts';
import {
  makeTemplateEmail,
  noopTemplateEmail,
} from '../../../../packages/modules/transactional_emails/src/backend/services/template-email.js';

const CHANNEL = '00000000-0000-0000-0000-0000000000aa';

const message = {
  code: 'organization_invitation',
  to: 'buyer@example.com',
  messageId: 'organization_invitation:1',
  variables: { organizationName: 'Acme' },
};

function senderReturning(outcome: TransactionalSendOutcome): {
  seen: TransactionalEmailSendInput[];
  send: (input: TransactionalEmailSendInput) => Promise<TransactionalSendOutcome>;
} {
  const seen: TransactionalEmailSendInput[] = [];
  return {
    seen,
    async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
      seen.push(input);
      return outcome;
    },
  };
}

function adapterFor(outcome: TransactionalSendOutcome): {
  seen: TransactionalEmailSendInput[];
  trySend: (input: typeof message) => Promise<boolean>;
} {
  const sender = senderReturning(outcome);
  const adapter = makeTemplateEmail({
    getSender: () => sender,
    resolveScopeSalesChannelId: async () => CHANNEL,
    resolveLanguage: async () => 'en-US',
  });
  return { seen: sender.seen, trySend: (input) => adapter.trySend(input) };
}

describe('template-email adapter — outcome to fallback mapping', () => {
  it('suppresses the legacy builder when the email was sent', async () => {
    const { seen, trySend } = adapterFor({ status: 'sent' });
    expect(await trySend(message)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.salesChannelId).toBe(CHANNEL);
  });

  it('suppresses the legacy builder when the operator deactivated the email', async () => {
    // The point of the switch: off means nothing goes out, not "send the
    // in-code version instead".
    const { trySend } = adapterFor({ status: 'deactivated' });
    expect(await trySend(message)).toBe(true);
  });

  it('suppresses the legacy builder when no transport is configured', async () => {
    // A deployment with no mailer sends nothing at all; routing around the
    // template would not produce an email either.
    const { trySend } = adapterFor({ status: 'no_transport' });
    expect(await trySend(message)).toBe(true);
  });

  it('falls back to the legacy builder when the code has no definition', async () => {
    const { trySend } = adapterFor({ status: 'no_definition' });
    expect(await trySend(message)).toBe(false);
  });

  it('falls back when no sender is wired', async () => {
    const adapter = makeTemplateEmail({
      resolveScopeSalesChannelId: async () => CHANNEL,
    });
    expect(await adapter.trySend(message)).toBe(false);
  });

  it('falls back when no sales channel resolves', async () => {
    const sender = senderReturning({ status: 'sent' });
    const adapter = makeTemplateEmail({
      getSender: () => sender,
      resolveScopeSalesChannelId: async () => null,
    });
    expect(await adapter.trySend(message)).toBe(false);
    expect(sender.seen).toHaveLength(0);
  });

  it('noopTemplateEmail always falls back', async () => {
    expect(await noopTemplateEmail.trySend(message)).toBe(false);
  });
});
