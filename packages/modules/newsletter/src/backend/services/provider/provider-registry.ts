import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES } from '@endora-commerce/contracts';
import type { NewsletterSendProvider, ResolveResult } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
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

export interface NewsletterProviderRegistryOptions {
  /**
   * Whether a send with no usable e-mail credential may go to the console sink
   * (the server log). Defaults to `NODE_ENV !== 'production'`: a development or
   * test instance keeps working without a mail credential, a production one
   * refuses rather than reporting a campaign sent that reached no mailbox
   * (issue #1334).
   */
  allowConsoleSink?: boolean;
}

/**
 * Selects and builds the active newsletter sending provider (feature 048,
 * research R7; feature 058 — the credential reference is the single source).
 *
 * The `newsletter.email_credentials` reference (a reusable `email_adapter`
 * credential configuration) supplies the SMTP transport. When it is unset,
 * unresolvable, or names a provider with no wired transport (anything but
 * `smtp`), there is no usable credential: a development or test instance
 * falls back to the console sink, a production instance reports itself
 * unconfigured, so `send` refuses with `NEWSLETTER_PROVIDER_NOT_CONFIGURED`,
 * and hands out {@link UnconfiguredNewsletterProvider}, which fails each
 * message (issue #1334). Secrets are decrypted in-memory by
 * `CredentialsService.resolve`.
 */
export class NewsletterProviderRegistry {
  readonly allowsConsoleSink: boolean;

  constructor(
    private readonly settings: SettingsReadPort,
    private readonly credentials?: CredentialResolvePort,
    options: NewsletterProviderRegistryOptions = {},
  ) {
    this.allowsConsoleSink = options.allowConsoleSink ?? process.env['NODE_ENV'] !== 'production';
  }

  /**
   * Platform-wide (feature 072, D-41). The sending provider is one SMTP
   * transport for the deployment — `NewsletterProviderAdminService` writes it
   * with `setValueForAllChannels` — so a read scoped to a channel was always
   * asking the wrong question. It used to take a `platformChannelId` the root
   * resolved to the system-default channel, falling back to the `'default'`
   * sentinel; the name is gone rather than corrected, because a DI name
   * carrying a sentinel is one no static check can see.
   */
  private async getString(code: string): Promise<string> {
    return this.settings.get(code, null, z.string());
  }

  /**
   * Resolve the referenced SMTP config, or `null` when no usable reference is
   * configured.
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
    // provider (or an unavailable/inert reference) is no usable credential.
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
    return this.allowsConsoleSink ? new ConsoleNewsletterProvider() : new UnconfiguredNewsletterProvider();
  }

  /**
   * Gate for campaign sends (FR-017): a resolvable SMTP credential, or — on a
   * development or test instance only — the console sink.
   */
  async isConfigured(): Promise<boolean> {
    if (this.allowsConsoleSink) return true;
    return (await this.resolveCredentialSmtp()) !== null;
  }

  async resolveSender(): Promise<ResolvedSender> {
    const [fromEmail, fromName] = await Promise.all([
      this.getString(NEWSLETTER_SETTING_CODES.SENDER_FROM_EMAIL),
      this.getString(NEWSLETTER_SETTING_CODES.SENDER_FROM_NAME),
    ]);
    return { fromEmail, fromName };
  }
}

/** Why a message cannot leave a production instance with no usable credential. */
export const NO_USABLE_CREDENTIAL_ERROR =
  'No usable e-mail credential is chosen for the newsletter (setting newsletter.email_credentials), so nothing was sent.';

/**
 * The provider a production instance gets when no usable credential is chosen
 * (issue #1334). A campaign scheduled before its credential was removed reaches
 * dispatch through this: each send record is marked failed with the reason,
 * rather than marked sent after the message was only logged.
 */
export class UnconfiguredNewsletterProvider implements NewsletterSendProvider {
  async send(): Promise<{ providerMessageId?: string }> {
    throw new Error(NO_USABLE_CREDENTIAL_ERROR);
  }

  async verify(): Promise<{ ok: true } | { ok: false; error: string }> {
    return { ok: false, error: NO_USABLE_CREDENTIAL_ERROR };
  }
}
