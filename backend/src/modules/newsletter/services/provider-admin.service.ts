import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES, type ProviderConfig, type PutProviderRequest } from '@b2b/contracts';
import type { SettingsService } from '../../settings/services/settings.service.js';
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
 * Provider configuration admin (feature 048, US7). Reads the non-secret config
 * for display (the SMTP password is reported only as `passwordSet`, never
 * returned) and writes changes through the Settings admin service — the secret
 * is encrypted at rest by the `secret` value type (feature 043).
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
  private bool(code: string): Promise<boolean> {
    return this.settings.get(code, this.channelId, z.boolean()).catch(() => false);
  }

  async getConfig(): Promise<ProviderConfig> {
    const C = NEWSLETTER_SETTING_CODES;
    const [provider, host, port, secure, username, password, fromEmail, fromName, rate] = await Promise.all([
      this.str(C.PROVIDER),
      this.str(C.SMTP_HOST),
      this.num(C.SMTP_PORT, 587),
      this.bool(C.SMTP_SECURE),
      this.str(C.SMTP_USERNAME),
      this.str(C.SMTP_PASSWORD),
      this.str(C.SENDER_FROM_EMAIL),
      this.str(C.SENDER_FROM_NAME),
      this.num(C.RATE_LIMIT_PER_SECOND, 14),
    ]);
    return {
      provider: provider === 'smtp' ? 'smtp' : 'console',
      smtp: { host, port, secure, username, passwordSet: password.length > 0 },
      sender: { fromEmail, fromName },
      rateLimitPerSecond: rate,
    };
  }

  async putConfig(input: PutProviderRequest, actor: AdminAuditContext): Promise<ProviderConfig> {
    const C = NEWSLETTER_SETTING_CODES;
    const w = (code: string, value: unknown): Promise<unknown> =>
      this.writer.setValueForAllChannels(code, value, null, actor);
    await Promise.all([
      w(C.PROVIDER, input.provider),
      w(C.SMTP_HOST, input.smtp.host),
      w(C.SMTP_PORT, input.smtp.port),
      w(C.SMTP_SECURE, input.smtp.secure),
      w(C.SMTP_USERNAME, input.smtp.username),
      w(C.SENDER_FROM_EMAIL, input.sender.fromEmail),
      w(C.SENDER_FROM_NAME, input.sender.fromName),
      w(C.RATE_LIMIT_PER_SECOND, input.rateLimitPerSecond),
    ]);
    // Only overwrite the secret when a new value is supplied (FR-032).
    if (input.smtp.password !== undefined) {
      await w(C.SMTP_PASSWORD, input.smtp.password);
    }
    return this.getConfig();
  }

  async test(): Promise<{ ok: true } | { ok: false; error: string }> {
    const provider = await this.providers.resolveProvider();
    return provider.verify();
  }
}
