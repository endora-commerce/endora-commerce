// Issue #1295 — the e-mail an operator triggers with *Reset password* on the
// admin customer screen. It was a hard-coded English message handed straight to
// the mailer: no code, no template, no language. It is a transactional e-mail
// now, and the plain mailer is reached only when the platform holds no
// definition for the code.

import { describe, expect, it } from 'vitest';
import type {
  EmailMailerPort,
  EmailMailerSendInput,
  TemplateEmailPort,
  TemplateEmailSendInput,
} from '@endora-commerce/contracts';
import {
  ADMIN_PASSWORD_RESET_EMAIL_CODE,
  sendAdminPasswordResetEmail,
} from './admin-password-reset-email.js';
import { ADMIN_PASSWORD_RESET_DEFAULT } from '../email-templates/transactional-defaults.js';
import { manifest } from '../../manifest.js';

const RESET_URL = 'https://shop.example/pl/password-reset/confirm?token=abc';
const INPUT = {
  customerId: '11111111-1111-4111-8111-111111111111',
  to: 'buyer@example.test',
  messageId: 'admin-pwd-reset.1.abc',
  resetUrl: RESET_URL,
  language: 'pl-PL',
};

function recorder(handled: boolean): { port: TemplateEmailPort; seen: TemplateEmailSendInput[] } {
  const seen: TemplateEmailSendInput[] = [];
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

describe('sendAdminPasswordResetEmail (issue #1295)', () => {
  it('sends through the transactional template, in the language the link is written for', async () => {
    const template = recorder(true);
    const raw = mailer();

    const outcome = await sendAdminPasswordResetEmail(
      { templateEmail: template.port, mailer: raw.port },
      INPUT,
    );

    expect(outcome).toEqual({ via: 'template' });
    expect(template.seen).toHaveLength(1);
    expect(template.seen[0]).toMatchObject({
      code: ADMIN_PASSWORD_RESET_EMAIL_CODE,
      to: INPUT.to,
      messageId: INPUT.messageId,
      language: 'pl-PL',
      variables: { resetUrl: RESET_URL },
    });
    expect(raw.sent, 'the plain mailer must not be reached once the template handled it').toHaveLength(0);
  });

  it('leaves the language to the channel when the caller knows none', async () => {
    const template = recorder(true);
    await sendAdminPasswordResetEmail(
      { templateEmail: template.port, mailer: mailer().port },
      { ...INPUT, language: null },
    );
    expect(template.seen[0]?.language ?? null).toBeNull();
  });

  it('falls back to the plain mailer, in English, when the code has no definition', async () => {
    const template = recorder(false);
    const raw = mailer();

    const outcome = await sendAdminPasswordResetEmail(
      { templateEmail: template.port, mailer: raw.port },
      INPUT,
    );

    expect(outcome).toEqual({ via: 'mailer', outcome: { status: 'sent' } });
    expect(raw.sent).toHaveLength(1);
    expect(raw.sent[0]?.to).toBe(INPUT.to);
    expect(raw.sent[0]?.subject).toBe('Set a new password');
    expect(raw.sent[0]?.text).toContain(RESET_URL);
  });

  it('falls back to the plain mailer when no template sender is composed at all', async () => {
    const raw = mailer();
    const outcome = await sendAdminPasswordResetEmail({ mailer: raw.port }, INPUT);
    expect(outcome.via).toBe('mailer');
    expect(raw.sent[0]?.text).toContain(RESET_URL);
  });

  it('declares the code in the manifest with the variable the defaults interpolate', () => {
    const entry = manifest.transactionalEmails?.find((e) => e.code === ADMIN_PASSWORD_RESET_EMAIL_CODE);
    expect(entry, 'the code must be declared, or no definition row is ever created').toBeDefined();
    expect(entry?.variables.map((v) => v.key)).toEqual(['resetUrl']);
  });

  it('ships English and Polish defaults, English first as the fallback tier', () => {
    expect(ADMIN_PASSWORD_RESET_DEFAULT.languages[0]).toBe('en-US');
    expect(Object.keys(ADMIN_PASSWORD_RESET_DEFAULT.defaultSubject).sort()).toEqual(['en-US', 'pl-PL']);
    const languages = (ADMIN_PASSWORD_RESET_DEFAULT.defaultContent as { languages: Record<string, unknown> })
      .languages;
    expect(Object.keys(languages).sort()).toEqual(['en-US', 'pl-PL']);
    for (const tree of Object.values(languages)) {
      expect(JSON.stringify(tree)).toContain('{{var resetUrl}}');
    }
  });

  it('may not be switched off: it is how the customer regains access to the account', () => {
    expect(ADMIN_PASSWORD_RESET_DEFAULT.nonDeactivatable?.reason).toBeTruthy();
  });
});
