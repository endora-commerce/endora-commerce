import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES, type ProviderConfig, type PutProviderRequest } from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';
import type { AdminAuditContext } from './provider-admin.types.js';
import type { NewsletterProviderRegistry } from './provider/provider-registry.js';

/** Minimal write surface of the Settings admin service used here. */
export interface SettingsWriter {
  setValueForAllChannels(
    code: string,
    rawValue: unknown,
    expectedVersion: string | null,
    actor: AdminAuditContext,
  ): Promise<unknown>;
}

/**
 * Provider configuration admin (feature 048, US7; feature 058). The SMTP
 * connection + credentials now live in a reusable `email_adapter` credential
 * configuration referenced by `newsletter.email_credentials` (managed on the
 * Credentials / Settings screen). This surface manages only the non-credential
 * sender + throttle config, and exposes a `test()` that resolves the referenced
 * provider and verifies it.
 */
export class NewsletterProviderAdminService {
  constructor(
    private readonly settings: SettingsService,
    private readonly writer: SettingsWriter,
    private readonly providers: NewsletterProviderRegistry,
    private readonly channelId: string,
  ) {}

  private str(code: string): Promise<string> {
    return this.settings.get(code, this.channelId, z.string()).catch(() => '');
  }
  private num(code: string, fallback: number): Promise<number> {
    return this.settings.get(code, this.channelId, z.number()).catch(() => fallback);
  }

  async getConfig(): Promise<ProviderConfig> {
    const C = NEWSLETTER_SETTING_CODES;
    const [fromEmail, fromName, rate] = await Promise.all([
      this.str(C.SENDER_FROM_EMAIL),
      this.str(C.SENDER_FROM_NAME),
      this.num(C.RATE_LIMIT_PER_SECOND, 14),
    ]);
    return {
      sender: { fromEmail, fromName },
      rateLimitPerSecond: rate,
    };
  }

  async putConfig(input: PutProviderRequest, actor: AdminAuditContext): Promise<ProviderConfig> {
    const C = NEWSLETTER_SETTING_CODES;
    const w = (code: string, value: unknown): Promise<unknown> =>
      this.writer.setValueForAllChannels(code, value, null, actor);
    await Promise.all([
      w(C.SENDER_FROM_EMAIL, input.sender.fromEmail),
      w(C.SENDER_FROM_NAME, input.sender.fromName),
      w(C.RATE_LIMIT_PER_SECOND, input.rateLimitPerSecond),
    ]);
    return this.getConfig();
  }

  async test(): Promise<{ ok: true } | { ok: false; error: string }> {
    const provider = await this.providers.resolveProvider();
    return provider.verify();
  }
}
