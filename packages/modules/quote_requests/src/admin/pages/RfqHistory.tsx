import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  QUOTE_REQUEST_HISTORY_EVENT_WINDOW,
  customFieldCarrySkipReasonSchema,
  type QuoteRequestDelivery,
  type QuoteRequestHistory,
  type QuoteRequestHistoryActor,
  type QuoteRequestHistoryChange,
  type QuoteRequestHistoryEntry,
  type QuoteRequestHistoryLineRef,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, type BadgeProps } from '@endora-commerce/admin-kit/ui';
import { resolveCustomFieldLabel } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { adminNumberLocale, rfqNumberFormat } from '../number-format.js';

/**
 * Feature 146, T059 — the History tab of the admin quote request detail
 * (US2, US3; FR-010 – FR-018). It reads `GET /api/v1/admin/quote-requests/:id/history`
 * when the tab is opened and renders every entry as a translated sentence with
 * its date and actor; a `modified` entry lists its changes.
 *
 * **Free text is text** (threat model T17): notes, reasons and line notes are
 * typed by customers and operators, and reach the DOM only as React text
 * nodes — interpolated into a translated string at most, never as markup.
 *
 * Every key is `rfq.detail.history.*` in the `core` bundle, the one the host
 * screen reads; `history-bundle-coverage.test.ts` holds that every entry and
 * change kind has one in both languages.
 *
 * Feature 162 adds one entry whose sentences are this module's own bundle's
 * (`history.*` in `quote_requests`): custom-field values a Sales Opportunity
 * could not carry into the request. Its title is `core`'s, as every kind's is;
 * under it the Opportunity's number, then a field and a reason per line — the
 * field named by the label stored with the skip, in the reader's language
 * (owner ruling V3, 2026-10-21), its key for an entry recorded before.
 *
 * `specs/179-rfq-and-customer-notifications/` WP-06 (US5, FR-070) — an entry
 * that notified anybody lists its deliveries: who, through which channel, and
 * the outcome as a labelled badge (text, not colour alone), with the attempts
 * once there were any and, for a failed delivery, the last error behind a
 * disclosure so a long transport message does not crowd the timeline. Keys
 * `rfq.detail.history.delivery.*`, beside the rest.
 */

type T = (key: string, params?: Record<string, string | number>) => string;

/** The recorded role labels the platform writes, mapped to bundle keys. */
const ROLE_KEYS: Record<string, string> = {
  'Platform administrator': 'platformAdministrator',
  'Sales representative': 'salesRepresentative',
  Customer: 'customer',
  System: 'system',
  Administrator: 'administrator',
};

/** A field name shown to an operator is cut here. */
const SHOWN_KEY_LIMIT = 64;
const SKIP_REASONS: ReadonlySet<string> = new Set(customFieldCarrySkipReasonSchema.options);

interface Formatters {
  t: T;
  /** This module's own bundle (feature 162). */
  q: T;
  amount: (n: number | null) => string;
  /** A unit price: its significant places, up to four (owner ruling of 2026-10-25). */
  unitAmount: (n: number | null) => string;
  dateTime: (iso: string) => string;
  /** The name a carry-skip line gives its field: stored label (reader's language, then default), else the key. */
  fieldName: (skip: CarrySkip) => string;
}

type CarrySkip = NonNullable<QuoteRequestHistoryEntry['customFieldCarry']>['skipped'][number];

/** Built once per language and translator, not on every render (review fix N6). */
function useFormatters(): Formatters {
  const t = useTranslation('core');
  const q = useTranslation('quote_requests');
  const { language } = useTranslationContext();
  return useMemo(() => {
    const locale = adminNumberLocale(language);
    const numbers = rfqNumberFormat(locale);
    const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const h: T = (key, params) => t(`rfq.detail.history.${key}`, params);
    return {
      t: h,
      q,
      amount: (n) => (n === null ? h('none') : numbers.amount(n)),
      unitAmount: (n) => (n === null ? h('none') : numbers.unitAmount(n)),
      dateTime: (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? iso : dates.format(d);
      },
      fieldName: (skip) => {
        const name = skip.label ? resolveCustomFieldLabel(skip.label.labels, skip.label.labelDefault, language) : '';
        return shownKey(name === '' ? skip.key : name);
      },
    };
  }, [language, t, q]);
}

/**
 * A key per change that does not move when the list is re-read (review fix N6):
 * a change carries no id, so its kind and line name it, and a repeat of the same
 * pair — two additions of one product in two packagings — is numbered in order.
 */
function changeKeys(changes: readonly QuoteRequestHistoryChange[]): string[] {
  const seen = new Map<string, number>();
  return changes.map((change) => {
    const line = 'line' in change ? `${change.line.productId}/${change.line.variantId ?? ''}` : '';
    const base = `${change.kind}:${line}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

function roleLabel(t: T, recorded: string | null): string | null {
  if (recorded === null) return null;
  const key = ROLE_KEYS[recorded];
  return key ? t(`role.${key}`) : recorded;
}

/** The actor as one phrase: name + e-mail, name + role, "System", or role + "unknown user". */
function actorLabel(t: T, actor: QuoteRequestHistoryActor): string {
  if (actor.kind === 'system') return t('actor.system');
  const role = roleLabel(t, actor.recordedRole);
  const name = actor.kind === 'unknown' ? null : actor.name;
  if (name === null) {
    return role === null ? t('actor.unknownUser') : t('actor.withDetail', { name: t('actor.unknownUser'), detail: role });
  }
  const detail = actor.kind === 'customer' ? actor.email : role;
  return detail === null ? name : t('actor.withDetail', { name, detail });
}

function lineLabel(t: T, line: QuoteRequestHistoryLineRef): string {
  const label =
    line.variantLabel === null
      ? line.productName
      : t('lineWithVariant', { product: line.productName, variant: line.variantLabel });
  // Feature 159 (research N-32) — a product on several lines: which one.
  if (line.groupName === undefined) return label;
  return t('lineInGroup', { line: label, group: line.groupName ?? t('ungrouped') });
}

function changeSentence(f: Formatters, change: QuoteRequestHistoryChange): string {
  const { t } = f;
  const text = (v: string | null): string => v ?? t('none');
  switch (change.kind) {
    case 'header_note':
      return t('change.header_note', { before: text(change.before), after: text(change.after) });
    case 'line_added':
      return t('change.line_added', {
        line: lineLabel(t, change.line),
        quantity: change.quantity,
        price:
          change.agreedUnitPrice === null
            ? t('none')
            : t('money', { amount: f.unitAmount(change.agreedUnitPrice), currency: change.currency }),
      });
    case 'line_removed':
      return t('change.line_removed', { line: lineLabel(t, change.line) });
    case 'line_quantity':
      return t('change.line_quantity', {
        line: lineLabel(t, change.line),
        before: change.before,
        after: change.after,
      });
    case 'line_agreed_unit_price':
    case 'line_proposed_unit_price':
      return t(`change.${change.kind}`, {
        line: lineLabel(t, change.line),
        before: f.unitAmount(change.before),
        after: f.unitAmount(change.after),
        currency: change.currency,
      });
    case 'line_note':
      return t('change.line_note', {
        line: lineLabel(t, change.line),
        before: text(change.before),
        after: text(change.after),
      });
    case 'validity':
      if (change.before === null && change.after === null) return t('change.validity_removed', { before: t('none') });
      if (change.before === null) return t('change.validity_set', { after: f.dateTime(change.after!) });
      if (change.after === null) return t('change.validity_removed', { before: f.dateTime(change.before) });
      return t('change.validity', { before: f.dateTime(change.before), after: f.dateTime(change.after) });
    // Feature 159 — the grouping. Group names are operator content, shown as
    // recorded; `null` is the ungrouped section.
    case 'group_added':
    case 'group_removed':
      return t(`change.${change.kind}`, { name: change.group.name });
    case 'group_renamed':
      return t('change.group_renamed', { before: change.before, after: change.after });
    case 'line_group':
      return t('change.line_group', {
        line: lineLabel(t, change.line),
        before: change.before ?? t('ungrouped'),
        after: change.after ?? t('ungrouped'),
      });
    case 'line_order':
      return t('change.line_order');
  }
}

/** The badge a delivery status wears; its label always carries the meaning. */
function deliveryVariant(status: QuoteRequestDelivery['status']): BadgeProps['variant'] {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'pending') return 'secondary';
  return 'outline';
}

function DeliveryList({ deliveries, f }: { deliveries: readonly QuoteRequestDelivery[]; f: Formatters }): ReactNode {
  const { t } = f;
  const title = t('delivery.title');
  return (
    <div className="mt-2 border-t pt-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul aria-label={title} className="mt-1 space-y-1">
        {deliveries.map((delivery) => {
          const name = delivery.recipient.displayName === '' ? t('actor.unknownUser') : delivery.recipient.displayName;
          return (
            <li key={delivery.id} className="text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-words font-medium">
                  {t('actor.withDetail', { name, detail: t(`delivery.recipient.${delivery.recipient.kind}`) })}
                </span>
                <span className="text-muted-foreground">{t(`delivery.channel.${delivery.channel}`)}</span>
                <Badge variant={deliveryVariant(delivery.status)}>{t(`delivery.status.${delivery.status}`)}</Badge>
                {delivery.attempts > 0 ? (
                  <span className="text-muted-foreground">{t('delivery.attempts', { count: delivery.attempts })}</span>
                ) : null}
                {delivery.closedAt !== null ? (
                  <time className="text-muted-foreground" dateTime={delivery.closedAt}>
                    {f.dateTime(delivery.closedAt)}
                  </time>
                ) : null}
              </div>
              {delivery.status === 'failed' ? (
                <details className="mt-1">
                  <summary className="inline-flex min-h-6 cursor-pointer items-center rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t('delivery.showError')}
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                    {delivery.lastError ?? t('delivery.noError')}
                  </p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shownKey(key: string): string {
  return key.length > SHOWN_KEY_LIMIT ? `${key.slice(0, SHOWN_KEY_LIMIT)}…` : key;
}

function HistoryEntry({ entry, f }: { entry: QuoteRequestHistoryEntry; f: Formatters }): ReactNode {
  const { t, q, fieldName } = f;
  const keys = entry.changes === null ? [] : changeKeys(entry.changes);
  const carry = entry.customFieldCarry ?? null;
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <time dateTime={entry.occurredAt}>{f.dateTime(entry.occurredAt)}</time>
        <span>{actorLabel(t, entry.actor)}</span>
        {entry.revisionNumber !== null ? <span>{t('revision', { number: entry.revisionNumber })}</span> : null}
      </div>
      <p className="font-medium">{t(`entry.${entry.kind}`)}</p>
      {carry !== null ? (
        <p className="mt-1 break-words text-muted-foreground">
          {q('history.carrySource', { reference: carry.source.reference })}
        </p>
      ) : null}
      {carry !== null ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {carry.skipped.map((skip) => (
            <li key={skip.key} className="break-words">
              {q('history.carryLine', {
                field: fieldName(skip),
                // A reason this screen does not know yet reads as the generic sentence, never as its code.
                reason: SKIP_REASONS.has(skip.reason)
                  ? q(`history.carryReason.${skip.reason}`)
                  : q('history.carryReasonUnknown'),
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {entry.reason !== null ? (
        <p className="mt-1 whitespace-pre-wrap break-words">{t('reason', { text: entry.reason })}</p>
      ) : null}
      {entry.note !== null ? (
        <p className="mt-1 whitespace-pre-wrap break-words">{t('note', { text: entry.note })}</p>
      ) : null}
      {entry.relatedQuoteRequestId !== null ? (
        <p className="mt-1 text-muted-foreground">
          {t('relatedRequest', { id: entry.relatedQuoteRequestId.slice(0, 8) })}
        </p>
      ) : null}
      {entry.orderId !== null ? (
        <p className="mt-1 text-muted-foreground">{t('order', { id: entry.orderId.slice(0, 8) })}</p>
      ) : null}
      {entry.delivery ? (
        <div className="mt-1 space-y-0.5 text-muted-foreground">
          <p className="break-words">{t('pdfSent.recipients', { recipients: entry.delivery.recipients.join(', ') })}</p>
          <p>
            {entry.delivery.templateName !== null
              ? t('pdfSent.template', { name: entry.delivery.templateName })
              : t('pdfSent.builtIn')}
          </p>
          {entry.delivery.language !== null ? <p>{t('pdfSent.language', { language: entry.delivery.language })}</p> : null}
          {entry.delivery.message !== null ? (
            <p className="whitespace-pre-wrap break-words">{t('pdfSent.message', { message: entry.delivery.message })}</p>
          ) : null}
        </div>
      ) : null}
      {entry.changes !== null ? (
        entry.changes.length === 0 ? (
          <p className="mt-1 text-muted-foreground">{t('noChanges')}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {entry.changes.map((change, i) => (
              <li key={keys[i]} className="whitespace-pre-wrap break-words">
                {changeSentence(f, change)}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {entry.deliveries && entry.deliveries.length > 0 ? <DeliveryList deliveries={entry.deliveries} f={f} /> : null}
    </li>
  );
}

export function RfqHistory({ quoteRequestId }: { quoteRequestId: string }): ReactNode {
  const f = useFormatters();
  const { t } = f;
  const [history, setHistory] = useState<QuoteRequestHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setHistory(null);
    setFailed(false);
    apiClient
      .get<{ data: QuoteRequestHistory }>(`/api/v1/admin/quote-requests/${quoteRequestId}/history`)
      .then((res) => {
        if (live) setHistory(res.data);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return (): void => {
      live = false;
    };
  }, [quoteRequestId, attempt]);

  const loading = history === null && !failed;

  return (
    <div className="space-y-3" aria-busy={loading}>
      {/* Mounted before it has text, so the loading message is announced (WCAG 4.1.3). */}
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {loading ? t('loading') : null}
      </p>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{t('error')}</span>
            <Button type="button" size="sm" variant="outline" onClick={(): void => setAttempt((n) => n + 1)}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {history?.truncated ? (
        <Alert>
          <AlertDescription>{t('truncated', { count: QUOTE_REQUEST_HISTORY_EVENT_WINDOW })}</AlertDescription>
        </Alert>
      ) : null}
      {history !== null && history.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      {history !== null && history.entries.length > 0 ? (
        <ul className="space-y-2">
          {history.entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} f={f} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
