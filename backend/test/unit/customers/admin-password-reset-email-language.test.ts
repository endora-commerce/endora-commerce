// Issue #1295 — the operator-triggered password-reset e-mail is written in the
// sales channel's language.
//
// It was a hard-coded English message handed straight to the mailer, so a
// customer of a Polish store read English. **This file asserts the language
// selection, not that a message was sent**: the send runs over the real
// adapter (`makeTemplateEmail`) and the real content resolver, over the
// defaults `customers` ships, and what changes between runs is the language
// the channel resolves to. The pattern is the organizations moderation twin
// (`test/unit/organizations/moderation-email-language.test.ts`).
//
// The language is the channel's, not the account's preferred one: moving
// customer-facing senders onto `preferredLanguage` is issue #652's PR B.

import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  EmailMailerSendInput,
  TransactionalEmailSendInput,
  TransactionalSendOutcome,
} from '@endora-commerce/contracts';
import { makeTemplateEmail } from '../../../../packages/modules/transactional_emails/src/backend/services/template-email.js';
import { ContentResolver } from '../../../../packages/modules/transactional_emails/src/backend/services/content-resolver.js';
import { ADMIN_PASSWORD_RESET_DEFAULT } from '../../../../packages/modules/customers/src/backend/email-templates/transactional-defaults.js';
import {
  ADMIN_PASSWORD_RESET_EMAIL_CODE,
  sendAdminPasswordResetEmail,
} from '../../../../packages/modules/customers/src/backend/services/admin-password-reset-email.js';

const CHANNEL = '00000000-0000-0000-0000-0000000000aa';
const RESET_URL = 'https://shop.example/password-reset/confirm?token=abc';

interface RenderedSend {
  code: string;
  requestedLanguage: string;
  resolvedLanguage: string;
  subject: string;
}

/** Renders through the real `ContentResolver` over the module default tier. */
function senderOverModuleDefaults(): {
  sent: RenderedSend[];
  send: (input: TransactionalEmailSendInput) => Promise<TransactionalSendOutcome>;
} {
  const resolver = new ContentResolver();
  const em = { async findOne(): Promise<null> { return null; } } as unknown as EntityManager;
  const sent: RenderedSend[] = [];
  return {
    sent,
    async send(input) {
      if (input.code !== ADMIN_PASSWORD_RESET_EMAIL_CODE) return { status: 'no_definition' };
      const defaults = ADMIN_PASSWORD_RESET_DEFAULT;
      const resolved = await resolver.resolve(
        em,
        {
          defaultSubject: defaults.defaultSubject,
          defaultContent: defaults.defaultContent,
          languages: defaults.languages,
        } as never,
        {
          salesChannelId: input.salesChannelId,
          language: input.language,
          fallbackLanguage: defaults.languages[0]!,
        },
      );
      sent.push({
        code: input.code,
        requestedLanguage: input.language,
        resolvedLanguage: resolved.language,
        subject: resolved.subject,
      });
      return { status: 'sent' };
    },
  };
}

async function sendWith(options: {
  channelLanguage: string | null;
  linkLanguage: string | null;
}): Promise<{ templated: RenderedSend[]; raw: EmailMailerSendInput[] }> {
  const sender = senderOverModuleDefaults();
  const raw: EmailMailerSendInput[] = [];
  const templateEmail = makeTemplateEmail({
    getSender: () => sender,
    resolveScopeSalesChannelId: async () => CHANNEL,
    resolveLanguage: async () => {
      if (options.channelLanguage === null) throw new Error('the channel could not be read');
      return options.channelLanguage;
    },
  });
  await sendAdminPasswordResetEmail(
    {
      templateEmail,
      mailer: {
        async send(input) {
          raw.push(input);
          return { status: 'sent' };
        },
      },
    },
    {
      customerId: '11111111-1111-4111-8111-111111111111',
      to: 'buyer@example.test',
      messageId: 'admin-pwd-reset.1.abc',
      resetUrl: RESET_URL,
      language: options.linkLanguage,
    },
  );
  return { templated: sender.sent, raw };
}

describe('customers — the admin-triggered password-reset e-mail is in the channel language (issue #1295)', () => {
  it('is Polish on a store whose default language is pl-PL', async () => {
    const { templated, raw } = await sendWith({ channelLanguage: 'pl-PL', linkLanguage: 'pl-PL' });
    expect(templated).toHaveLength(1);
    expect(templated[0]?.code).toBe(ADMIN_PASSWORD_RESET_EMAIL_CODE);
    expect(templated[0]?.resolvedLanguage).toBe('pl-PL');
    expect(templated[0]?.subject).toBe('Ustaw nowe hasło');
    expect(raw, 'the plain mailer must not be reached once the template handled it').toHaveLength(0);
  });

  it('is Polish when only the channel knows the language', async () => {
    const { templated } = await sendWith({ channelLanguage: 'pl-PL', linkLanguage: null });
    expect(templated[0]?.requestedLanguage).toBe('pl-PL');
    expect(templated[0]?.subject).toBe('Ustaw nowe hasło');
  });

  it('is English on an en-US store', async () => {
    const { templated } = await sendWith({ channelLanguage: 'en-US', linkLanguage: 'en-US' });
    expect(templated[0]?.resolvedLanguage).toBe('en-US');
    expect(templated[0]?.subject).toBe('Set a new password');
  });

  it('falls back to English when the channel language cannot be resolved (owner ruling, 2026-09-01)', async () => {
    const { templated } = await sendWith({ channelLanguage: null, linkLanguage: null });
    expect(templated[0]?.requestedLanguage).toBe('en-US');
    expect(templated[0]?.subject).toBe('Set a new password');
  });

  it('falls back to English for a language the defaults do not ship', async () => {
    const { templated } = await sendWith({ channelLanguage: 'de-DE', linkLanguage: 'de-DE' });
    expect(templated[0]?.subject).toBe('Set a new password');
  });
});
