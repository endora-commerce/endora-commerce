import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import type {
  AdminI18nTranslatePort,
  ContactFormSubmission,
  EmailMailerPort,
  EmailMailerSendInput,
  EmailMailerSendOutcome,
} from '@endora-commerce/contracts';
import { ContactFormService, type ContactFormChannel } from './contact-form.service.js';

/**
 * Feature 169 (T100, FR-018, FR-019) — a contact-form submission becomes one e-mail per
 * recipient of the request's channel, with the shopper as Reply-To, and leaves nothing behind
 * but the mailer's own delivery record — which receives a fixed subject and no `meta`.
 */
const SUBMISSION: ContactFormSubmission = {
  email: 'shopper@example.com',
  message: 'Please call me back about the order.',
  privacyConsent: true,
  subject: 'Typed subject',
  name: 'Ada',
};

const CHANNEL: ContactFormChannel = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: { en: 'Acme Store', pl: 'Sklep Acme' },
  defaultLanguage: 'en',
};

class CapturingMailer implements EmailMailerPort {
  readonly sent: EmailMailerSendInput[] = [];
  constructor(private readonly failFor: ReadonlySet<string> = new Set()) {}
  async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
    if (this.failFor.has(input.to)) throw new Error(`smtp refused ${input.to}`);
    this.sent.push(input);
    return { status: 'sent' };
  }
}

function translator(calls: string[] = []): AdminI18nTranslatePort {
  return {
    async translate(moduleId, key, language, params) {
      calls.push(`${moduleId}:${language}:${key}`);
      return params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key;
    },
  };
}

function service(options: {
  recipients: string[];
  mailer?: CapturingMailer;
  calls?: string[];
  reads?: string[];
}): { service: ContactFormService; mailer: CapturingMailer } {
  const mailer = options.mailer ?? new CapturingMailer();
  return {
    mailer,
    service: new ContactFormService({
      mailer,
      translator: translator(options.calls),
      readRecipients: async (channelId) => {
        options.reads?.push(channelId);
        return options.recipients;
      },
    }),
  };
}

describe('ContactFormService (feature 169)', () => {
  it('refuses with 409 CMS_CONTACT_FORM_UNAVAILABLE when the channel has no recipients', async () => {
    const { service: subject, mailer } = service({ recipients: [] });
    const error = await subject.submit(SUBMISSION, CHANNEL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 409, code: 'CMS_CONTACT_FORM_UNAVAILABLE' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('sends one e-mail per recipient of the request channel, replying to the shopper', async () => {
    const reads: string[] = [];
    const { service: subject, mailer } = service({ recipients: ['sales@example.com', 'office@example.com'], reads });

    await expect(subject.submit(SUBMISSION, CHANNEL)).resolves.toEqual({ status: 'sent' });

    expect(reads).toEqual([CHANNEL.id]);
    expect(mailer.sent.map((m) => m.to)).toEqual(['sales@example.com', 'office@example.com']);
    for (const message of mailer.sent) {
      expect(message.replyTo).toBe('shopper@example.com');
      expect(message.kind).toBe('cms.contact_form');
      expect(message.salesChannelId).toBe(CHANNEL.id);
      expect(message).not.toHaveProperty('meta');
      expect(message.subject).not.toContain('Typed subject');
      expect(message.subject).not.toContain('Ada');
      expect(message.subject).not.toContain('Please call me back');
      expect(message.text).toContain('Please call me back about the order.');
      expect(message.messageId).toMatch(/^cms-contact-[0-9a-f-]{36}-\d$/);
    }
    expect(new Set(mailer.sent.map((m) => m.messageId)).size).toBe(2);
  });

  it('answers sent and sends nothing when the honeypot is filled', async () => {
    const reads: string[] = [];
    const { service: subject, mailer } = service({ recipients: ['sales@example.com'], reads });
    await expect(subject.submit({ ...SUBMISSION, website: 'https://spam.example' }, CHANNEL)).resolves.toEqual({
      status: 'sent',
    });
    expect(mailer.sent).toHaveLength(0);
    expect(reads).toEqual([]);
  });

  it('answers sent when at least one recipient was reached', async () => {
    const mailer = new CapturingMailer(new Set(['sales@example.com']));
    const { service: subject } = service({ recipients: ['sales@example.com', 'office@example.com'], mailer });
    await expect(subject.submit(SUBMISSION, CHANNEL)).resolves.toEqual({ status: 'sent' });
    expect(mailer.sent.map((m) => m.to)).toEqual(['office@example.com']);
  });

  it('fails with 500 and no transport detail when every send failed', async () => {
    const mailer = new CapturingMailer(new Set(['sales@example.com', 'office@example.com']));
    const { service: subject } = service({ recipients: ['sales@example.com', 'office@example.com'], mailer });
    const error = await subject.submit(SUBMISSION, CHANNEL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 500, code: 'INTERNAL' });
    expect((error as Error).message).not.toContain('smtp refused');
  });

  it('sends each address once, ignoring blanks and case repeats', async () => {
    const { service: subject, mailer } = service({ recipients: ['sales@example.com', ' SALES@example.com ', ''] });
    await subject.submit(SUBMISSION, CHANNEL);
    expect(mailer.sent.map((m) => m.to)).toEqual(['sales@example.com']);
  });

  it.each([
    ['pl-PL', 'pl', 'Sklep Acme'],
    ['pl', 'pl', 'Sklep Acme'],
    ['de-DE', 'en', 'Acme Store'],
    ['en-GB', 'en', 'Acme Store'],
  ])('writes the e-mail in the channel default language: %s reads as %s', async (defaultLanguage, language, name) => {
    const calls: string[] = [];
    const { service: subject, mailer } = service({ recipients: ['sales@example.com'], calls });
    await subject.submit(SUBMISSION, { ...CHANNEL, defaultLanguage });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.startsWith(`cms:${language}:`))).toBe(true);
    expect(mailer.sent[0]?.subject).toContain(name);
  });
});
