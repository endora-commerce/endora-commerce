import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { ApiError, cn, formatDateTime } from '../../lib/index.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Button } from '../../ui/button.js';
import { useTranslationContext } from '../../i18n/TranslationProvider.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { EditorSection, useEditorSectionChrome, type EditorSectionChrome } from '../../ui/editor-section.js';

/**
 * A record's change history — what was done, by whom and when, newest first, a
 * page at a time (CRM's Opportunity history, `specs/143-crm-sales-opportunities/`
 * User Story 11; promoted by `specs/163-projects-and-tasks/` research R-17).
 *
 * The kit draws the history and reads it page by page; **what anything is
 * called is the record's**: an entry's heading, a field's label, how a value
 * reads, and anything an entry says before its fields — a status change, its
 * cause — are injected, so CRM, Projects and Tasks each name their own.
 */

/** One audited entry — CRM's `OpportunityHistoryEntry` and the shared `RecordHistoryEntry` alike. */
export interface RecordHistoryEntryShape {
  id: string;
  actedAt: string;
  action: string;
  actor: { kind: string; id: string | null; name: string | null };
  before: unknown;
  after: unknown;
}

/** One page of a history, as a cursor-paginated history endpoint answers it. */
export interface RecordHistoryPageShape<E extends RecordHistoryEntryShape> {
  data: E[];
  pagination: { hasMore: boolean; cursor?: string | null };
  /** The last page a history can serve, with earlier entries beyond its reach. */
  truncated: boolean;
}

/** One field of an entry, as it was and as it is. `before` is absent for a state that only arrived. */
export interface RecordHistoryChange {
  field: string;
  before?: unknown;
  after: unknown;
}

type State = Record<string, unknown>;

function asState(value: unknown): State | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as State) : null;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What an entry changed, field by field: for an edit the fields whose value
 * differs, for something that only appeared (a creation, a link, a note) the
 * fields it arrived with, for something removed the fields it had. A field in
 * `silent` — an identifier that says nothing to a reader — is never a row.
 */
export function recordHistoryChanges(
  entry: { before: unknown; after: unknown },
  silent: ReadonlySet<string> = new Set(),
): RecordHistoryChange[] {
  const before = asState(entry.before);
  const after = asState(entry.after);
  const shown = (field: string): boolean => !silent.has(field);
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

/** What {@link useRecordHistory} has read, and how to read more. */
export interface RecordHistoryState<E extends RecordHistoryEntryShape> {
  /** `null` until the first page arrived. */
  entries: E[] | null;
  loading: boolean;
  error: string | null;
  /** The cursor of the next page, or `null` on the last one. */
  nextCursor: string | null;
  truncated: boolean;
  /** Spoken once a page was appended. */
  notice: string;
  /** Read from the start (`null`) or append the page after `cursor`. */
  load: (cursor: string | null) => Promise<void>;
}

/**
 * A history read a page at a time: the first page now and whenever `reloadKey`
 * changes (an edit made elsewhere on the screen is the newest entry here), the
 * next page appended under the ones already read, so a reader scanning back
 * keeps their place. `loadPage` should be stable between renders — a new one
 * reads again.
 */
export function useRecordHistory<E extends RecordHistoryEntryShape>(
  loadPage: (cursor: string | null) => Promise<RecordHistoryPageShape<E>>,
  reloadKey?: string | number,
): RecordHistoryState<E> {
  const t = useTranslation('core');
  const [entries, setEntries] = useState<E[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);

  const load = useCallback(
    async (cursor: string | null): Promise<void> => {
      const current = ++sequence.current;
      setLoading(true);
      setError(null);
      try {
        const page = await loadPage(cursor);
        if (current !== sequence.current) return;
        setEntries((previous) => (cursor ? [...(previous ?? []), ...page.data] : page.data));
        setNextCursor(page.pagination.hasMore ? (page.pagination.cursor ?? null) : null);
        setTruncated(page.truncated);
        if (cursor) setNotice(t('history.loadedMore', { count: page.data.length }));
      } catch (failure) {
        if (current === sequence.current) {
          setError(failure instanceof ApiError ? failure.envelope.error.message : t('history.error.load'));
        }
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [loadPage, t],
  );

  useEffect(() => {
    void load(null);
  }, [load, reloadKey]);

  return { entries, loading, error, nextCursor, truncated, notice, load };
}

/** The sentences that name the record; the rest are the kit's. */
export interface RecordHistoryCopy {
  /**
   * Above the list: a rule about this history the entries do not show. Omit it
   * when there is none — a history that only says what a history is adds
   * noise, not information (UX audit 2026-11-17, WORK-17).
   */
  hint?: string;
  /** Nothing recorded yet. */
  empty: string;
  /** Under the last page of a history that is whole. */
  end: string;
  /** Under the last page of a history that reaches back only so far. */
  truncated: string;
}

export interface RecordHistoryProps<E extends RecordHistoryEntryShape> {
  history: RecordHistoryState<E>;
  copy: RecordHistoryCopy;
  /** The entry's heading — the audited action's label. */
  heading: (entry: E) => string;
  /** The rows an entry shows; usually {@link recordHistoryChanges} with the record's silent fields. */
  changes: (entry: E) => RecordHistoryChange[];
  /** A field's label. */
  fieldLabel: (field: string) => string;
  /** A value in words — never an id, never JSON. */
  renderValue: (field: string, raw: unknown, entry: E) => ReactNode;
  /** A row drawn whole by the record, in place of "before → after"; `undefined` leaves the row to the kit. */
  renderChange?: (change: RecordHistoryChange, entry: E) => ReactNode | undefined;
  /** What an entry says between its heading and its rows — a status change, its cause. */
  renderLead?: (entry: E, changes: readonly RecordHistoryChange[]) => ReactNode;
  /** An entry's time in words; `formatDateTime` when the record has no format of its own. */
  formatTime?: (iso: string) => string;
  /**
   * Issue #1437 (DS-03) — `section` by default: the history sits under the host's own heading or
   * tab, with no frame and no heading of its own. `card` draws a titled card around it, for a
   * history standing alone on a page.
   */
  chrome?: EditorSectionChrome;
  /** The card's title under `chrome="card"`; *Change history* when omitted. */
  title?: string;
}

export interface RecordHistoryChangeListProps {
  /** The rows to draw — {@link recordHistoryChanges} of an entry, as a rule. */
  changes: readonly RecordHistoryChange[];
  /** A field's label. */
  fieldLabel: (field: string) => ReactNode;
  /** A value in words — never an id, never JSON. */
  renderValue: (field: string, raw: unknown) => ReactNode;
  /** A row drawn whole by the caller, in place of "before → after"; `undefined` leaves the row to the kit. */
  renderChange?: (change: RecordHistoryChange) => ReactNode | undefined;
  className?: string;
}

/**
 * One entry's field changes as a definition list: a field's label, then the
 * value as it was, struck through, an arrow, and the value as it is. A field
 * that only arrived shows its value alone. The words "from" and "to" are
 * spoken beside the struck-through value, because a strike-through and an
 * arrow carry nothing to a screen reader. {@link RecordHistory} draws each of
 * its entries with it; a screen showing one audited change on its own — the
 * audit log's row detail (issue #1555) — draws the same list. Draws nothing
 * for no changes: what an empty entry says is the caller's.
 */
export function RecordHistoryChangeList(props: RecordHistoryChangeListProps): ReactNode {
  const t = useTranslation('core');
  if (props.changes.length === 0) return null;
  return (
    <dl className={cn('grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]', props.className)}>
      {props.changes.map((change) => {
        const whole = props.renderChange?.(change);
        return (
          <div key={change.field} className="contents">
            <dt className="text-xs text-muted-foreground sm:pt-0.5">{props.fieldLabel(change.field)}</dt>
            <dd className="whitespace-pre-wrap break-words">
              {whole !== undefined ? (
                whole
              ) : (
                <>
                  {'before' in change ? (
                    <>
                      <span className="sr-only">{t('history.status.from')}</span>
                      <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                        {props.renderValue(change.field, change.before)}
                      </span>
                      <ArrowRight aria-hidden="true" className="mx-1.5 inline size-3.5 text-muted-foreground" />
                      <span className="sr-only">{t('history.status.to')}</span>
                    </>
                  ) : null}
                  <span>{props.renderValue(change.field, change.after)}</span>
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The history drawn: every entry an `h3` under the screen's own heading, its
 * actor and time, then its rows as a definition list — a field's label, and
 * its value as it was struck through beside the value it is. Under the last
 * page it says either that this is the whole history or that earlier changes
 * exist and are not shown; the two are never confused.
 */
export function RecordHistory<E extends RecordHistoryEntryShape>(props: RecordHistoryProps<E>): ReactNode {
  const { history, copy } = props;
  const { entries, loading, error, nextCursor, truncated, notice, load } = history;
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const inherited = useEditorSectionChrome();
  const chrome = props.chrome ?? inherited;
  // The host's heading names a section; a card standing alone names itself.
  const frame = (body: ReactNode): ReactNode =>
    chrome === 'card' ? (
      <EditorSection chrome="card" title={props.title ?? t('history.title')}>
        {body}
      </EditorSection>
    ) : (
      body
    );

  const actor = (entry: E): string => {
    if (entry.actor.kind !== 'admin') return t('history.actor.system');
    return entry.actor.name ?? t('history.actor.deleted');
  };

  if (entries === null) {
    return frame(error ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load(null)}>
            {t('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.state.loading')}
      </p>
    ));
  }

  return frame(
    <div className="space-y-4" aria-busy={loading}>
      {copy.hint ? <p className="max-w-prose text-sm text-muted-foreground">{copy.hint}</p> : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {entries.length === 0 ? (
        <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
          <History aria-hidden="true" className="size-5 shrink-0" />
          <span>{copy.empty}</span>
        </div>
      ) : (
        // One rule between entries, not a box around each: a frame inside the host's card is a
        // defect unless it is a field (issue #1437).
        <ol aria-label={t('history.title')} className="divide-y divide-border">
          {entries.map((entry) => {
            const changes = props.changes(entry);
            return (
              <li key={entry.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-sm font-medium">{props.heading(entry)}</h3>
                  <p className="text-xs text-muted-foreground">
                    <span>{actor(entry)}</span>
                    {' · '}
                    <time dateTime={entry.actedAt}>{props.formatTime ? props.formatTime(entry.actedAt) : formatDateTime(entry.actedAt, language)}</time>
                  </p>
                </div>
                {props.renderLead?.(entry, changes)}
                <RecordHistoryChangeList
                  changes={changes}
                  fieldLabel={props.fieldLabel}
                  renderValue={(field, raw): ReactNode => props.renderValue(field, raw, entry)}
                  {...(props.renderChange ? { renderChange: (change: RecordHistoryChange) => props.renderChange?.(change, entry) } : {})}
                />
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
        <p className="text-center text-xs text-muted-foreground">{truncated ? copy.truncated : copy.end}</p>
      ) : null}

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>,
  );
}
