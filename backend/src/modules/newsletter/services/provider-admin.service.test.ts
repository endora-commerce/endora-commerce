import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { NEWSLETTER_SETTING_CODES } from '@b2b/contracts';
import { NewsletterProviderAdminService, type SettingsWriter } from './provider-admin.service.js';
import type { SettingsService } from '../../settings/services/settings.service.js';
import type { NewsletterProviderRegistry } from './provider/provider-registry.js';

class FakeSettings {
  store: Record<string, unknown> = {};
  async get<T>(code: string, _ch: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(this.store[code]);
  }
}

class FakeWriter implements SettingsWriter {
  writes: Array<{ code: string; value: unknown }> = [];
  async setValueForAllChannels(code: string, value: unknown): Promise<unknown> {
    this.writes.push({ code, value });
    return undefined;
  }
}

describe('NewsletterProviderAdminService (US7)', () => {
  const C = NEWSLETTER_SETTING_CODES;

  function build(store: Record<string, unknown>) {
    const settings = new FakeSettings();
    settings.store = store;
    const writer = new FakeWriter();
    const providers = { resolveProvider: async () => ({ verify: async () => ({ ok: true as const }) }) } as unknown as NewsletterProviderRegistry;
    const svc = new NewsletterProviderAdminService(settings as unknown as SettingsService, writer, providers, 'default');
    return { svc, writer };
  }

  it('reports passwordSet without returning the secret', async () => {
    const { svc } = build({
      [C.PROVIDER]: 'smtp',
      [C.SMTP_HOST]: 'smtp.test',
      [C.SMTP_PORT]: 587,
      [C.SMTP_SECURE]: false,
      [C.SMTP_USERNAME]: 'user',
      [C.SMTP_PASSWORD]: 'secret-pass',
      [C.SENDER_FROM_EMAIL]: 'n@s.test',
      [C.SENDER_FROM_NAME]: 'Shop',
      [C.RATE_LIMIT_PER_SECOND]: 20,
    });
    const cfg = await svc.getConfig();
    expect(cfg.provider).toBe('smtp');
    expect(cfg.smtp.passwordSet).toBe(true);
    expect(cfg.smtp).not.toHaveProperty('password');
    expect(cfg.rateLimitPerSecond).toBe(20);
  });

  it('writes all config codes and only writes the secret when provided', async () => {
    const { svc, writer } = build({ [C.SMTP_PASSWORD]: '' });
    await svc.putConfig(
      {
        provider: 'smtp',
        smtp: { host: 'h', port: 465, secure: true, username: 'u' }, // no password
        sender: { fromEmail: 'a@b.test', fromName: 'N' },
        rateLimitPerSecond: 10,
      },
      { actorAdminUserId: 'admin-1' },
    );
    const codes = writer.writes.map((w) => w.code);
    expect(codes).toContain(C.SMTP_HOST);
    expect(codes).not.toContain(C.SMTP_PASSWORD); // omitted → unchanged

    writer.writes = [];
    await svc.putConfig(
      {
        provider: 'smtp',
        smtp: { host: 'h', port: 465, secure: true, username: 'u', password: 'new-secret' },
        sender: { fromEmail: 'a@b.test', fromName: 'N' },
        rateLimitPerSecond: 10,
      },
      { actorAdminUserId: 'admin-1' },
    );
    expect(writer.writes.find((w) => w.code === C.SMTP_PASSWORD)?.value).toBe('new-secret');
  });
});
