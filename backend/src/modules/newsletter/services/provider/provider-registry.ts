import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES } from '@b2b/contracts';
import type { NewsletterSendProvider } from '@b2b/contracts';
import type { SettingsService } from '../../../settings/services/settings.service.js';
import { ConsoleNewsletterProvider } from './console-provider.js';
import { SmtpProvider } from './smtp-provider.js';

export interface ResolvedSender {
  fromEmail: string;
  fromName: string;
}

/**
 * Selects and builds the active newsletter sending provider from Settings
 * (feature 048, research R7). The provider config is global (read against the
 * platform settings channel). Secrets are decrypted by SettingsService.get.
 */
export class NewsletterProviderRegistry {
  constructor(
    private readonly settings: SettingsService,
    private readonly platformChannelId: string,
  ) {}

  private async getString(code: string): Promise<string> {
    return this.settings.get(code, this.platformChannelId, z.string());
  }

  async resolveProvider(): Promise<NewsletterSendProvider> {
    const kind = await this.getString(NEWSLETTER_SETTING_CODES.PROVIDER);
    if (kind === 'smtp') {
      const [host, port, secure, username, password] = await Promise.all([
        this.getString(NEWSLETTER_SETTING_CODES.SMTP_HOST),
        this.settings.get(NEWSLETTER_SETTING_CODES.SMTP_PORT, this.platformChannelId, z.number()),
        this.settings.get(NEWSLETTER_SETTING_CODES.SMTP_SECURE, this.platformChannelId, z.boolean()),
        this.getString(NEWSLETTER_SETTING_CODES.SMTP_USERNAME),
        this.getString(NEWSLETTER_SETTING_CODES.SMTP_PASSWORD),
      ]);
      return new SmtpProvider({ host, port, secure, username, password });
    }
    return new ConsoleNewsletterProvider();
  }

  /** Whether a usable provider is configured (gates campaign sends — FR-017). */
  async isConfigured(): Promise<boolean> {
    const kind = await this.getString(NEWSLETTER_SETTING_CODES.PROVIDER);
    if (kind === 'console') return true;
    if (kind === 'smtp') {
      const host = await this.getString(NEWSLETTER_SETTING_CODES.SMTP_HOST);
      return host.length > 0;
    }
    return false;
  }

  async resolveSender(): Promise<ResolvedSender> {
    const [fromEmail, fromName] = await Promise.all([
      this.getString(NEWSLETTER_SETTING_CODES.SENDER_FROM_EMAIL),
      this.getString(NEWSLETTER_SETTING_CODES.SENDER_FROM_NAME),
    ]);
    return { fromEmail, fromName };
  }
}
