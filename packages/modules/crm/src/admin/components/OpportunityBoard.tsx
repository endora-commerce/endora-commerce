import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import type {
  OpportunityBoardCardField,
  OpportunityCurrencyTotal,
  OpportunityStatusRef,
  OpportunitySummary,
} from '@endora-commerce/contracts';
import {
  KanbanBoard,
  type KanbanBoardLabels,
  type KanbanCardRenderState,
} from '@endora-commerce/admin-kit/components';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { BoardCardFields } from './BoardCardFields.js';
import { errorMessage, moneyLabel } from '../lib/labels.js';
import { MoveToMenu } from './MoveToMenu.js';

/** One lane as the page holds it: the server's column, plus what the screen knows about it. */
export interface BoardColumnView {
  status: OpportunityStatusRef;
  /** Every Opportunity in the status that matches the filters — not only the cards shown. */
  count: number;
  valueTotals: OpportunityCurrencyTotal[];
  items: OpportunitySummary[];
  hasMore: boolean;
  /** The lane's own read: on its way, there, or failed. */
  state: 'ready' | 'loading' | 'error';
  /** The "show more" read of this lane. */
  more: 'idle' | 'loading' | 'error';
}

export interface OpportunityBoardProps {
  columns: readonly BoardColumnView[];
  /** The fields a card shows under its title, in order (User Story 19). */
  cardFields: readonly OpportunityBoardCardField[];
  /** The statuses the workflow allows from `statusCode`, in board order. */
  targetsOf: (statusCode: string) => readonly OpportunityStatusRef[];
  /** `crm:write` — without it the board is read-only: no handle, no menu. */
  canWrite: boolean;
  /** Cards whose move is in flight. */
  movingIds: ReadonlySet<string>;
  /** Per card: how many linked Orders did not follow its last move on this visit. */
  refusedOrders: ReadonlyMap<string, number>;
  /** A filter is applied — an empty lane then says "nothing matches", not "nothing here". */
  filtered: boolean;
  /**
   * Move a card. Resolves once the server has applied it; **rejects** when it
   * was refused, after the page has put the card back and shown the reason.
   * `via` says which of the two ways asked: a drag is announced by the board
   * itself, a move from the menu is the page's to announce.
   */
  onMove: (item: OpportunitySummary, toStatusCode: string, via: 'drag' | 'menu') => Promise<void>;
  onShowMore: (statusCode: string) => void;
}

const columnId = (column: BoardColumnView): string => column.status.code;
const itemId = (item: OpportunitySummary): string => item.id;

/**
 * The Opportunity board (`specs/143-crm-sales-opportunities/`, User Story 7 —
 * FR-051): the workflow's statuses as lanes, Opportunities as cards.
 *
 * Built on `KanbanBoard` from `@endora-commerce/admin-kit/components`; this
 * file names no drag-and-drop library. What it adds is CRM's meaning:
 *
 *  - **which lanes accept a card** — `canDrop` is the workflow's transitions
 *    from the card's status, so a lane the workflow does not allow is marked
 *    as refusing while the card is lifted and a drop on it calls nothing;
 *  - **what a drop does** — the page's `onMove`, which is the transition
 *    endpoint. Its promise is handed to the primitive as it is: a rejection is
 *    the primitive's signal to put the card back, and it is spoken with the
 *    server's reason;
 *  - **the non-drag way** — every card carries a "Move to…" menu listing the
 *    same lanes `canDrop` accepts (WCAG 2.2 SC 2.5.7).
 */
export function OpportunityBoard(props: OpportunityBoardProps): ReactNode {
  const { columns, cardFields, targetsOf, canWrite, movingIds, refusedOrders, filtered, onMove, onShowMore } =
    props;
  const t = useTranslation('crm');

  const itemsByColumn = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.status.code, column.items])),
    [columns],
  );

  const labels = useMemo<KanbanBoardLabels<OpportunitySummary, BoardColumnView>>(
    () => ({
      board: t('board.label'),
      column: (column) => t('board.column.label', { status: column.status.name }),
      dragHandle: (item) => t('board.drag.handle', { title: item.title }),
      dragHandleRoleDescription: t('board.drag.role'),
      instructions: t('board.drag.instructions'),
      pickedUp: (item, from) =>
        t('board.announce.pickedUp', { title: item.title, status: from.status.name }),
      over: (item, column, allowed) =>
        t(allowed ? 'board.announce.overAllowed' : 'board.announce.overRefused', {
          title: item.title,
          status: column.status.name,
        }),
      dropped: (item, _from, to) =>
        t('board.announce.dropped', { title: item.title, status: to.status.name }),
      refused: (item, from, to) =>
        t('board.announce.refused', {
          title: item.title,
          from: from.status.name,
          to: to.status.name,
        }),
      cancelled: (item, from) =>
        t('board.announce.cancelled', { title: item.title, status: from.status.name }),
      moveFailed: (item, from, _to, error) =>
        t('board.announce.moveFailed', {
          title: item.title,
          status: from.status.name,
          reason: errorMessage(error, t('board.move.error')),
        }),
    }),
    [t],
  );

  const renderCard = (item: OpportunitySummary, state: KanbanCardRenderState): ReactNode => {
    const targets = canWrite ? targetsOf(item.status.code) : [];
    const refused = refusedOrders.get(item.id) ?? 0;
    return (
      <div className="space-y-1.5">
        {/* The link is the title's text and no wider: a link never starts a
            drag, so a block-level one would take the whole first row of the
            card away from the pointer. */}
        <p className="break-words text-sm font-medium">
          <Link
            to={`/crm/opportunities/${item.id}`}
            className="text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.title}
          </Link>
        </p>
        <BoardCardFields item={item} fields={cardFields} />
        {refused > 0 ? (
          <p className="flex items-start gap-1 text-xs font-medium text-destructive">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('board.card.refusals', { count: refused })}</span>
          </p>
        ) : null}
        {/* Not on the copy that follows the pointer: it is a picture of the card. */}
        {!state.isOverlay && targets.length > 0 ? (
          <MoveToMenu
            title={item.title}
            targets={targets}
            busy={movingIds.has(item.id) || state.isPending}
            onMove={(statusCode): void => {
              // The page has already shown the reason; nothing is left to handle.
              onMove(item, statusCode, 'menu').catch(() => undefined);
            }}
          />
        ) : null}
      </div>
    );
  };

  return (
    <KanbanBoard<OpportunitySummary, BoardColumnView>
      columns={columns}
      getColumnId={columnId}
      itemsByColumn={itemsByColumn}
      getItemId={itemId}
      disabled={!canWrite}
      canDrop={(item, toColumnId): boolean =>
        canWrite && targetsOf(item.status.code).some((target) => target.code === toColumnId)
      }
      onMove={(movedId, fromColumnId, toColumnId): Promise<void> | void => {
        const item = itemsByColumn[fromColumnId]?.find((candidate) => candidate.id === movedId);
        return item ? onMove(item, toColumnId, 'drag') : undefined;
      }}
      getColumnState={(column): BoardColumnView['state'] => column.state}
      renderColumnHeader={(column): ReactNode => (
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: column.status.color }}
            />
            {column.status.name}
          </h2>
          {column.state === 'ready' ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t('board.column.count', { count: column.count })}
              </p>
              {column.valueTotals.map((total) => (
                <p key={total.currency} className="text-xs font-medium tabular-nums">
                  {moneyLabel(total.total, total.currency)}
                </p>
              ))}
            </>
          ) : null}
        </div>
      )}
      renderColumnLoading={(): ReactNode => (
        <p role="status" className="text-xs text-muted-foreground">
          {t('board.column.loading')}
        </p>
      )}
      renderColumnError={(): ReactNode => (
        <p className="text-xs text-destructive">{t('board.column.error')}</p>
      )}
      renderColumnEmpty={(): ReactNode => (
        <p className="text-xs text-muted-foreground">
          {filtered ? t('board.column.emptyFiltered') : t('board.column.empty')}
        </p>
      )}
      renderColumnFooter={(column): ReactNode =>
        column.state === 'ready' && (column.hasMore || column.more !== 'idle') ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('board.column.shown', { shown: column.items.length, count: column.count })}
            </p>
            {column.more === 'error' ? (
              <p role="alert" className="text-xs text-destructive">
                {t('board.column.moreError')}
              </p>
            ) : null}
            {column.hasMore ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 w-full sm:min-h-8"
                disabled={column.more === 'loading'}
                aria-busy={column.more === 'loading'}
                aria-label={t('board.column.more', { status: column.status.name })}
                onClick={(): void => onShowMore(column.status.code)}
              >
                {t('board.column.moreAction')}
              </Button>
            ) : null}
          </div>
        ) : null
      }
      renderCard={renderCard}
      labels={labels}
      // Never taller than the window, so fifty cards in one status scroll in
      // their lane and the sideways scroll bar of a wide workflow stays in
      // view; never lower than 28rem, so a short window still shows cards.
      className="max-h-[max(28rem,calc(100dvh-8rem))]"
    />
  );
}
