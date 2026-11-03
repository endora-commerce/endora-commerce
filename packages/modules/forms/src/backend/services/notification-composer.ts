import { emailHtmlToPlainText, sanitizeEmailHtml } from '@endora-commerce/email-components/render/sanitize-email-html';
import {
  FORM_ADDRESS_PARTS,
  resolveTexts,
  type AnswerValue,
  type FormDefinition,
  type FormField,
} from '@endora-commerce/contracts';

/**
 * The two e-mails an entry becomes (`specs/170-forms-module/` FR-057, FR-058, A-3, research R-13),
 * composed in memory from the entry's own version and handed to the platform mailer; nothing here
 * is stored.
 *
 * - **The shop notification** lists the visible answers — the version's labels and option labels,
 *   in the language it is composed in with the version's default behind it — the page and, when
 *   there is a Reply-To, a line saying a reply reaches the sender. Its **subject names the form and
 *   nothing the shopper typed**: the mailer's delivery record keeps the subject, and FR-057 keeps the
 *   answers out of it.
 * - **The confirmation** is the operator's subject and rich text (`email.confirmation.*`) in the
 *   submission language, sanitised for e-mail clients, or the module's built-in wording; the answers
 *   are added only when the operator chose a summary.
 *
 * Hidden fields are context for the shop's systems, not something the shopper answered, so neither
 * e-mail lists them; layout elements answer nothing. Every answer is escaped in the HTML part.
 * Internal notes are not an input of either e-mail.
 */

/** A sentence of the module bundle (`mail.*`), already bound to the language of the e-mail. */
export type MailTranslate = (key: string, params?: Record<string, string | number>) => Promise<string>;

export interface ComposedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** What both e-mails are made of: the entry's answers and the version they were sent to. */
export interface NotificationSource {
  /** The form's admin-facing name — the shop's word for it. */
  readonly formName: string;
  readonly definition: FormDefinition;
  readonly versionDefaultLanguage: string;
  readonly answers: Readonly<Record<string, AnswerValue>>;
  readonly pageUrl: string | null;
}

interface AnswerRow {
  readonly label: string;
  readonly value: string;
  /** A multi-line answer is written under its label rather than beside it. */
  readonly multiline: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A rich operator text without its markup, for a label (a consent has no label of its own). */
function plainLabel(html: string): string {
  return emailHtmlToPlainText(html).replace(/\s+/g, ' ').trim();
}

function isAnswered(field: FormField): field is Extract<FormField, { key: string }> {
  return 'key' in field && field.type !== 'hidden';
}

/** The answers the e-mail lists, in the version's order, in one language. */
async function answerRows(source: NotificationSource, language: string, translate: MailTranslate): Promise<AnswerRow[]> {
  const text = resolveTexts(source.definition, language, source.versionDefaultLanguage);
  const [yes, no] = await Promise.all([translate('mail.yes'), translate('mail.no')]);
  const rows: AnswerRow[] = [];
  for (const section of source.definition.sections) {
    for (const field of section.fields) {
      if (!isAnswered(field) || !Object.prototype.hasOwnProperty.call(source.answers, field.key)) continue;
      const answer = source.answers[field.key]!;
      const content = text(`fields.${field.id}.content`);
      const label = text(`fields.${field.id}.label`) ?? (content ? plainLabel(content) : undefined) ?? field.key;
      const option = (value: string): string => {
        if (!('options' in field)) return value;
        const match = field.options.find((candidate) => candidate.value === value);
        return (match ? text(`fields.${field.id}.options.${match.id}`) : undefined) ?? value;
      };
      let value: string;
      if (typeof answer === 'boolean') value = answer ? yes : no;
      else if (typeof answer === 'number') value = String(answer);
      else if (typeof answer === 'string') value = option(answer);
      else if (Array.isArray(answer)) value = answer.map(option).join(', ');
      else {
        const parts = FORM_ADDRESS_PARTS.map((part) => answer[part]?.trim() ?? '');
        const [street, line2, postalCode, city, country] = parts;
        value = [street, line2, [postalCode, city].filter(Boolean).join(' '), country].filter(Boolean).join(', ');
      }
      if (value === '') continue;
      rows.push({ label, value, multiline: field.type === 'textarea' || value.includes('\n') });
    }
  }
  return rows;
}

function rowsText(rows: readonly AnswerRow[]): string[] {
  return rows.map((row) => (row.multiline ? `${row.label}:\n${row.value}` : `${row.label}: ${row.value}`));
}

const CELL = 'padding:4px 12px 4px 0;vertical-align:top;';

function rowsHtml(rows: readonly AnswerRow[]): string {
  if (rows.length === 0) return '';
  return `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;">${rows
    .map(
      (row) =>
        `<tr><th scope="row" style="${CELL}text-align:left;font-weight:600;">${escapeHtml(row.label)}</th>` +
        `<td style="${CELL}white-space:pre-wrap;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('')}</table>`;
}

function wrap(parts: readonly string[]): string {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#15202b;">',
    ...parts,
    '</div>',
  ].join('');
}

/** The shop notification of FR-057, in `language` — the channel's default (A-3). */
export async function composeShopNotification(
  input: NotificationSource & { readonly language: string; readonly translate: MailTranslate; readonly hasReplyTo: boolean },
): Promise<ComposedMail> {
  const { translate } = input;
  const subject = await translate('mail.notification.subject', { form: input.formName });
  const heading = await translate('mail.notification.heading', { form: input.formName });
  const rows = await answerRows(input, input.language, translate);
  const page = input.pageUrl ? { label: await translate('mail.notification.page'), value: input.pageUrl } : null;
  const replyHint = input.hasReplyTo ? await translate('mail.notification.replyHint') : null;
  const empty = rows.length === 0 ? await translate('mail.notification.noAnswers') : null;

  const text = [
    heading,
    '',
    ...(empty ? [empty] : rowsText(rows)),
    ...(page ? ['', `${page.label}: ${page.value}`] : []),
    ...(replyHint ? ['', replyHint] : []),
  ].join('\n');

  const html = wrap([
    `<p style="margin:0 0 16px;font-size:16px;"><strong>${escapeHtml(heading)}</strong></p>`,
    empty ? `<p style="margin:0 0 16px;">${escapeHtml(empty)}</p>` : rowsHtml(rows),
    page ? `<p style="margin:0 0 8px;">${escapeHtml(page.label)}: ${escapeHtml(page.value)}</p>` : '',
    replyHint ? `<p style="margin:16px 0 0;color:#5b6773;">${escapeHtml(replyHint)}</p>` : '',
  ]);
  return { subject, text, html };
}

/** The confirmation of FR-058, in `language` — the submission's. */
export async function composeConfirmation(
  input: NotificationSource & { readonly language: string; readonly translate: MailTranslate },
): Promise<ComposedMail> {
  const { translate } = input;
  const text = resolveTexts(input.definition, input.language, input.versionDefaultLanguage);
  const formTitle = text('form.title') ?? input.formName;
  const subject = text('email.confirmation.subject')?.trim() || (await translate('mail.confirmation.subject', { form: formTitle }));
  const operatorBody = text('email.confirmation.body');
  const bodyHtml = operatorBody ? sanitizeEmailHtml(operatorBody) : '';
  const bodyText = operatorBody ? emailHtmlToPlainText(operatorBody) : '';
  const body =
    bodyHtml !== ''
      ? { html: bodyHtml, text: bodyText }
      : await translate('mail.confirmation.body', { form: formTitle }).then((sentence) => ({
          html: `<p style="margin:0 0 16px;">${escapeHtml(sentence)}</p>`,
          text: sentence,
        }));

  const summary = input.definition.behaviour.confirmationEmail.includeSummary
    ? { heading: await translate('mail.confirmation.summary'), rows: await answerRows(input, input.language, translate) }
    : null;

  const plain = [
    body.text,
    ...(summary && summary.rows.length > 0 ? ['', `${summary.heading}:`, ...rowsText(summary.rows)] : []),
  ].join('\n');
  const html = wrap([
    body.html,
    summary && summary.rows.length > 0
      ? `<p style="margin:16px 0 4px;font-weight:600;">${escapeHtml(summary.heading)}</p>${rowsHtml(summary.rows)}`
      : '',
  ]);
  return { subject, text: plain, html };
}
