import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, History } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityHistoryEntry,
  OpportunityWorkflowStatus,
} from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import {
  humaniseKey,
  LABELLED_HISTORY_FIELDS,
  SILENT_HISTORY_FIELDS,
} from '../lib/history-fields.js';
import {
  calendarDateLabel,
  errorMessage,
  moneyLabel,
  NO_VALUE,
  orderStatusLabel,
  workflowStatusLabel,
} from '../lib/labels.js';
import {
  customFieldLabel,
  customFieldValueLabel,
  useCanSeeCustomFields,
  useOpportunityFieldDefinitions,
} from './OpportunityCustomFields.js';

const PAGE_SIZE = 50;
/** A long text (a description, a note) is cut here; the whole of it is where it lives. */
const TEXT_LIMIT = 280;
const ORDERS_READ = 'orders:read';
const RETRY_ACTION = 'crm.opportunity.propagation_retry';
const NOT_FOLLOWED_ACTION = 'crm.opportunity.propagation_skip';

type State = Record<string, unknown>;

/** One field of an entry, as it was and as it is. `before` is absent for a state that only arrived. */
export interface HistoryChange {
  field: string;
  before?: unknown;
  after: unknown;
}

function asState(value: unknown): State | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as State)
    : null;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What an entry changed, field by field: for an edit the fields whose value
 * differs, for something that only appeared (a creation, a link, a note) the
 * fields it arrived with, for something removed the fields it had.
 *
 * The status of a status change and its cause are not here — the entry shows
 * them as a sentence of their own.
 *
 * **A retry is one statement, not an edit.** Its `before` is the refusal it
 * starts from and its `after` the attempt it opens, so the two share almost no
 * key and a field-by-field comparison reads "outcome: refused → nothing". What
 * it says instead: which Order, the status asked of it, and the refusal that is
 * being retried — under a name of its own (`retriedOutcome`), because the
 * entry does not carry what the retry led to.
 */
export function historyChanges(
  entry: Pick<OpportunityHistoryEntry, 'before' | 'after'> & { action?: string },
): HistoryChange[] {
  const before = asState(entry.before);
  const after = asState(entry.after);
  const shown = (field: string): boolean => !SILENT_HISTORY_FIELDS.has(field);
  if (before && after && entry.action === RETRY_ACTION) {
    const { outcome, ...rest } = before;
    return historyChanges({ before: null, after: { ...rest, retriedOutcome: outcome, ...after } });
  }
  if (before && after) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(shown)
      .filter((field) => !same(before[field], after[field]))
      .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
  }
  const only = after ?? before;
  if (!only) return [];
  return Object.keys(only)
    .filter(shown)
    .filter((field) => only[field] !== null && only[field] !== undefined && only[field] !== '')
    .map((field) => ({ field, after: only[field] }));
}

export interface OpportunityHistoryProps {
  opportunity: OpportunityDetail;
}

/**
 * The change history of one Opportunity (User Story 11, FR-052): what was
 * done, by whom and when, newest first, read from
 * `GET /opportunities/:id/history` a page at a time.
 *
 * **Every entry is a sentence, not a record.** Its heading is the label of the
 * audited action — `auditLog.<action>` in this module's bundle, the same
 * sentence the platform-wide audit log shows. A status change says *from* and
 * *to* in the statuses' names, never their codes, and — when an Order caused
 * it — names that Order and links to it. Anything else lists the fields that
 * changed, as they were and as they are, with identifiers replaced by what
 * they name wherever this screen knows it (the assignee, the Organization, a
 * linked Order) and left out where it does not.
 *
 * **Nothing is shown as it is stored.** Every key an audited state can carry
 * has a label (`lib/history-fields.ts`, held to the services by
 * `index.test.ts`); custom field values are a line per field under the
 * field's own label, or its code for a reader who may not read the
 * definitions; an outcome is the sentence the Overview's propagation section
 * says; an Order status is its name, and is a row only for somebody holding
 * `orders:read`. A key this screen was never told about is "Other change" with
 * the key in words — never the key itself, never JSON.
 *
 * The history is cursor-paginated: *Show earlier changes* appends the next
 * page under the ones already read, so a reader scanning back keeps their
 * place.
 */
export function OpportunityHistory(props: OpportunityHistoryProps): ReactNode {
  const { opportunity } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const canReadOrders = useAuth().hasPermission(ORDERS_READ);
  const canSeeCustomFields = useCanSeeCustomFields();
  const [entries, setEntries] = useState<OpportunityHistoryEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [statuses, setStatuses] = useState<OpportunityWorkflowStatus[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const sequence = useRef(0);

  const load = useCallback(
    async (cursor: string | null): Promise<void> => {
      const current = ++sequence.current;
      setLoading(true);
      setError(null);
      try {
        const page = await crmApi.getHistory(opportunity.id, {
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        if (current !== sequence.current) return;
        setEntries((previous) => (cursor ? [...(previous ?? []), ...page.data] : page.data));
        setNextCursor(page.pagination.hasMore ? page.pagination.cursor : null);
        if (cursor) setNotice(t('history.loadedMore', { count: page.data.length }));
      } catch (failure) {
        if (current === sequence.current) setError(errorMessage(failure, t('history.error.load')));
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [opportunity.id, t],
  );

  // The history is read again when the Opportunity on screen changes: a move
  // made on the Overview is the newest entry here.
  useEffect(() => {
    void load(null);
  }, [load, opportunity.updatedAt, opportunity.version]);

  // Status names are the workflow's; without them the codes are shown.
  useEffect(() => {
    let alive = true;
    crmApi
      .getWorkflow()
      .then((workflow) => {
        if (alive) setStatuses(workflow.statuses);
      })
      .catch(() => {
        if (alive) setStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  /** Whether any entry read so far carries `field` — what decides if its names are worth asking for. */
  const carries = useCallback(
    (field: string): boolean =>
      (entries ?? []).some(
        (entry) => field in (asState(entry.before) ?? {}) || field in (asState(entry.after) ?? {}),
      ),
    [entries],
  );

  // Order status names are `orders`' and need `orders:read` — the source the
  // Overview's linked Orders use. Asked only once an entry names a status.
  const wantsOrderStatuses = canReadOrders && carries('orderStatusCode');
  useEffect(() => {
    if (!wantsOrderStatuses) return undefined;
    let alive = true;
    crmApi
      .listOrderStatuses()
      .then((found) => {
        if (alive) setOrderStatuses(found);
      })
      .catch(() => {
        if (alive) setOrderStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, [wantsOrderStatuses]);

  // The fields' own labels, for somebody `custom_fields` lets read them.
  const { definitions } = useOpportunityFieldDefinitions(
    canSeeCustomFields && carries('customFieldValues'),
  );

  /** Administrators this page can name: the assignee and everybody who acted. */
  const people = useMemo(() => {
    const names = new Map<string, string>();
    if (opportunity.assignee) names.set(opportunity.assignee.id, opportunity.assignee.name);
    for (const entry of entries ?? []) {
      if (entry.actor.id && entry.actor.name) names.set(entry.actor.id, entry.actor.name);
    }
    return names;
  }, [entries, opportunity.assignee]);

  const statusName = (code: unknown): string => {
    if (typeof code !== 'string' || code === '') return NO_VALUE;
    const status = statuses.find((item) => item.code === code);
    return status ? workflowStatusLabel(status, language) : code;
  };

  const document = (kind: unknown, id: unknown): ReactNode => {
    const documentKind = kind === 'quote_request' ? 'quote_request' : 'order';
    const label = t(`value.excluded.kind.${documentKind}`);
    if (typeof id !== 'string') return label;
    const link = opportunity.links.find(
      (item) => item.documentKind === documentKind && item.documentId === id,
    );
    const to = documentKind === 'order' ? `/orders/${id}` : `/quote-requests/${id}`;
    return (
      <Link to={to} className="text-primary underline-offset-4 hover:underline">
        {link?.available && link.number
          ? `${label} ${link.number}`
          : t(`history.document.open.${documentKind}`)}
      </Link>
    );
  };

  const value = (field: string, raw: unknown, entry: OpportunityHistoryEntry): ReactNode => {
    if (raw === null || raw === undefined || raw === '') return NO_VALUE;
    switch (field) {
      case 'skippedStatus':
      case 'statusCode':
        return statusName(raw);
      case 'valueMode':
        return raw === 'computed' ? t('value.mode.computed') : t('value.mode.manual');
      case 'manualValue':
        return moneyLabel(String(raw), opportunity.currency);
      case 'expectedCloseDate':
        return calendarDateLabel(String(raw));
      case 'documentKind':
        return t(`value.excluded.kind.${raw === 'quote_request' ? 'quote_request' : 'order'}`);
      case 'documentId': {
        const state = asState(entry.after) ?? asState(entry.before);
        return document(state?.documentKind, raw);
      }
      case 'linkedDocument': {
        const linked = asState(raw);
        return document(linked?.documentKind, linked?.documentId);
      }
      case 'orderId':
        return document('order', raw);
      case 'assignedAdminUserId':
        return people.get(String(raw)) ?? t('history.value.someone');
      case 'organizationId':
        // An Opportunity's Organization is the one on this screen.
        return raw === opportunity.organization.id
          ? opportunity.organization.name
          : t('history.value.set');
      case 'customerAccountId':
        return opportunity.customerAccount && raw === opportunity.customerAccount.id
          ? opportunity.customerAccount.name
          : t('history.value.set');
      case 'salesChannelId':
        // The detail carries the channel's id, not its name.
        return t('history.value.set');
      case 'orderStatusCode':
        return orderStatusLabel(String(raw), orderStatuses, language);
      case 'outcome':
      case 'retriedOutcome':
        return outcome(String(raw), entry);
      case 'source':
        return t(`opportunity.source.${raw === 'order' || raw === 'quote_request' ? raw : 'manual'}`);
      case 'linkSource':
        return t(
          `history.linkSource.${
            raw === 'auto' || raw === 'created_from_opportunity' || raw === 'quote_conversion'
              ? raw
              : 'manual'
          }`,
        );
      case 'kind':
        return raw === 'message' ? t('history.kind.message') : t('history.kind.note');
      default:
        break;
    }
    if (typeof raw === 'boolean') return raw ? t('links.following.on') : t('links.following.off');
    return plain(raw);
  };

  /** Any value in words: a list as a list, a structure as `name: value` pairs — never JSON. */
  const plain = (raw: unknown): string => {
    if (raw === null || raw === undefined || raw === '') return NO_VALUE;
    if (typeof raw === 'boolean') return raw ? t('links.following.on') : t('links.following.off');
    if (Array.isArray(raw)) return raw.length === 0 ? NO_VALUE : raw.map(plain).join(', ');
    if (typeof raw === 'object') {
      const pairs = Object.entries(raw).map(([key, item]) => `${humaniseKey(key)}: ${plain(item)}`);
      return pairs.length === 0 ? NO_VALUE : pairs.join('; ');
    }
    const text = String(raw);
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
  };

  /**
   * An outcome as a sentence. For an Order that did not follow the Opportunity
   * it is the sentence of the Overview's propagation section, with the status
   * that was asked of the Order named as that section names it. For an
   * Opportunity that did not follow an Order the direction is the other one,
   * and so are the words.
   */
  const outcome = (code: string, entry: OpportunityHistoryEntry): string => {
    if (entry.action === NOT_FOLLOWED_ACTION) {
      return t(`history.notFollowed.${code === 'failed' ? 'failed' : 'skipped'}`);
    }
    const state = { ...asState(entry.before), ...asState(entry.after) };
    const status =
      typeof state.orderStatusCode === 'string'
        ? orderStatusLabel(state.orderStatusCode, orderStatuses, language)
        : NO_VALUE;
    const key = `propagation.outcome.${code}`;
    const sentence = t(key, { status });
    // An outcome this bundle has no sentence for is still words, not a code.
    return sentence === key ? humaniseKey(code) : sentence;
  };

  const fieldLabel = (field: string): string =>
    LABELLED_HISTORY_FIELDS.has(field)
      ? t(`history.field.${field}`)
      : t('history.field.other', { field: humaniseKey(field) });

  /** Custom field values: a line per field — every one that arrived, or only the ones an edit changed. */
  const customFields = (change: HistoryChange): ReactNode => {
    const edited = 'before' in change;
    const before = asState(change.before) ?? {};
    const after = asState(change.after) ?? {};
    const words = { yes: t('customFields.value.yes'), no: t('customFields.value.no') };
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) =>
      edited
        ? !same(before[key], after[key])
        : after[key] !== null && after[key] !== undefined && after[key] !== '',
    );
    if (keys.length === 0) return NO_VALUE;
    return (
      <ul className="space-y-0.5">
        {keys.map((key) => {
          const definition = definitions.find((candidate) => candidate.key === key);
          const shownValue = (raw: unknown): string =>
            customFieldValueLabel(definition, raw, language, words);
          return (
            <li key={key}>
              <span className="text-muted-foreground">{customFieldLabel(definition, key, language)}</span>
              {': '}
              {edited ? (
                <>
                  <span className="sr-only">{t('history.status.from')}</span>
                  <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                    {shownValue(before[key])}
                  </span>
                  <ArrowRight aria-hidden="true" className="mx-1.5 inline size-3.5 text-muted-foreground" />
                  <span className="sr-only">{t('history.status.to')}</span>
                </>
              ) : null}
              <span>{shownValue(after[key])}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  const actor = (entry: OpportunityHistoryEntry): string => {
    if (entry.actor.kind !== 'admin') return t('history.actor.system');
    return entry.actor.name ?? t('history.actor.deleted');
  };

  const heading = (entry: OpportunityHistoryEntry): string => {
    const key = `auditLog.${entry.action}`;
    const label = t(key);
    return label === key ? t('history.action.unknown', { action: entry.action }) : label;
  };

  const statusChange = (entry: OpportunityHistoryEntry): ReactNode => {
    const before = asState(entry.before);
    const after = asState(entry.after);
    if (!after || typeof after.status !== 'string' || before?.status === after.status) return null;
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="sr-only">{t('history.status.from')}</span>
        <span>{statusName(before?.status)}</span>
        <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="sr-only">{t('history.status.to')}</span>
        <span className="font-medium">{statusName(after.status)}</span>
      </p>
    );
  };

  const cause = (entry: OpportunityHistoryEntry): ReactNode => {
    const after = asState(entry.after);
    if (!after) return null;
    if (after.cause === 'order_status') {
      return (
        <p className="text-sm text-muted-foreground">
          {t('history.cause.order')} {document('order', after.causeOrderId)}
        </p>
      );
    }
    if (after.cause === 'system') {
      return <p className="text-sm text-muted-foreground">{t('history.cause.system')}</p>;
    }
    return null;
  };

  if (entries === null) {
    return error ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load(null)}>
            {tCore('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {tCore('common.state.loading')}
      </p>
    );
  }

  return (
    <div className="space-y-4" aria-busy={loading}>
      <p className="max-w-prose text-sm text-muted-foreground">{t('history.hint')}</p>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {entries.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <History aria-hidden="true" className="size-5 shrink-0" />
          <span>{t('history.empty')}</span>
        </div>
      ) : (
        <ol aria-label={t('history.title')} className="space-y-3">
          {entries.map((entry) => {
            // An Order's status is `orders`' to show: no row without `orders:read`.
            const changes = historyChanges(entry).filter(
              (change) => canReadOrders || change.field !== 'orderStatusCode',
            );
            return (
              <li key={entry.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-sm font-medium">{heading(entry)}</h3>
                  <p className="text-xs text-muted-foreground">
                    <span>{actor(entry)}</span>
                    {' · '}
                    <time dateTime={entry.actedAt}>{formatDateTime(entry.actedAt)}</time>
                  </p>
                </div>
                {statusChange(entry)}
                {cause(entry)}
                {changes.length > 0 ? (
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
                    {changes.map((change) => (
                      <div key={change.field} className="contents">
                        <dt className="text-xs text-muted-foreground sm:pt-0.5">
                          {fieldLabel(change.field)}
                        </dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {change.field === 'customFieldValues' ? (
                            customFields(change)
                          ) : 'before' in change ? (
                            <>
                              <span className="sr-only">{t('history.status.from')}</span>
                              <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                                {value(change.field, change.before, entry)}
                              </span>
                              <ArrowRight
                                aria-hidden="true"
                                className="mx-1.5 inline size-3.5 text-muted-foreground"
                              />
                              <span className="sr-only">{t('history.status.to')}</span>
                            </>
                          ) : null}
                          {change.field === 'customFieldValues' ? null : (
                            <span>{value(change.field, change.after, entry)}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={loading}
            aria-busy={loading}
            onClick={(): void => void load(nextCursor)}
          >
            {t('history.more')}
          </Button>
        </div>
      ) : entries.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">{t('history.end')}</p>
      ) : null}

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}
