import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES, newsletterOptInModeSchema } from '@b2b/contracts';
import type { NewsletterOptInMode } from '@b2b/contracts';
import type { SettingsService } from '../../settings/services/settings.service.js';
import type { NewsletterTokenHelper } from './token.helper.js';

/**
 * Per-sales-channel opt-in policy (feature 048, research R5). Resolves the
 * single/double mode and confirmation TTL from Settings, and mints the signed
 * confirm/unsubscribe tokens.
 */
export class NewsletterOptInService {
  constructor(
    private readonly settings: SettingsService,
    private readonly tokens: NewsletterTokenHelper,
  ) {}

  async resolveMode(salesChannelId: string): Promise<NewsletterOptInMode> {
    try {
      return await this.settings.get(
        NEWSLETTER_SETTING_CODES.OPT_IN_MODE,
        salesChannelId,
        newsletterOptInModeSchema,
      );
    } catch {
      return 'double';
    }
  }

  async confirmTtlSeconds(salesChannelId: string): Promise<number> {
    try {
      const hours = await this.settings.get(
        NEWSLETTER_SETTING_CODES.CONFIRM_TTL_HOURS,
        salesChannelId,
        z.number(),
      );
      return Math.max(1, Math.floor(hours)) * 3600;
    } catch {
      return 168 * 3600;
    }
  }

  async mintConfirmToken(subscriberId: string, salesChannelId: string): Promise<string> {
    return this.tokens.mint('confirm', { id: subscriberId }, await this.confirmTtlSeconds(salesChannelId));
  }

  /** Unsubscribe tokens are long-lived (1 year) so links in old mail keep working. */
  mintUnsubscribeToken(subscriberId: string): string {
    return this.tokens.mint('unsubscribe', { id: subscriberId }, 365 * 24 * 3600);
  }
}
