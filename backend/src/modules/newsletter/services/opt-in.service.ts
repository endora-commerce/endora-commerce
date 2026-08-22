import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES, newsletterOptInModeSchema } from '@endora-commerce/contracts';
import type { NewsletterOptInMode } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';
import type { NewsletterTokenHelper } from './token.helper.js';

/**
 * Per-sales-channel opt-in policy (feature 048, research R5). Resolves the
 * single/double mode and confirmation TTL from Settings, and mints the signed
 * confirm/unsubscribe tokens.
 */
export class NewsletterOptInService {
  constructor(
    private readonly settings: SettingsReadPort,
    private readonly tokens: NewsletterTokenHelper,
  ) {}

  /**
   * `null` = no channel for this subscriber, so the platform-wide value applies
   * (feature 072, D-41). Both are per-storefront settings, which is why the
   * caller resolves the *system-default channel* first and only reaches `null`
   * when the deployment has none.
   */
  async resolveMode(salesChannelId: string | null): Promise<NewsletterOptInMode> {
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

  async confirmTtlSeconds(salesChannelId: string | null): Promise<number> {
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

  async mintConfirmToken(subscriberId: string, salesChannelId: string | null): Promise<string> {
    return this.tokens.mint('confirm', { id: subscriberId }, await this.confirmTtlSeconds(salesChannelId));
  }

  /** Unsubscribe tokens are long-lived (1 year) so links in old mail keep working. */
  mintUnsubscribeToken(subscriberId: string): string {
    return this.tokens.mint('unsubscribe', { id: subscriberId }, 365 * 24 * 3600);
  }
}
