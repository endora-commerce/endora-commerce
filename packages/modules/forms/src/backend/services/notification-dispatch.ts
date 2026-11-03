import { createHash } from 'node:crypto';
import {
  supportedLanguageOf,
  type AnswerValue,
  type EmailMailerPort,
  type FormDefinition,
  type FormEntryStatus,
} from '@endora-commerce/contracts';
import type { CommandContext } from '@endora-commerce/platform/commands';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { Form } from '../entities/form.entity.js';
import { FormEntry } from '../entities/form-entry.entity.js';
import { FormVersion } from '../entities/form-version.entity.js';
import { composeConfirmation, composeShopNotification, type NotificationSource } from './notification-composer.js';

/**
 * What one `forms-notifications` job does (`specs/170-forms-module/` research R-13, FR-057 – FR-059,
 * US5-6): the body of the worker, written without BullMQ so it can be driven directly.
 *
 * 1. **Presence first** — a module that is off does no work and loses none: the job fails with
 *    `ModuleDisabledError` before anything is read, so it is tried again (the worker seam's own work
 *    gate normally answers first and puts the job back without consuming an attempt).
 * 2. **The entry as it is now** — gone (deleted since) or `spam`: nothing is sent (US5-6).
 * 3. **One message per recipient of the entry's channel** — the channel's list when the form has one
 *   for it, which *replaces* the default list, else the default (A-2); addresses compared without
 *    case, each once. `messageId` `forms-<entryId>-shop-<key>` ({@link recipientKey}), `replyTo` the submitter e-mail answer
 *    when it was visible and present, kind `forms.entry_notification`, no `meta` — the delivery
 *    record keeps recipient, kind and subject only (FR-057).
 * 4. **At most one confirmation** (FR-058) — when the version asks for one and the submitter e-mail
 *    is there: claimed on the entry (`confirmation_sent_at`) **before** it is sent, so two workers or
 *    two attempts never both send it, and the claim is given back when the send fails, so the retry
 *    may send it. A process that dies between the claim and the send sends none — "at most once".
 * 5. **A transport failure is rethrown** for BullMQ's retry — after every other message was tried,
 *    so one bad address does not hold back the rest. Which shop messages already went out is kept on
 *    the job's own progress as one {@link recipientKey} per address (never an address, an index or
 *    an answer), so a retry sends only the others — even when the list was reordered or edited
 *    between the attempts, which would make a position name a different address. The submission answered long before (FR-059); the failure is in `email`'s delivery
 *    records, written by the platform's recording mailer.
 */

type Em = CommandContext['em'];

/** The entry, its form and its version, as the two e-mails need them. */
export interface NotificationSubject {
  readonly entry: {
    readonly id: string;
    readonly status: FormEntryStatus;
    readonly salesChannelId: string;
    readonly language: string;
    readonly pageUrl: string | null;
    readonly answers: Readonly<Record<string, AnswerValue>>;
    /** The submitter e-mail answer, lower-cased; `null` when it was hidden or left empty. */
    readonly submitterEmail: string | null;
  };
  readonly form: {
    readonly name: string;
    readonly recipients: readonly string[];
    readonly channelRecipients: Readonly<Record<string, readonly string[]>>;
  };
  readonly version: { readonly definition: FormDefinition; readonly defaultLanguage: string };
}

/** Where the processor reads the entry and keeps the confirmation's once-only stamp. */
export interface NotificationStore {
  /** `null` when the entry, its form or its version no longer exists. */
  load(entryId: string): Promise<NotificationSubject | null>;
  /** Stamp `confirmation_sent_at` if it is not stamped yet; whether this call stamped it. */
  claimConfirmation(entryId: string): Promise<boolean>;
  /** Clear a stamp this processor set for a confirmation that was not sent. */
  releaseConfirmation(entryId: string): Promise<void>;
}

/** What an earlier attempt of the same job already sent, and how to record more of it. */
export interface DispatchAttempt {
  /** The {@link recipientKey}s of the shop messages already handed to the mailer. */
  readonly sent: readonly string[];
  record(sent: readonly string[]): Promise<void>;
}

export interface NotificationJob {
  readonly entryId: string;
  /** The channel's default language when the entry was accepted (A-3). */
  readonly shopLanguage: string;
}

export interface DispatchReport {
  readonly skipped?: 'gone' | 'spam';
  readonly shopSent: number;
  readonly confirmation: 'sent' | 'already_sent' | 'not_wanted' | 'failed';
}

export interface NotificationDispatchDeps {
  /** Whether `forms` is effectively present — asked before anything else. */
  readonly isPresent: () => boolean;
  readonly store: NotificationStore;
  readonly mailer: EmailMailerPort;
  /** A sentence of the module bundle in `language` (any BCP 47 tag; the bundle picks its own). */
  readonly translate: (language: string, key: string, params?: Record<string, string | number>) => Promise<string>;
}

export const SHOP_NOTIFICATION_KIND = 'forms.entry_notification';
export const CONFIRMATION_KIND = 'forms.entry_confirmation';

/** The recipients of the entry's channel: its own list replaces the default (A-2); each address once. */
export function recipientsFor(form: NotificationSubject['form'], salesChannelId: string): string[] {
  const list = Object.prototype.hasOwnProperty.call(form.channelRecipients, salesChannelId)
    ? form.channelRecipients[salesChannelId]!
    : form.recipients;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const address of list) {
    const trimmed = address.trim();
    const key = trimmed.toLowerCase();
    if (trimmed === '' || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

/**
 * A stable, non-reversible name for one recipient of one entry: the first 16 hex digits of the
 * SHA-256 of the entry id and the lower-cased address. It is what the job's progress keeps of a
 * message already sent and what the shop message's `messageId` ends with, so neither depends on
 * the recipient's position in a list that may change between attempts, and the progress in Redis
 * never holds the address. The entry id in the input keeps the same address from producing the
 * same key across entries.
 */
export function recipientKey(entryId: string, address: string): string {
  return createHash('sha256').update(`${entryId}\n${address.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

export class NotificationDispatch {
  constructor(private readonly deps: NotificationDispatchDeps) {}

  async dispatch(job: NotificationJob, attempt?: DispatchAttempt): Promise<DispatchReport> {
    if (!this.deps.isPresent()) throw new ModuleDisabledError('forms');

    const subject = await this.deps.store.load(job.entryId);
    if (!subject) return { skipped: 'gone', shopSent: 0, confirmation: 'not_wanted' };
    if (subject.entry.status === 'spam') return { skipped: 'spam', shopSent: 0, confirmation: 'not_wanted' };

    const { entry, form, version } = subject;
    const source: NotificationSource = {
      formName: form.name,
      definition: version.definition,
      versionDefaultLanguage: version.defaultLanguage,
      answers: entry.answers,
      pageUrl: entry.pageUrl,
    };
    const replyTo = entry.submitterEmail ?? undefined;
    const failures: unknown[] = [];

    // Step 3 — the shop.
    const recipients = recipientsFor(form, entry.salesChannelId);
    const sent = new Set(attempt?.sent ?? []);
    let shopSent = 0;
    if (recipients.length > 0) {
      const mail = await composeShopNotification({
        ...source,
        language: job.shopLanguage,
        translate: (key, params) => this.deps.translate(job.shopLanguage, key, params),
        hasReplyTo: replyTo !== undefined,
      });
      for (const to of recipients) {
        const key = recipientKey(entry.id, to);
        if (sent.has(key)) continue;
        try {
          await this.deps.mailer.send({
            messageId: `forms-${entry.id}-shop-${key}`,
            to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            kind: SHOP_NOTIFICATION_KIND,
            salesChannelId: entry.salesChannelId,
            ...(replyTo !== undefined ? { replyTo } : {}),
          });
          sent.add(key);
          shopSent += 1;
        } catch (error) {
          failures.push(error);
        }
      }
      if (attempt && shopSent > 0) await attempt.record([...sent].sort());
    }

    // Step 4 — the submitter.
    let confirmation: DispatchReport['confirmation'] = 'not_wanted';
    if (version.definition.behaviour.confirmationEmail.enabled && entry.submitterEmail) {
      if (!(await this.deps.store.claimConfirmation(entry.id))) {
        confirmation = 'already_sent';
      } else {
        try {
          const mail = await composeConfirmation({
            ...source,
            language: entry.language,
            translate: (key, params) => this.deps.translate(entry.language, key, params),
          });
          await this.deps.mailer.send({
            messageId: `forms-${entry.id}-confirmation`,
            to: entry.submitterEmail,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            kind: CONFIRMATION_KIND,
            salesChannelId: entry.salesChannelId,
          });
          confirmation = 'sent';
        } catch (error) {
          await this.deps.store.releaseConfirmation(entry.id);
          confirmation = 'failed';
          failures.push(error);
        }
      }
    }

    // Step 5 — BullMQ tries the job again; the next attempt sends only what did not go.
    if (failures.length > 0) throw failures[0];
    return { shopSent, confirmation };
  }
}

/**
 * The store over the module's tables. **Called inside the system scope the worker enters** — there
 * is no request behind a job, and the entry is read by id whoever it belongs to — so the reads
 * still pass through the tenancy guard, which the scope opens; nothing here widens it.
 */
export function createNotificationStore(emFactory: () => Em, now: () => Date = () => new Date()): NotificationStore {
  return {
    async load(entryId) {
      const em = emFactory();
      const entry = await em.findOne(FormEntry, { id: entryId });
      if (!entry) return null;
      const [form, version] = await Promise.all([
        em.findOne(Form, { id: entry.formId }),
        em.findOne(FormVersion, { id: entry.formVersionId }),
      ]);
      if (!form || !version) return null;
      return {
        entry: {
          id: entry.id,
          status: entry.status,
          salesChannelId: entry.salesChannelId,
          language: entry.language,
          pageUrl: entry.pageUrl ?? null,
          answers: entry.answers,
          submitterEmail: entry.submitterEmail ?? null,
        },
        form: { name: form.name, recipients: form.recipients, channelRecipients: form.channelRecipients },
        version: { definition: version.definition, defaultLanguage: version.defaultLanguage },
      };
    },
    async claimConfirmation(entryId) {
      // command-coverage-ignore: delivery bookkeeping, not a domain change — the once-only stamp of
      // FR-058, claimed and given back by the notification job; the send itself is recorded by
      // `email`'s delivery record, and an audit row per confirmation would hold nothing more.
      const claimed = await emFactory().nativeUpdate(FormEntry, { id: entryId, confirmationSentAt: null }, { confirmationSentAt: now() });
      return claimed === 1;
    },
    async releaseConfirmation(entryId) {
      await emFactory().nativeUpdate(FormEntry, { id: entryId }, { confirmationSentAt: null });
    },
  };
}

/** The translate dependency over `adminI18nService`: the bundle language nearest to the tag. */
export function bundleTranslate(i18n: {
  translate(moduleId: string, key: string, language: ReturnType<typeof supportedLanguageOf>, params?: Record<string, string | number>): Promise<string>;
}): NotificationDispatchDeps['translate'] {
  return (language, key, params) => i18n.translate('forms', key, supportedLanguageOf(language), params);
}
