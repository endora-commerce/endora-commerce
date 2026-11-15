// Issue #1256 — the template-email adapter renders in the caller's channel and
// language when the caller has them, and in the system-default channel and its
// default language when it has none (the adapter's behaviour before the port
// was widened, and still every caller's that passes neither).
//
// Fallback order for the language: the caller's language, else the channel's
// default language, else the system-default channel's, else `en-US`. A channel
// id that no longer resolves is answered as no channel at all.

import { describe, expect, it } from 'vitest';
import type { TransactionalEmailSendInput, TransactionalSendOutcome } from '@endora-commerce/contracts';
import { makeTemplateEmail } from './template-email.js';

const SYSTEM_DEFAULT = '00000000-0000-0000-0000-0000000000aa';
const POLISH_CHANNEL = '00000000-0000-0000-0000-0000000000bb';
const GONE_CHANNEL = '00000000-0000-0000-0000-0000000000cc';

const DEFAULT_LANGUAGE: Record<string, string> = {
  [SYSTEM_DEFAULT]: 'en-US',
  [POLISH_CHANNEL]: 'pl-PL',
};

const message = {
  code: 'availability_back_in_stock',
  to: 'buyer@example.com',
  messageId: 'availability:1',
  variables: { product: { name: 'Drill' } },
};

function adapter(): {
  seen: TransactionalEmailSendInput[];
  trySend: ReturnType<typeof makeTemplateEmail>['trySend'];
} {
  const seen: TransactionalEmailSendInput[] = [];
  const sender = {
    async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
      seen.push(input);
      return { status: 'sent' };
    },
  };
  const made = makeTemplateEmail({
    getSender: () => sender,
    resolveScopeSalesChannelId: async () => SYSTEM_DEFAULT,
    resolveLanguage: async (salesChannelId) => DEFAULT_LANGUAGE[salesChannelId] ?? null,
  });
  return { seen, trySend: (input) => made.trySend(input) };
}

describe('template-email adapter — the scope a message is rendered in (issue #1256)', () => {
  it('renders in the caller\'s channel and language', async () => {
    const { seen, trySend } = adapter();
    expect(await trySend({ ...message, salesChannelId: POLISH_CHANNEL, language: 'en-US' })).toBe(true);
    expect(seen.map((s) => [s.salesChannelId, s.language])).toEqual([[POLISH_CHANNEL, 'en-US']]);
  });

  it('renders in the channel\'s default language when the caller names a channel and no language', async () => {
    const { seen, trySend } = adapter();
    await trySend({ ...message, salesChannelId: POLISH_CHANNEL, language: null });
    expect(seen.map((s) => [s.salesChannelId, s.language])).toEqual([[POLISH_CHANNEL, 'pl-PL']]);
  });

  it('renders in the system-default channel and its language when the caller names neither', async () => {
    const { seen, trySend } = adapter();
    await trySend(message);
    await trySend({ ...message, salesChannelId: null, language: null });
    expect(seen.map((s) => [s.salesChannelId, s.language])).toEqual([
      [SYSTEM_DEFAULT, 'en-US'],
      [SYSTEM_DEFAULT, 'en-US'],
    ]);
  });

  it('keeps the caller\'s language on the system-default channel when it names no channel', async () => {
    const { seen, trySend } = adapter();
    await trySend({ ...message, language: 'pl-PL' });
    expect(seen.map((s) => [s.salesChannelId, s.language])).toEqual([[SYSTEM_DEFAULT, 'pl-PL']]);
  });

  it('answers a channel that no longer resolves as the system-default channel', async () => {
    const { seen, trySend } = adapter();
    await trySend({ ...message, salesChannelId: GONE_CHANNEL, language: null });
    await trySend({ ...message, salesChannelId: GONE_CHANNEL, language: 'pl-PL' });
    expect(seen.map((s) => [s.salesChannelId, s.language])).toEqual([
      [SYSTEM_DEFAULT, 'en-US'],
      [SYSTEM_DEFAULT, 'pl-PL'],
    ]);
  });

  it('falls back to en-US when no channel answers a default language', async () => {
    const seen: TransactionalEmailSendInput[] = [];
    const made = makeTemplateEmail({
      getSender: () => ({
        async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
          seen.push(input);
          return { status: 'sent' };
        },
      }),
      resolveScopeSalesChannelId: async () => SYSTEM_DEFAULT,
      resolveLanguage: async () => null,
    });
    await made.trySend({ ...message, salesChannelId: POLISH_CHANNEL });
    expect(seen.map((s) => [s.salesChannelId, s.language])).toEqual([[SYSTEM_DEFAULT, 'en-US']]);
  });
});
