// Issue #1371 — the e-mail a customer asks for on the storefront's *Forgot
// password* page. The route minted a token and mailed nothing; it sends the
// `customer_password_reset` transactional e-mail now, and the plain mailer is
// reached only when the platform holds no definition for the code.

import { describe, expect, it } from 'vitest';
import type { EmailMailerPort, EmailMailerSendInput } from '@endora-commerce/contracts';
import { SettingNotRegistered } from '@endora-commerce/platform/kernel';
import { PASSWORD_RESET_EMAIL_CODE, sendPasswordResetEmail } from './password-reset-email.js';
import { createStorefrontOriginResolver } from './storefront-origin.js';
import type { OrgTemplateEmail } from './org-template-email.js';
import { PASSWORD_RESET_DEFAULT } from '../email-templates/transactional-defaults.js';
import { manifest } from '../../manifest.js';

type TemplateSend = Parameters<OrgTemplateEmail['trySend']>[0];

const CHANNEL = '00000000-0000-4000-8000-0000000000aa';
const RESET_URL = 'https://shop.example/pl/password-reset/confirm?token=abc';
const INPUT = {
  to: 'buyer@example.test',
  messageId: 'customer-pwd-reset.abc',
  resetUrl: RESET_URL,
  salesChannelId: CHANNEL,
  language: 'pl-PL',
};

function recorder(handled: boolean): { port: OrgTemplateEmail; seen: TemplateSend[] } {
  const seen: TemplateSend[] = [];
  return {
    seen,
    port: {
      async trySend(input) {
        seen.push(input);
        return handled;
      },
    },
  };
}

function mailer(): { port: EmailMailerPort; sent: EmailMailerSendInput[] } {
  const sent: EmailMailerSendInput[] = [];
  return {
    sent,
    port: {
      async send(input) {
        sent.push(input);
        return { status: 'sent' };
      },
    },
  };
}

describe('sendPasswordResetEmail (issue #1371)', () => {
  it("sends through the transactional template, on the request's channel and in the link's language", async () => {
    const template = recorder(true);
    const raw = mailer();

    const outcome = await sendPasswordResetEmail({ templateEmail: template.port, mailer: raw.port }, INPUT);

    expect(outcome).toEqual({ via: 'template' });
    expect(template.seen).toEqual([
      {
        code: PASSWORD_RESET_EMAIL_CODE,
        to: INPUT.to,
        messageId: INPUT.messageId,
        variables: { resetUrl: RESET_URL },
        salesChannelId: CHANNEL,
        language: 'pl-PL',
      },
    ]);
    expect(raw.sent, 'the plain mailer must not be reached once the template handled it').toHaveLength(0);
  });

  it('leaves channel and language to the template sender when the request resolved neither', async () => {
    const template = recorder(true);
    await sendPasswordResetEmail(
      { templateEmail: template.port, mailer: mailer().port },
      { ...INPUT, salesChannelId: null, language: null },
    );
    expect(template.seen[0]).not.toHaveProperty('salesChannelId');
    expect(template.seen[0]).not.toHaveProperty('language');
  });

  it('falls back to the plain mailer, in English, when the code has no definition', async () => {
    const raw = mailer();
    const outcome = await sendPasswordResetEmail({ templateEmail: recorder(false).port, mailer: raw.port }, INPUT);

    expect(outcome).toEqual({ via: 'mailer', outcome: { status: 'sent' } });
    expect(raw.sent).toHaveLength(1);
    expect(raw.sent[0]?.to).toBe(INPUT.to);
    expect(raw.sent[0]?.subject).toBe('Reset your password');
    expect(raw.sent[0]?.text).toContain(RESET_URL);
  });

  it('falls back to the plain mailer when no template sender is composed at all', async () => {
    const raw = mailer();
    const outcome = await sendPasswordResetEmail({ mailer: raw.port }, INPUT);
    expect(outcome.via).toBe('mailer');
    expect(raw.sent[0]?.text).toContain(RESET_URL);
  });

  it('declares the code in the manifest with the variable the defaults interpolate', () => {
    const entry = manifest.transactionalEmails?.find((e) => e.code === PASSWORD_RESET_EMAIL_CODE);
    expect(entry, 'the code must be declared, or no definition row is ever created').toBeDefined();
    expect(entry?.variables.map((v) => v.key)).toEqual(['resetUrl']);
  });

  it('ships English and Polish defaults, English first as the fallback tier', () => {
    expect(PASSWORD_RESET_DEFAULT.languages[0]).toBe('en-US');
    expect(Object.keys(PASSWORD_RESET_DEFAULT.defaultSubject).sort()).toEqual(['en-US', 'pl-PL']);
    const languages = (PASSWORD_RESET_DEFAULT.defaultContent as { languages: Record<string, unknown> }).languages;
    expect(Object.keys(languages).sort()).toEqual(['en-US', 'pl-PL']);
    for (const tree of Object.values(languages)) {
      expect(JSON.stringify(tree)).toContain('{{var resetUrl}}');
    }
  });

  it('may not be switched off: it is how the customer regains access to the account', () => {
    expect(PASSWORD_RESET_DEFAULT.nonDeactivatable?.reason).toBeTruthy();
  });
});

describe('createStorefrontOriginResolver (issue #1371)', () => {
  const FALLBACK = 'https://fallback.example/';

  it("answers the channel's configured storefront URL, without its trailing slash", async () => {
    const resolve = createStorefrontOriginResolver(async () => ' https://pl.shop.example/ ', FALLBACK);
    expect(await resolve(CHANNEL)).toBe('https://pl.shop.example');
  });

  it('falls back to the deployment URL with no channel, a blank value or a non-http value', async () => {
    expect(await createStorefrontOriginResolver(async () => 'https://x.example', FALLBACK)(null)).toBe(
      'https://fallback.example',
    );
    expect(await createStorefrontOriginResolver(async () => '  ', FALLBACK)(CHANNEL)).toBe('https://fallback.example');
    expect(await createStorefrontOriginResolver(async () => 'javascript:alert(1)', FALLBACK)(CHANNEL)).toBe(
      'https://fallback.example',
    );
  });

  it('treats an unregistered setting as not configured, and rethrows any other failure', async () => {
    const unregistered = createStorefrontOriginResolver(async () => {
      throw new SettingNotRegistered('sales_channels.storefront_url');
    }, FALLBACK);
    expect(await unregistered(CHANNEL)).toBe('https://fallback.example');

    const broken = createStorefrontOriginResolver(async () => {
      throw new Error('database down');
    }, FALLBACK);
    await expect(broken(CHANNEL)).rejects.toThrow('database down');
  });
});
