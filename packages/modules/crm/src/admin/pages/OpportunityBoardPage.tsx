import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, SlidersHorizontal, X } from 'lucide-react';
import type {
  OpportunityBoard as OpportunityBoardData,
  OpportunityBoardCardField,
  OpportunityCurrencyTotal,
  OpportunityFieldFilter,
  OpportunityStatusRef,
  OpportunitySummary,
  OpportunityWorkflow,
  PropagationOutcome,
} from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { BoardFieldFilters } from '../components/BoardFieldFilters.js';
import { MAX_PAGE_LIMIT } from '../components/CursorPagination.js';
import { OpportunityBoard, type BoardColumnView } from '../components/OpportunityBoard.js';
import {
  OpportunityFilterFields,
  hasSharedFilters,
  sharedFilterParams,
  type SharedOpportunityFilters,
} from '../components/OpportunityFilterFields.js';
import {
  DEFAULT_BOARD_CARD_FIELDS,
  NO_BOARD_FILTERS,
  activeFieldFilters,
  readBoardFilters,
  writeBoardFilters,
  type BoardFilters,
} from '../lib/board-fields.js';
import { errorMessage, isRefusedOutcome, workflowStatusLabel } from '../lib/labels.js';

const SEARCH_DEBOUNCE_MS = 300;

/** A move the server refused: which card, where to, and the server's own sentence. */
interface MoveRefusal {
  title: string;
  status: string;
  reason: string;
}

/** A move that stood while some linked Orders did not follow. */
interface OrderRefusalNotice {
  opportunityId: string;
  number: string;
  status: string;
  outcomes: PropagationOutcome[];
}

function cents(amount: string | null | undefined): number {
  const value = Number(amount ?? '0');
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** A lane's totals with one card's value added (`sign` 1) or taken away (`sign` -1). */
function shiftTotals(
  totals: readonly OpportunityCurrencyTotal[],
  item: OpportunitySummary,
  sign: 1 | -1,
): OpportunityCurrencyTotal[] {
  const delta = cents(item.value) * sign;
  if (delta === 0) return [...totals];
  const byCurrency = new Map(totals.map((total) => [total.currency, cents(total.total)]));
  byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? 0) + delta);
  return [...byCurrency.entries()]
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({ currency, total: (value / 100).toFixed(2) }));
}

/**
 * The lanes with one card moved to `toCode` — its lane's count and totals
 * following it. `index` puts it back where it was; without one it goes on top.
 */
function relocate(
  columns: readonly BoardColumnView[],
  itemId: string,
  toCode: string,
  index = 0,
): BoardColumnView[] {
  let moved: OpportunitySummary | undefined;
  if (!columns.some((column) => column.status.code === toCode)) return [...columns];
  const without = columns.map((column) => {
    const found = column.items.find((item) => item.id === itemId);
    if (!found) return column;
    moved = found;
    return {
      ...column,
      items: column.items.filter((item) => item.id !== itemId),
      count: Math.max(0, column.count - 1),
      valueTotals: shiftTotals(column.valueTotals, found, -1),
    };
  });
  const card = moved;
  if (!card) return [...columns];
  return without.map((column) => {
    if (column.status.code !== toCode) return column;
    const items = [...column.items];
    items.splice(Math.min(index, items.length), 0, { ...card, status: column.status });
    return {
      ...column,
      items,
      count: column.count + 1,
      valueTotals: shiftTotals(column.valueTotals, card, 1),
    };
  });
}

function viewOf(board: OpportunityBoardData): BoardColumnView[] {
  return board.columns.map((column) => ({ ...column, state: 'ready', more: 'idle' }));
}

/**
 * The Opportunity board (`specs/143-crm-sales-opportunities/`, User Story 7 —
 * FR-051; `contracts/admin-api.md` §10).
 *
 * Two reads draw it. `GET /workflow` gives the lanes before any card exists —
 * so the first paint is the board's own shape, loading — and the transitions,
 * which is what a card's "Move to…" menu lists and what `canDrop` answers.
 * `GET /board` gives each lane its figures and its first cards.
 *
 * **A move is optimistic and honest.** The card changes lane at once and the
 * transition endpoint is asked. When it refuses — no such transition any more,
 * a guard's veto, a concurrent change — the card goes back and the server's own
 * sentence is shown above the board; nothing is retried. When it applies but a
 * linked Order did not follow, the move stands and that is said, on the card
 * and above the board, with a link to the Opportunity where it can be retried
 * or dismissed.
 *
 * **A lane that holds more cards than the board answered is continued from the
 * list** — same filters, that one status — because the board endpoint has no
 * cursor of its own. The cards are the list's first page in the list's order,
 * so the first continuation replaces them with a longer page of the same order.
 *
 * The filter fields are the list's (`OpportunityFilterFields`), the assignee
 * filter included, and after them one filter per field the cards show
 * (`BoardFieldFilters`, User Story 19). **The filters live in the address**, so
 * a filtered board can be reloaded, bookmarked and sent to a colleague; the
 * search box is the one thing typed into, and it reaches the address once
 * typing pauses.
 */
export function OpportunityBoardPage(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const canConfigure = hasPermission('crm:configure');
  const [searchParams, setSearchParams] = useSearchParams();

  const [workflow, setWorkflow] = useState<OpportunityWorkflow | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  /** `null` until the board has answered once. */
  const [columns, setColumns] = useState<BoardColumnView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The fields a card shows — the board's own answer; `null` until it has answered once. */
  const [cardFields, setCardFields] = useState<OpportunityBoardCardField[] | null>(null);
  // Keyed by the address's own text, so the filters are the same object until it changes.
  const address = searchParams.toString();
  const boardFilters = useMemo<BoardFilters>(() => readBoardFilters(new URLSearchParams(address)), [address]);
  const filters = boardFilters.shared;
  const [search, setSearch] = useState(filters.q);
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [refusedOrders, setRefusedOrders] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [moveRefusal, setMoveRefusal] = useState<MoveRefusal | null>(null);
  const [orderNotices, setOrderNotices] = useState<OrderRefusalNotice[]>([]);
  /** Spoken after a move made from the menu; a drag is spoken by the board itself. */
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  /** Per lane: where its continuation from the list stands. Reset by every board read. */
  const cursors = useRef(new Map<string, string | null>());

  const loadWorkflow = useCallback(async (): Promise<void> => {
    setWorkflowError(null);
    try {
      setWorkflow(await crmApi.getWorkflow());
    } catch (failure) {
      setWorkflowError(errorMessage(failure, t('board.error')));
    }
  }, [t]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  /** Replace the address's filters; the history keeps one entry for the board. */
  const applyFilters = useCallback(
    (next: (previous: BoardFilters) => BoardFilters): void => {
      setSearchParams((previous) => writeBoardFilters(next(readBoardFilters(previous))), { replace: true });
    },
    [setSearchParams],
  );

  // The search box is typed into; the address, and the request, follow once typing pauses.
  /** The search this screen last put in the address itself. */
  const writtenSearch = useRef(filters.q);
  useEffect(() => {
    const typed = search.trim();
    if (typed === filters.q) return undefined;
    const timer = setTimeout(() => {
      writtenSearch.current = typed;
      applyFilters((previous) => ({ ...previous, shared: { ...previous.shared, q: typed } }));
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search, filters.q, applyFilters]);

  // And the other way: an address whose search this screen did not write — a
  // link to the bare board, the browser's Back — is what the box shows. One it
  // did write is left alone: more may have been typed since.
  useEffect(() => {
    if (filters.q === writtenSearch.current) return;
    writtenSearch.current = filters.q;
    setSearch(filters.q);
  }, [filters.q]);

  /**
   * The field filters the server is sent. Until the board has said which
   * fields its cards show, every one the address carries — the server ignores
   * a field that is not on the card — and afterwards only those of a shown
   * field. As text, so an answer that changes nothing reads nothing again.
   */
  const fieldFilterKey = useMemo(
    () => JSON.stringify(cardFields ? activeFieldFilters(boardFilters.fields, cardFields) : boardFilters.fields),
    [boardFilters.fields, cardFields],
  );
  const params = useMemo(() => {
    const fieldFilters = JSON.parse(fieldFilterKey) as Record<string, OpportunityFieldFilter>;
    return {
      ...sharedFilterParams(filters),
      ...(Object.keys(fieldFilters).length > 0 ? { fieldFilters } : {}),
    };
  }, [filters, fieldFilterKey]);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const board = await crmApi.getBoard(params);
      // A slower, older answer must not overwrite a newer one.
      if (current !== sequence.current) return;
      cursors.current = new Map();
      setCardFields(board.cardFields);
      setColumns(viewOf(board));
    } catch (failure) {
      if (current !== sequence.current) return;
      setError(errorMessage(failure, t('board.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The lanes on screen: the board's once it answered, the workflow's own until then. */
  const lanes = useMemo<BoardColumnView[]>(() => {
    if (columns) return columns;
    if (!workflow) return [];
    return [...workflow.statuses]
      .sort((a, b) => a.weight - b.weight)
      .map((status) => ({
        status: {
          code: status.code,
          name: workflowStatusLabel(status, language),
          color: status.color,
          kind: status.kind,
        },
        count: 0,
        valueTotals: [],
        items: [],
        hasMore: false,
        state: error ? 'error' : 'loading',
        more: 'idle',
      }));
  }, [columns, workflow, language, error]);

  const targetsOf = useMemo(() => {
    const byCode = new Map(lanes.map((lane) => [lane.status.code, lane.status]));
    const targets = new Map<string, OpportunityStatusRef[]>();
    for (const lane of lanes) {
      // In board order, so the menu reads left to right like the lanes do.
      targets.set(
        lane.status.code,
        lanes
          .filter((candidate) =>
            (workflow?.transitions ?? []).some(
              (edge) =>
                edge.fromStatusCode === lane.status.code &&
                edge.toStatusCode === candidate.status.code,
            ),
          )
          .map((candidate) => byCode.get(candidate.status.code) as OpportunityStatusRef),
      );
    }
    return (statusCode: string): readonly OpportunityStatusRef[] => targets.get(statusCode) ?? [];
  }, [lanes, workflow]);

  const move = useCallback(
    async (item: OpportunitySummary, toCode: string, announce: boolean): Promise<void> => {
      const fromCode = item.status.code;
      const target = lanes.find((lane) => lane.status.code === toCode)?.status;
      const index = lanes
        .find((lane) => lane.status.code === fromCode)
        ?.items.findIndex((candidate) => candidate.id === item.id);
      setMoveRefusal(null);
      setNotice('');
      setMovingIds((previous) => new Set(previous).add(item.id));
      setColumns((previous) => (previous ? relocate(previous, item.id, toCode) : previous));
      try {
        const result = await crmApi.transition(item.id, toCode);
        const moved = result.opportunity;
        // The server's own summary of the card, in the lane it says it is in.
        setColumns((previous) =>
          previous
            ? previous.map((column) =>
                column.status.code === moved.status.code
                  ? {
                      ...column,
                      items: column.items.map((card) =>
                        card.id === moved.id ? { ...card, ...moved, status: column.status } : card,
                      ),
                    }
                  : column,
              )
            : previous,
        );
        const refused = result.propagation.filter(isRefusedOutcome);
        setRefusedOrders((previous) => {
          const next = new Map(previous);
          if (refused.length > 0) next.set(item.id, refused.length);
          else next.delete(item.id);
          return next;
        });
        setOrderNotices((previous) => {
          const others = previous.filter((entry) => entry.opportunityId !== item.id);
          return refused.length > 0
            ? [
                {
                  opportunityId: item.id,
                  number: item.number,
                  status: moved.status.name,
                  outcomes: refused,
                },
                ...others,
              ]
            : others;
        });
        if (announce) {
          setNotice(t('board.move.done', { title: item.title, status: moved.status.name }));
        }
      } catch (failure) {
        setColumns((previous) =>
          previous ? relocate(previous, item.id, fromCode, Math.max(0, index ?? 0)) : previous,
        );
        setMoveRefusal({
          title: item.title,
          status: target?.name ?? toCode,
          reason: errorMessage(failure, t('board.move.error')),
        });
        // 409 other than a veto says the Opportunity is not where this board
        // had it: show what is true now. A veto changed nothing.
        if (
          failure instanceof ApiError &&
          failure.status === 409 &&
          failure.envelope.error.code !== 'CRM_TRANSITION_VETOED'
        ) {
          void load();
        }
        // The board's own rollback and its spoken message hang on this rejection.
        throw failure;
      } finally {
        setMovingIds((previous) => {
          const next = new Set(previous);
          next.delete(item.id);
          return next;
        });
      }
    },
    [lanes, load, t],
  );

  const showMore = useCallback(
    async (statusCode: string): Promise<void> => {
      const generation = sequence.current;
      const cursor = cursors.current.get(statusCode);
      const mark = (more: BoardColumnView['more']): void =>
        setColumns((previous) =>
          previous
            ? previous.map((column) =>
                column.status.code === statusCode ? { ...column, more } : column,
              )
            : previous,
        );
      mark('loading');
      try {
        const page = await crmApi.listOpportunities({
          ...params,
          statusCode: [statusCode],
          ...(cursor ? { cursor } : {}),
          limit: MAX_PAGE_LIMIT,
          // The lane's further cards carry the same field values as its first.
          cardValues: true,
        });
        // The board was read again meanwhile: this page belongs to the old one.
        if (generation !== sequence.current) return;
        cursors.current.set(statusCode, page.pagination.cursor);
        setColumns((previous) =>
          previous
            ? previous.map((column) => {
                if (column.status.code !== statusCode) return column;
                const fetched = new Set(page.data.map((item) => item.id));
                // The first continuation starts the lane again from the list's
                // first page; a card moved here meanwhile, which that page does
                // not hold, stays on top.
                const kept = cursor
                  ? column.items
                  : column.items.filter((item) => !fetched.has(item.id));
                const known = new Set(kept.map((item) => item.id));
                return {
                  ...column,
                  items: [...kept, ...page.data.filter((item) => !known.has(item.id))],
                  hasMore: page.pagination.hasMore,
                  more: 'idle',
                };
              })
            : previous,
        );
      } catch {
        if (generation === sequence.current) mark('error');
      }
    },
    [params],
  );

  const change = (patch: Partial<SharedOpportunityFilters>): void =>
    applyFilters((previous) => {
      const fields = { ...previous.fields };
      // A contact person is chosen within an Organization: another one, or
      // none, leaves nobody to filter by.
      if ('organizationId' in patch) delete fields['builtin:contact'];
      return { shared: { ...previous.shared, ...patch }, fields };
    });

  const changeField = useCallback(
    (ref: string, filter: OpportunityFieldFilter | null): void =>
      applyFilters((previous) => {
        const fields = { ...previous.fields };
        if (filter) fields[ref] = filter;
        else delete fields[ref];
        return { ...previous, fields };
      }),
    [applyFilters],
  );

  const clear = (): void => {
    setSearch('');
    writtenSearch.current = '';
    applyFilters(() => NO_BOARD_FILTERS);
  };

  const shownFields = cardFields ?? DEFAULT_BOARD_CARD_FIELDS;
  const filtered =
    hasSharedFilters(filters) ||
    search.trim() !== '' ||
    Object.keys(activeFieldFilters(boardFilters.fields, shownFields)).length > 0;

  const retry = (): void => {
    if (!workflow) void loadWorkflow();
    void load();
  };

  return (
    <>
      <PageHeader
        title={t('board.title')}
        description={t('board.description')}
        actions={
          canWrite || canConfigure ? (
            <>
              {canConfigure ? (
                <Button variant="outline" className="min-h-11 sm:min-h-9" asChild>
                  <Link to="/crm/workflow#board-card">
                    <SlidersHorizontal aria-hidden="true" />
                    {t('board.configureCard')}
                  </Link>
                </Button>
              ) : null}
              {canWrite ? (
                <Button className="min-h-11 sm:min-h-9" asChild>
                  <Link to="/crm/opportunities/new">
                    <Plus aria-hidden="true" />
                    {t('opportunity.list.new')}
                  </Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <OpportunityFilterFields
              idPrefix="crm-board"
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onChange={change}
            />
            <BoardFieldFilters
              idPrefix="crm-board-field"
              fields={shownFields}
              filters={boardFilters.fields}
              onChange={changeField}
              organizationId={filters.organizationId}
              canPickContact={canWrite}
            />
          </div>
          {filtered ? (
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={clear}>
                <X aria-hidden="true" />
                {t('opportunity.list.filter.clear')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {(workflowError ?? error) ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{workflowError ?? error}</span>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={retry}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {moveRefusal ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-start justify-between gap-3">
            <span className="space-y-1">
              <span className="block font-medium">
                {t('board.move.refused', { title: moveRefusal.title, status: moveRefusal.status })}
              </span>
              <span className="block">{moveRefusal.reason}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-9"
              onClick={(): void => setMoveRefusal(null)}
            >
              {tCore('common.action.close')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {orderNotices.length > 0 ? (
        <section aria-label={t('board.refusals.title')} className="mb-4 space-y-2">
          {orderNotices.map((entry) => (
            <Alert key={entry.opportunityId}>
              <AlertDescription className="flex flex-wrap items-start justify-between gap-3">
                <span className="space-y-1">
                  <span className="block font-medium">
                    {t('board.refusals.item', {
                      number: entry.number,
                      status: entry.status,
                      count: entry.outcomes.length,
                    })}
                  </span>
                  {entry.outcomes.map((outcome) => (
                    <span key={outcome.id} className="block text-muted-foreground">
                      {t('board.refusals.order', {
                        order: outcome.orderNumber ?? t('propagation.orderUnknown'),
                        reason:
                          outcome.detail ??
                          t(`propagation.outcome.${outcome.outcome}`, {
                            status: outcome.orderStatusCode,
                          }),
                      })}
                    </span>
                  ))}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-9">
                    <Link
                      to={`/crm/opportunities/${entry.opportunityId}`}
                      aria-label={t('board.refusals.open', { number: entry.number })}
                    >
                      {t('board.refusals.openAction')}
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    aria-label={t('board.refusals.dismiss', { number: entry.number })}
                    onClick={(): void =>
                      setOrderNotices((previous) =>
                        previous.filter((other) => other.opportunityId !== entry.opportunityId),
                      )
                    }
                  >
                    {t('board.refusals.dismissAction')}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ))}
        </section>
      ) : null}

      {!canWrite ? (
        <p className="mb-3 text-sm text-muted-foreground">{t('board.readOnly')}</p>
      ) : null}

      {lanes.length === 0 ? (
        workflowError ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('board.loading')}
          </p>
        )
      ) : (
        <div aria-busy={loading}>
          <OpportunityBoard
            columns={lanes}
            cardFields={shownFields}
            targetsOf={targetsOf}
            canWrite={canWrite}
            movingIds={movingIds}
            refusedOrders={refusedOrders}
            filtered={filtered}
            onMove={(item, toCode, via): Promise<void> => move(item, toCode, via === 'menu')}
            onShowMore={(statusCode): void => void showMore(statusCode)}
          />
        </div>
      )}

      {/* For assistive technology: a move made from the menu has no drag to
          announce it. Mounted before it has text, so it is spoken reliably. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunityBoardPage;
