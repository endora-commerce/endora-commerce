import { Fragment, type ReactNode } from 'react';
import { MESSAGES, type MessageKey } from '../i18n/messages';

/**
 * Small catalogue helpers for the account area (issue #85): counted sentences,
 * labels for API codes, and sentences whose placeholder is markup. Pure — safe
 * in a server and a client component alike.
 */

type Translate = (key: MessageKey) => string;

/** The key of a counted sentence's plural form: `${base}.one` / `.few` / `.many` / `.other`. */
export function pluralKey(base: string, count: number, locale: string): MessageKey {
  let form: Intl.LDMLPluralRule;
  try {
    form = new Intl.PluralRules(locale).select(count);
  } catch {
    form = 'other';
  }
  // The catalogue carries one/few/many/other; `zero`/`two` (no supported
  // language uses them) read as `other`.
  const known = form === 'one' || form === 'few' || form === 'many' ? form : 'other';
  return `${base}.${known}` as MessageKey;
}

/**
 * The label of an API code (`account.paymentStatus.paid`), or the code itself
 * when the catalogue has no label for it — a value the API added later reads as
 * its code, never as a catalogue key.
 */
export function codeLabel(t: Translate, prefix: string, code: string): string {
  const key = `${prefix}.${code}`;
  return Object.prototype.hasOwnProperty.call(MESSAGES['en-US'], key) ? t(key as MessageKey) : code;
}

/**
 * A catalogue sentence whose `{name}` placeholders are markup — a bold order
 * number, a link — rather than strings (`format` covers those). The sentence
 * stays whole in the catalogue, so each language places the markup where its
 * own word order puts it. A placeholder with no value is left as written.
 */
export function richText(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode {
  const parts = template.split(/\{(\w+)\}/g);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part === '' ? null : <Fragment key={i}>{part}</Fragment>;
    return Object.prototype.hasOwnProperty.call(values, part) ? (
      <Fragment key={i}>{values[part]}</Fragment>
    ) : (
      <Fragment key={i}>{`{${part}}`}</Fragment>
    );
  });
}

/** The catalogue key of a quote request's status badge (`RfqStatus` is the API's own wording). */
const QUOTE_REQUEST_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  Pending: 'account.quoteRequestStatus.pending',
  'Created from admin': 'account.quoteRequestStatus.createdFromAdmin',
  Approved: 'account.quoteRequestStatus.approved',
  Completed: 'account.quoteRequestStatus.completed',
  Canceled: 'account.quoteRequestStatus.canceled',
  Expired: 'account.quoteRequestStatus.expired',
};

/** A quote request status in the page's language, or the status itself for one this catalogue does not know. */
export function quoteRequestStatusLabel(t: Translate, status: string): string {
  const key = QUOTE_REQUEST_STATUS_KEYS[status];
  return key ? t(key) : status;
}

/** The catalogue key of a quote-request history event (`eventType` as the API writes it). */
const QUOTE_REQUEST_EVENT_KEYS: Readonly<Record<string, MessageKey>> = {
  created: 'account.quoteRequest.event.created',
  submitted: 'account.quoteRequest.event.submitted',
  modified: 'account.quoteRequest.event.modified',
  approved: 'account.quoteRequest.event.approved',
  canceled: 'account.quoteRequest.event.canceled',
  expired: 'account.quoteRequest.event.expired',
  completed: 'account.quoteRequest.event.completed',
  'customer-accepted-revision': 'account.quoteRequest.event.customerAcceptedRevision',
  'customer-rejected-revision': 'account.quoteRequest.event.customerRejectedRevision',
  're-submitted': 'account.quoteRequest.event.resubmitted',
  'note-added': 'account.quoteRequest.event.noteAdded',
};

/** A quote-request history event in the page's language, or its type for one this catalogue does not know. */
export function quoteRequestEventLabel(t: Translate, eventType: string): string {
  const key = QUOTE_REQUEST_EVENT_KEYS[eventType];
  return key ? t(key) : eventType;
}
