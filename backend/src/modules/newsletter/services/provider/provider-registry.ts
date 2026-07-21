import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES } from '@b2b/contracts';
import type { NewsletterSendProvider, ResolveResult } from '@b2b/contracts';
import type { SettingsService } from '../../../settings/services/settings.service.js';
import { ConsoleNewsletterProvider } from './console-provider.js';
import { SmtpProvider } from './smtp-provider.js';

export interface ResolvedSender {
  fromEmail: string;
  fromName: string;
}

/**
 * Narrow port over CredentialsService.resolve (feature 058). The newsletter
 * module reaches credentials ONLY through this shape (Principle I).
 */
export interface CredentialResolvePort {
  resolve(configurationCode: string): Promise<ResolveResult>;
}

/**
 * Selects and builds the active newsletter sending provider (feature 048,
 * research R7; feature 058 — the credential reference is the single source).
 *
 * The `newsletter.email_credentials` reference (a reusable `email_adapter`
 * credential configuration) supplies the SMTP transport. When it is unset or
 * unresolvable, dispatch fails closed to the console (dev) sink — the pre-058
 * default. Secrets are decrypted in-memory by `CredentialsService.resolve`.
 */
export class NewsletterProviderRegistry {
  constructor(
    private readonly settings: SettingsService,
    private readonly platformChannelId: string,
    private readonly credentials?: CredentialResolvePort,
  ) {}

  private async getString(code: string): Promise<string> {
    return this.settings.get(code, this.platformChannelId, z.string());
  }

  /**
   * Resolve the referenced SMTP config, or `null` when no usable reference is
   * configured (caller then uses the console dev sink).
   */
  private async resolveCredentialSmtp(): Promise<{
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  } | null> {
    if (!this.credentials) return null;
    const ref = await this.getString(NEWSLETTER_SETTING_CODES.EMAIL_CREDENTIALS).catch(() => '');
    if (!ref) return null;
    const resolved = await this.credentials.resolve(ref);
    // Only the `smtp` provider variant has a wired transport today; any other
    // provider (or an unavailable/inert reference) falls back to the dev sink.
    if (resolved.status !== 'ok' || resolved.providerCode !== 'smtp') return null;
    const v = resolved.values;
    const host = typeof v['host'] === 'string' ? v['host'] : '';
    if (!host) return null;
    return {
      host,
      port: typeof v['port'] === 'number' ? v['port'] : 587,
      secure: typeof v['secure'] === 'boolean' ? v['secure'] : false,
      username: typeof v['username'] === 'string' ? v['username'] : '',
      password: typeof v['password'] === 'string' ? v['password'] : '',
    };
  }

  async resolveProvider(): Promise<NewsletterSendProvider> {
    const credentialSmtp = await this.resolveCredentialSmtp();
    if (credentialSmtp) {
      return new SmtpProvider(credentialSmtp);
    }
    // Fail closed to the console dev sink when no email credential is set.
    return new ConsoleNewsletterProvider();
  }

  /**
   * Gate for campaign sends (FR-017). A transport is always available — a
   * resolvable `email_adapter` credential gives a real SMTP transport, otherwise
   * the console dev sink (the pre-058 default) — so sends are never blocked here.
   */
  async isConfigured(): Promise<boolean> {
    return true;
  }

  async resolveSender(): Promise<ResolvedSender> {
    const [fromEmail, fromName] = await Promise.all([
      this.getString(NEWSLETTER_SETTING_CODES.SENDER_FROM_EMAIL),
      this.getString(NEWSLETTER_SETTING_CODES.SENDER_FROM_NAME),
    ]);
    return { fromEmail, fromName };
  }
}
