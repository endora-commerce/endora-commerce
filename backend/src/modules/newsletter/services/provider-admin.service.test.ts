import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { NEWSLETTER_SETTING_CODES } from '@b2b/contracts';
import { NewsletterProviderAdminService, type SettingsWriter } from './provider-admin.service.js';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';
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

describe('NewsletterProviderAdminService (US7; feature 058)', () => {
  const C = NEWSLETTER_SETTING_CODES;

  function build(store: Record<string, unknown>) {
    const settings = new FakeSettings();
    settings.store = store;
    const writer = new FakeWriter();
    const providers = {
      resolveProvider: async () => ({ verify: async () => ({ ok: true as const }) }),
    } as unknown as NewsletterProviderRegistry;
    const svc = new NewsletterProviderAdminService(
      settings as unknown as SettingsService,
      writer,
      providers,
    );
    return { svc, writer };
  }

  it('reads the non-credential sender + throttle config', async () => {
    const { svc } = build({
      [C.SENDER_FROM_EMAIL]: 'n@s.test',
      [C.SENDER_FROM_NAME]: 'Shop',
      [C.RATE_LIMIT_PER_SECOND]: 20,
    });
    const cfg = await svc.getConfig();
    expect(cfg.sender).toEqual({ fromEmail: 'n@s.test', fromName: 'Shop' });
    expect(cfg.rateLimitPerSecond).toBe(20);
    // The credential/SMTP block is no longer part of this surface.
    expect(cfg).not.toHaveProperty('smtp');
    expect(cfg).not.toHaveProperty('provider');
  });

  it('writes the sender + throttle codes (no SMTP settings)', async () => {
    const { svc, writer } = build({});
    await svc.putConfig(
      {
        sender: { fromEmail: 'a@b.test', fromName: 'N' },
        rateLimitPerSecond: 10,
      },
      { actorAdminUserId: 'admin-1' },
    );
    const codes = writer.writes.map((w) => w.code);
    expect(codes).toContain(C.SENDER_FROM_EMAIL);
    expect(codes).toContain(C.SENDER_FROM_NAME);
    expect(codes).toContain(C.RATE_LIMIT_PER_SECOND);
    // No SMTP connection / password writes (those live in the credential).
    expect(codes.some((c) => c.startsWith('newsletter.smtp'))).toBe(false);
    expect(codes).not.toContain('newsletter.provider');
  });
});
