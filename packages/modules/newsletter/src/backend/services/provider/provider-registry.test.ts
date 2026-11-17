import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { NEWSLETTER_SETTING_CODES, type ResolveResult } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { NewsletterProviderRegistry, type CredentialResolvePort } from './provider-registry.js';
import { ConsoleNewsletterProvider } from './console-provider.js';
import { SmtpProvider } from './smtp-provider.js';

/**
 * Issue #1334 — with no usable e-mail credential the registry used to hand out
 * the console sink everywhere and report itself configured, so a campaign on a
 * production instance was "sent" into the server log. The console sink is now a
 * development and test convenience only; a production instance reports itself
 * unconfigured and its provider refuses to send.
 */
class FakeSettings {
  constructor(private readonly store: Record<string, unknown>) {}
  async get<T>(code: string, _channel: string | null, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(this.store[code] ?? '');
  }
}

function credentials(result: ResolveResult): CredentialResolvePort {
  return { resolve: async () => result };
}

const SMTP_OK: ResolveResult = {
  status: 'ok',
  typeCode: 'email_adapter',
  providerCode: 'smtp',
  values: { host: 'smtp.example.test', port: 587, secure: false, username: 'u', password: 'p' },
};

const SES_OK: ResolveResult = {
  status: 'ok',
  typeCode: 'email_adapter',
  providerCode: 'ses',
  values: { region: 'eu-west-1' },
};

function registry(
  ref: string,
  creds: CredentialResolvePort | undefined,
  allowConsoleSink: boolean,
): NewsletterProviderRegistry {
  const settings = new FakeSettings({ [NEWSLETTER_SETTING_CODES.EMAIL_CREDENTIALS]: ref });
  return new NewsletterProviderRegistry(settings as unknown as SettingsReadPort, creds, { allowConsoleSink });
}

describe('NewsletterProviderRegistry — a send needs a usable credential (issue #1334)', () => {
  it('builds the SMTP transport from a resolvable SMTP credential, wherever it runs', async () => {
    for (const allowConsoleSink of [true, false]) {
      const r = registry('newsletter-smtp', credentials(SMTP_OK), allowConsoleSink);
      expect(await r.isConfigured()).toBe(true);
      expect(await r.resolveProvider()).toBeInstanceOf(SmtpProvider);
    }
  });

  const unusable: Array<[string, string, CredentialResolvePort | undefined]> = [
    ['no credential is chosen', '', credentials(SMTP_OK)],
    ['the chosen credential does not resolve', 'gone', credentials({ status: 'not_configured' })],
    ['the chosen credential is not SMTP', 'newsletter-ses', credentials(SES_OK)],
    ['no credentials service is composed', 'newsletter-smtp', undefined],
  ];

  it.each(unusable)('refuses on production when %s', async (_case, ref, creds) => {
    const r = registry(ref, creds, false);
    expect(await r.isConfigured()).toBe(false);
    const provider = await r.resolveProvider();
    expect(provider).not.toBeInstanceOf(ConsoleNewsletterProvider);
    await expect(
      provider.send({
        to: 'a@example.test',
        fromEmail: 'noreply@example.test',
        subject: 's',
        html: '<p>h</p>',
        text: 't',
        messageId: 'm-1',
      }),
    ).rejects.toThrow(/no usable e-mail credential/i);
    const verified = await provider.verify();
    expect(verified.ok).toBe(false);
  });

  it.each(unusable)('keeps the console sink on development and test when %s', async (_case, ref, creds) => {
    const r = registry(ref, creds, true);
    expect(await r.isConfigured()).toBe(true);
    expect(await r.resolveProvider()).toBeInstanceOf(ConsoleNewsletterProvider);
  });

  it('allows the console sink only outside NODE_ENV=production by default', () => {
    const settings = new FakeSettings({}) as unknown as SettingsReadPort;
    const previous = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      expect(new NewsletterProviderRegistry(settings).allowsConsoleSink).toBe(false);
      process.env['NODE_ENV'] = 'development';
      expect(new NewsletterProviderRegistry(settings).allowsConsoleSink).toBe(true);
      process.env['NODE_ENV'] = 'test';
      expect(new NewsletterProviderRegistry(settings).allowsConsoleSink).toBe(true);
    } finally {
      process.env['NODE_ENV'] = previous;
    }
  });
});
