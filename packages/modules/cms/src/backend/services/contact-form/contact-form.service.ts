import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  LANGUAGE_FALLBACK,
  SUPPORTED_LANGUAGES,
  type AdminI18nTranslatePort,
  type ContactFormSubmission,
  type EmailMailerPort,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { composeContactFormMail } from './contact-form-mail.js';

/** The request's resolved sales channel, as far as the contact form reads it. */
export interface ContactFormChannel {
  id: string;
  /** The channel's name per language. */
  name: Readonly<Record<string, string>>;
  /** BCP-47, e.g. `pl-PL`; the e-mail is written in its primary subtag when a bundle exists. */
  defaultLanguage: string;
}

export interface ContactFormServiceDeps {
  /** `email`'s `emailMailer`, resolved per call by the caller's `lazyPort`. */
  mailer: EmailMailerPort;
  /** `_i18n`'s `adminI18nService`, resolved per call by the caller's `lazyPort`. */
  translator: AdminI18nTranslatePort;
  /** `cms.contact_form_recipients` for one channel, read per request. */
  readRecipients: (salesChannelId: string) => Promise<readonly string[]>;
}

/** The delivery record's `kind` for every contact-form message. */
export const CONTACT_FORM_MAIL_KIND = 'cms.contact_form';

/**
 * Feature 169 (FR-017–FR-019, research R-6) — one submission, one e-mail per configured
 * recipient of the request's channel, through the platform mailer, with the shopper as
 * Reply-To. Stores nothing: the mailer's own delivery record is handed a fixed subject, the
 * operator's address and no `meta`, so nothing the shopper typed reaches a table.
 */
export class ContactFormService {
  constructor(private readonly deps: ContactFormServiceDeps) {}

  async submit(submission: ContactFormSubmission, channel: ContactFormChannel): Promise<{ status: 'sent' }> {
    // A bot filled the field a person never sees: answer as if sent, send nothing.
    if (typeof submission.website === 'string' && submission.website.trim() !== '') return { status: 'sent' };

    const recipients = uniqueAddresses(await this.deps.readRecipients(channel.id));
    if (recipients.length === 0) {
      throw new HttpError(
        409,
        ERROR_CODES.CMS_CONTACT_FORM_UNAVAILABLE,
        'The contact form cannot send messages on this sales channel: no recipients are configured.',
      );
    }

    const language = mailLanguage(channel.defaultLanguage);
    const mail = await composeContactFormMail({
      submission,
      channelName: channelName(channel, language),
      translate: (key, params) => this.deps.translator.translate('cms', key, language, params),
    });

    const batch = randomUUID();
    const outcomes = await Promise.allSettled(
      recipients.map((to, index) =>
        this.deps.mailer.send({
          messageId: `cms-contact-${batch}-${index}`,
          to,
          replyTo: submission.email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          kind: CONTACT_FORM_MAIL_KIND,
          salesChannelId: channel.id,
        }),
      ),
    );
    if (outcomes.some((outcome) => outcome.status === 'fulfilled')) return { status: 'sent' };
    // Every send failed. The mailer recorded each failure with its transport detail; the
    // shopper is told only that the message did not go out.
    throw new HttpError(500, ERROR_CODES.INTERNAL, 'The message could not be sent.');
  }
}

function uniqueAddresses(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const address = typeof value === 'string' ? value.trim() : '';
    if (address === '' || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    out.push(address);
  }
  return out;
}

/** The channel's default language as a bundle language: `pl-PL` → `pl`; no bundle → English. */
export function mailLanguage(defaultLanguage: string): SupportedLanguage {
  const primary = defaultLanguage.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? (primary as SupportedLanguage) : LANGUAGE_FALLBACK;
}

function channelName(channel: ContactFormChannel, language: SupportedLanguage): string {
  const names = channel.name ?? {};
  return (
    names[channel.defaultLanguage] ??
    names[language] ??
    names[LANGUAGE_FALLBACK] ??
    Object.values(names).find((name) => typeof name === 'string' && name.trim() !== '') ??
    ''
  );
}
