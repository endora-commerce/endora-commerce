import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, History } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityHistoryEntry,
  OpportunityWorkflowStatus,
} from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import {
  calendarDateLabel,
  errorMessage,
  moneyLabel,
  NO_VALUE,
  workflowStatusLabel,
} from '../lib/labels.js';

const PAGE_SIZE = 50;
/** A long text (a description, a note) is cut here; the whole of it is where it lives. */
const TEXT_LIMIT = 280;

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
 * Identifiers that say nothing to a reader and are never a row of their own.
 * The ones that *name* something a person knows — the assignee, an Order — are
 * not here: they are resolved to a name where one is known.
 */
const SILENT_FIELDS: ReadonlySet<string> = new Set([
  'linkId',
  'commentId',
  'attachmentId',
  'assetId',
  'propagationId',
  'linkedByAdminUserId',
  // Who wrote a note or a message is the entry's own actor, named above it.
  'authorAdminUserId',
  'version',
  'cause',
  'causeOrderId',
  'status',
]);

/**
 * What an entry changed, field by field: for an edit the fields whose value
 * differs, for something that only appeared (a creation, a link, a note) the
 * fields it arrived with, for something removed the fields it had.
 *
 * The status of a status change and its cause are not here — the entry shows
 * them as a sentence of their own.
 */
export function historyChanges(entry: Pick<OpportunityHistoryEntry, 'before' | 'after'>): HistoryChange[] {
  const before = asState(entry.before);
  const after = asState(entry.after);
  const shown = (field: string): boolean => !SILENT_FIELDS.has(field);
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

/** The fields this screen has a label for; any other is shown under its own name. */
const FIELD_LABELS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'customerAccountId',
  'salesChannelId',
  'assignedAdminUserId',
  'valueMode',
  'manualValue',
  'expectedCloseDate',
  'currency',
  'organizationId',
  'number',
  'source',
  'tags',
  'documentKind',
  'documentId',
  'linkedDocument',
  'syncStatus',
  'linkSource',
  'orderId',
  'orderStatusCode',
  'skippedStatus',
  'outcome',
  'dismissed',
  'deleted',
  'reason',
  'body',
  'length',
  'kind',
  'fileName',
  'statusCode',
]);

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
 * they name wherever this screen knows it (the assignee, a linked Order) and
 * left out where it does not.
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
  const [entries, setEntries] = useState<OpportunityHistoryEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [statuses, setStatuses] = useState<OpportunityWorkflowStatus[]>([]);
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
      case 'customerAccountId':
      case 'salesChannelId':
      case 'organizationId':
        return t('history.value.set');
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
    if (Array.isArray(raw)) return raw.length === 0 ? NO_VALUE : raw.map(String).join(', ');
    if (typeof raw === 'object') return JSON.stringify(raw);
    const text = String(raw);
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
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
            const changes = historyChanges(entry);
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
                          {FIELD_LABELS.has(change.field)
                            ? t(`history.field.${change.field}`)
                            : change.field}
                        </dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {'before' in change ? (
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
                          <span>{value(change.field, change.after, entry)}</span>
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
