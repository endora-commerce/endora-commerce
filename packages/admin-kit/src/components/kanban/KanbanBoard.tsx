// A board of lanes with cards that move between them (feature 143, T150).
//
// **Generic on purpose.** Columns and items are the caller's data; what a lane
// means, what a card shows and what a move does are render props and callbacks.
// The component knows no domain vocabulary, reads no translation namespace and
// calls no API — a kit component that knew its first consumer would have to be
// published again for its second.
//
// **A consumer owes a non-drag alternative, and this component cannot supply
// it.** WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) asks that whatever dragging
// does can also be done with a single pointer *without* dragging. The keyboard
// drag below satisfies SC 2.1.1, not 2.5.7. The alternative is a control inside
// each card that lists the lanes the card may go to — a "Move to…" menu — and it
// has to live in `renderCard`, because which lanes those are and what they are
// called is the caller's knowledge. Links, buttons and form controls inside a
// card never start a drag, so such a menu works as written.
//
// **Cards have no order inside a lane.** A drop reports the lane, not a
// position, which is why this is built on `@dnd-kit/core` alone and not on its
// sortable preset. A consumer that needs ordered lanes needs a different
// primitive, or this one extended with that dependency and its justification.
//
// **Three ways to drag, and why the sensors are these three.**
//
//  - *Mouse*, after 8 px of travel, so a click on a card stays a click.
//  - *Touch*, after a 250 ms hold. A pointer-event sensor would need
//    `touch-action: none` on every card, and a board whose lanes are full of
//    cards could then not be scrolled with a finger at all. A hold keeps a swipe
//    a scroll and makes a press a lift.
//  - *Keyboard*, from the card's handle: Space or Enter lifts, the left and
//    right arrows choose a lane, Space or Enter drops, Escape cancels. The
//    handle is a real button beside the card's content rather than a button
//    role on the whole card, because a button's descendants are presentational
//    to assistive technology and the card's own link and menu would vanish.
//
// **Height is the caller's.** Unbounded, a lane is as tall as its cards and the
// page scrolls. Give the board a maximum height through `className` and every
// lane takes it: the lane's cards scroll inside the lane, under its header, and
// the board's own sideways scroll bar stays in view. Lifting a card near a
// lane's edge scrolls that lane, as it scrolls the board near the board's.
//
// **Optimistic by contract.** When `onMove` returns a promise the card is shown
// in its new lane while the promise is pending and returns to where the
// caller's data has it when the promise settles — which is the new lane if the
// caller refreshed its data, and the old one if the promise rejected.
// `itemsByColumn` is always the truth; the component only holds the difference
// for as long as nobody else can know it.

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Over,
} from '@dnd-kit/core';
import { Ban, GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { ReorderAnnouncer } from '../reorder/ReorderAnnouncer.js';

/** What a lane is to the card being dragged; `undefined` while nothing is lifted. */
export type KanbanDropState = 'source' | 'allowed' | 'refused';

/** Whether a lane's items are there, on their way, or could not be fetched. */
export type KanbanColumnState = 'ready' | 'loading' | 'error';

export interface KanbanColumnRenderState {
  /** Cards currently shown in the lane, a pending move included. */
  itemCount: number;
  columnState: KanbanColumnState;
  dropState: KanbanDropState | undefined;
  /** The lifted card is over this lane right now. */
  isOver: boolean;
}

export interface KanbanCardRenderState {
  /** This is the card left in place while its copy is being dragged. */
  isDragging: boolean;
  /** This is the copy that follows the pointer. */
  isOverlay: boolean;
  /** The caller's promise for this card's move has not settled yet. */
  isPending: boolean;
}

/**
 * Every string the board speaks or names something with.
 *
 * All of it is the caller's, translated by the caller: the sentences name items
 * and lanes, and only the caller knows what those are called.
 */
export interface KanbanBoardLabels<TItem, TColumn> {
  /** Accessible name of the whole board. */
  board: string;
  /** Accessible name of a lane. */
  column: (column: TColumn) => string;
  /** Accessible name of a card's drag handle, e.g. "Move <title>". */
  dragHandle: (item: TItem) => string;
  /** Read after the handle's name instead of "button", e.g. "draggable". */
  dragHandleRoleDescription: string;
  /** How to drag with the keyboard; every handle is described by it. */
  instructions: string;
  pickedUp: (item: TItem, from: TColumn) => string;
  /** The lifted card entered a lane; `allowed` is what `canDrop` answered. */
  over: (item: TItem, column: TColumn, allowed: boolean) => string;
  dropped: (item: TItem, from: TColumn, to: TColumn) => string;
  /** Dropped on a lane that does not accept this card. Nothing was called. */
  refused: (item: TItem, from: TColumn, to: TColumn) => string;
  /** Cancelled, dropped outside every lane, or dropped where it came from. */
  cancelled: (item: TItem, from: TColumn) => string;
  /** The caller's promise rejected and the card went back. */
  moveFailed: (item: TItem, from: TColumn, to: TColumn, error: unknown) => string;
}

export interface KanbanBoardProps<TItem, TColumn> {
  /** The lanes, in the order they are shown. */
  columns: readonly TColumn[];
  getColumnId: (column: TColumn) => string;
  /** The cards of each lane, keyed by column id. A missing key is an empty lane. */
  itemsByColumn: Readonly<Record<string, readonly TItem[]>>;
  /** Must be unique across the whole board, not only inside a lane. */
  getItemId: (item: TItem) => string;
  /**
   * Whether `item` may be dropped on the lane `toColumnId`. Lanes that refuse
   * are marked while the card is lifted and a drop on one calls nothing.
   * Omitted: every other lane accepts. Never asked about the card's own lane.
   */
  canDrop?: (item: TItem, toColumnId: string, fromColumnId: string) => boolean;
  /**
   * A card was dropped on another lane that accepts it. Return a promise to get
   * the optimistic move: the card stays in the new lane until it settles and
   * goes back if it rejects. The rejection is consumed here and spoken through
   * `labels.moveFailed`; showing its reason on screen is the caller's.
   */
  onMove: (itemId: string, fromColumnId: string, toColumnId: string) => void | Promise<unknown>;
  /**
   * The card's content. It owes the non-drag way to move the card (see the
   * header of this file). Mark anything else that must not start a drag with a
   * `data-kanban-no-drag` attribute.
   */
  renderCard: (item: TItem, state: KanbanCardRenderState) => ReactNode;
  renderColumnHeader: (column: TColumn, state: KanbanColumnRenderState) => ReactNode;
  /** Below the cards — a "load more" control, a total. */
  renderColumnFooter?: (column: TColumn, state: KanbanColumnRenderState) => ReactNode;
  /** Omitted: every lane is `'ready'`. */
  getColumnState?: (column: TColumn) => KanbanColumnState;
  /** Shown in a lane whose state is `'loading'`. */
  renderColumnLoading?: (column: TColumn) => ReactNode;
  /** Shown in a lane whose state is `'error'`. */
  renderColumnError?: (column: TColumn) => ReactNode;
  /** Shown in a `'ready'` lane that holds no card. */
  renderColumnEmpty?: (column: TColumn) => ReactNode;
  labels: KanbanBoardLabels<TItem, TColumn>;
  /** No card can be lifted and no handle is rendered — a read-only board. */
  disabled?: boolean;
  className?: string;
}

interface PendingMove {
  from: string;
  to: string;
  token: number;
}

interface CardData<TItem> {
  item: TItem;
  columnId: string;
}

interface LaneData<TColumn> {
  column: TColumn;
  columnId: string;
}

/**
 * Elements that keep their own pointer behaviour inside a card. `label` is here
 * because pressing one activates the control it names.
 */
const OWN_POINTER_BEHAVIOUR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-kanban-no-drag]',
].join(',');

/**
 * Whether a press that landed on `target` may lift the card `surface`.
 *
 * A press outside the card's DOM subtree can still reach the card's handler:
 * React bubbles through portals, so a click inside a menu the card opened in a
 * portal arrives here. That is not a press on the card.
 */
function mayLiftFrom(target: EventTarget | null, surface: HTMLElement): boolean {
  if (!(target instanceof Element) || !surface.contains(target)) return false;
  const owner = target.closest(OWN_POINTER_BEHAVIOUR);
  if (owner === null || owner === surface || !surface.contains(owner)) return true;
  return owner.hasAttribute('data-kanban-handle');
}

/**
 * Pointer and touch: the lane under the pointer, and nothing when the pointer
 * is over no lane — so a drop outside the board is a cancel, not a guess.
 *
 * Keyboard: the lane whose horizontal span holds the centre of the lifted
 * card. Deliberately not "closest centre": lanes are as tall as their content,
 * and a tall lane's centre is further from a card at its top than the centre
 * of a short neighbour is.
 */
const laneCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates !== null) return pointerWithin(args);
  const centre = args.collisionRect.left + args.collisionRect.width / 2;
  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (rect !== undefined && centre >= rect.left && centre <= rect.right) {
      return [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
    }
  }
  return [];
};

/**
 * One arrow key, one lane. The library's default moves 25 px per key press,
 * which is a dozen presses per lane and lands between two of them.
 *
 * Lanes are ordered by where they are on screen rather than by their index, so
 * the right arrow goes right in a right-to-left layout too. Up and down are
 * swallowed: a card has no position inside a lane, and letting them through
 * would scroll the page under a lifted card.
 */
const laneKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const step =
    event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
  if (step === 0) {
    if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) event.preventDefault();
    return undefined;
  }
  event.preventDefault();
  const { active, collisionRect, droppableRects, droppableContainers, over } = context;
  if (collisionRect === null) return undefined;

  const lanes = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      return rect === undefined ? [] : [{ id: container.id, rect }];
    })
    .sort((a, b) => a.rect.left - b.rect.left);
  const home = (active?.data.current as CardData<unknown> | undefined)?.columnId;
  const currentId = over?.id ?? home;
  const next = lanes[lanes.findIndex((entry) => entry.id === currentId) + step];
  if (currentId === undefined || next === undefined) return undefined;
  if (lanes.every((entry) => entry.id !== currentId)) return undefined;

  return {
    x: next.rect.left + (next.rect.width - collisionRect.width) / 2,
    y: collisionRect.top,
  };
};

/** Where each card is shown: the caller's data, with the unsettled moves applied. */
function projectItems<TItem>(
  columnIds: readonly string[],
  itemsByColumn: Readonly<Record<string, readonly TItem[]>>,
  getItemId: (item: TItem) => string,
  pending: ReadonlyMap<string, PendingMove>,
): Map<string, TItem[]> {
  const view = new Map<string, TItem[]>(columnIds.map((id) => [id, []]));
  const arriving: { item: TItem; to: string }[] = [];
  for (const columnId of columnIds) {
    for (const item of itemsByColumn[columnId] ?? []) {
      const move = pending.get(getItemId(item));
      // Only a card still where the move found it is displaced. Once the
      // caller's data has it anywhere else, the data wins.
      if (move !== undefined && move.from === columnId && view.has(move.to)) {
        arriving.push({ item, to: move.to });
      } else {
        view.get(columnId)?.push(item);
      }
    }
  }
  for (const { item, to } of arriving) view.get(to)?.push(item);
  return view;
}

function cardData<TItem>(active: Active): CardData<TItem> | undefined {
  return active.data.current as CardData<TItem> | undefined;
}

function laneData<TColumn>(over: Over | null): LaneData<TColumn> | undefined {
  return over?.data.current as LaneData<TColumn> | undefined;
}

// `gap-2` and `p-2` are what keep the handle's 44 px hit area — 8 px around its
// 28 px picture — off the card's own content and inside the card.
const CARD_SHELL =
  'flex items-start gap-2 rounded-md border bg-card p-2 text-card-foreground shadow-sm';

interface KanbanCardProps<TItem> {
  item: TItem;
  itemId: string;
  columnId: string;
  isPending: boolean;
  disabled: boolean;
  handleLabel: string;
  handleRoleDescription: string;
  renderCard: (item: TItem, state: KanbanCardRenderState) => ReactNode;
}

function KanbanCard<TItem>(props: KanbanCardProps<TItem>): ReactNode {
  const { item, itemId, columnId, isPending, disabled, handleLabel, handleRoleDescription, renderCard } =
    props;
  const data: CardData<TItem> = { item, columnId };
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: itemId,
    data,
    disabled: disabled || isPending,
    attributes: { roleDescription: handleRoleDescription },
  });

  const onMouseDown = (event: ReactMouseEvent<HTMLLIElement>): void => {
    if (mayLiftFrom(event.target, event.currentTarget)) listeners?.onMouseDown?.(event);
  };
  const onTouchStart = (event: ReactTouchEvent<HTMLLIElement>): void => {
    if (mayLiftFrom(event.target, event.currentTarget)) listeners?.onTouchStart?.(event);
  };
  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    listeners?.onKeyDown?.(event);
  };

  return (
    <li
      ref={setNodeRef}
      data-kanban-card={itemId}
      aria-busy={isPending || undefined}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={cn(
        CARD_SHELL,
        'touch-manipulation',
        !disabled && !isPending && 'cursor-grab',
        isDragging && 'opacity-40',
        isPending && 'opacity-70',
      )}
    >
      {disabled ? null : (
        // Disabled through `aria-disabled`, which the library sets, and never
        // through the `disabled` attribute: after a keyboard drop the focus is
        // returned to this handle, and a disabled button cannot take it.
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-kanban-handle=""
          {...attributes}
          aria-label={handleLabel}
          onKeyDown={onHandleKeyDown}
          className="relative inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-50"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        {renderCard(item, { isDragging, isOverlay: false, isPending })}
      </div>
    </li>
  );
}

interface KanbanLaneProps<TColumn> {
  column: TColumn;
  columnId: string;
  label: string;
  columnState: KanbanColumnState;
  dropState: KanbanDropState | undefined;
  itemCount: number;
  header: (state: KanbanColumnRenderState) => ReactNode;
  footer: ((state: KanbanColumnRenderState) => ReactNode) | undefined;
  slot: ReactNode;
  children: ReactNode;
}

function KanbanLane<TColumn>(props: KanbanLaneProps<TColumn>): ReactNode {
  const { column, columnId, label, columnState, dropState, itemCount, header, footer, slot, children } =
    props;
  const data: LaneData<TColumn> = { column, columnId };
  const { setNodeRef, isOver: isOverLane } = useDroppable({ id: columnId, data });
  const isOver = dropState !== undefined && isOverLane;
  const state: KanbanColumnRenderState = { itemCount, columnState, dropState, isOver };

  return (
    <section
      ref={setNodeRef}
      role="group"
      aria-label={label}
      aria-busy={columnState === 'loading' || undefined}
      aria-disabled={dropState === 'refused' || undefined}
      data-kanban-column={columnId}
      data-drop-state={dropState}
      data-drop-over={isOver || undefined}
      className={cn(
        // Lanes share the board's width down to a readable minimum, then the
        // board scrolls sideways. A lane is stretched to the board's height,
        // which is what lets the list below scroll when that height is bounded.
        'relative flex min-w-64 max-w-[min(24rem,85vw)] flex-1 basis-64 flex-col rounded-lg border bg-muted/50 transition-colors motion-reduce:transition-none',
        dropState === 'allowed' && 'border-dashed border-primary',
        dropState === 'allowed' && isOver && 'bg-primary/10 ring-2 ring-ring',
        dropState === 'refused' && 'opacity-60',
        dropState === 'refused' && isOver && 'cursor-not-allowed ring-2 ring-destructive',
      )}
    >
      <div className="px-3 pt-3">{header(state)}</div>
      {/* Colour and opacity are not the only sign that a lane refuses the card. */}
      {dropState === 'refused' ? (
        <Ban aria-hidden="true" className="absolute right-2 top-2 size-4 text-destructive" />
      ) : null}
      {slot === null ? null : <div className="px-3 pt-2">{slot}</div>}
      {/* The cards scroll, the header and the footer do not. It only ever
          scrolls when the caller bounded the board's height (`className`);
          unbounded, the lane is as tall as its cards, as before. `min-h-16`
          keeps an empty lane a target worth aiming at. */}
      <ul role="list" className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {children}
      </ul>
      {footer === undefined ? null : <div className="px-3 pb-3">{footer(state)}</div>}
    </section>
  );
}

/**
 * A board of lanes whose cards can be dragged from one lane to another with a
 * mouse, a finger or the keyboard. See the header of this file for what a
 * consumer owes beside it.
 */
export function KanbanBoard<TItem, TColumn>(props: KanbanBoardProps<TItem, TColumn>): ReactNode {
  const {
    columns,
    getColumnId,
    itemsByColumn,
    getItemId,
    canDrop,
    onMove,
    renderCard,
    renderColumnHeader,
    renderColumnFooter,
    getColumnState,
    renderColumnLoading,
    renderColumnError,
    renderColumnEmpty,
    labels,
    disabled = false,
    className,
  } = props;

  const contextId = useId();
  const [active, setActive] = useState<CardData<TItem> | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove>>(() => new Map());
  const [failure, setFailure] = useState('');
  const nextToken = useRef(0);

  const columnIds = useMemo(() => columns.map(getColumnId), [columns, getColumnId]);
  const columnById = useMemo(
    () => new Map(columns.map((column) => [getColumnId(column), column])),
    [columns, getColumnId],
  );
  const view = useMemo(
    () => projectItems(columnIds, itemsByColumn, getItemId, pending),
    [columnIds, itemsByColumn, getItemId, pending],
  );

  const accepts = useCallback(
    (card: CardData<TItem>, toColumnId: string): boolean =>
      toColumnId !== card.columnId && (canDrop?.(card.item, toColumnId, card.columnId) ?? true),
    [canDrop],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: laneKeyboardCoordinates }),
  );

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart({ active: lifted }) {
        const card = cardData<TItem>(lifted);
        const from = card === undefined ? undefined : columnById.get(card.columnId);
        return card === undefined || from === undefined ? undefined : labels.pickedUp(card.item, from);
      },
      onDragOver({ active: lifted, over }) {
        const card = cardData<TItem>(lifted);
        const lane = laneData<TColumn>(over);
        if (card === undefined || lane === undefined || lane.columnId === card.columnId) {
          return undefined;
        }
        return labels.over(card.item, lane.column, accepts(card, lane.columnId));
      },
      onDragEnd({ active: lifted, over }) {
        const card = cardData<TItem>(lifted);
        const from = card === undefined ? undefined : columnById.get(card.columnId);
        if (card === undefined || from === undefined) return undefined;
        const lane = laneData<TColumn>(over);
        if (lane === undefined || lane.columnId === card.columnId) {
          return labels.cancelled(card.item, from);
        }
        return accepts(card, lane.columnId)
          ? labels.dropped(card.item, from, lane.column)
          : labels.refused(card.item, from, lane.column);
      },
      onDragCancel({ active: lifted }) {
        const card = cardData<TItem>(lifted);
        const from = card === undefined ? undefined : columnById.get(card.columnId);
        return card === undefined || from === undefined ? undefined : labels.cancelled(card.item, from);
      },
    }),
    [accepts, columnById, labels],
  );

  const handleDragStart = (event: DragStartEvent): void => {
    setFailure('');
    setActive(cardData<TItem>(event.active) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setActive(null);
    const card = cardData<TItem>(event.active);
    const lane = laneData<TColumn>(event.over);
    if (card === undefined || lane === undefined || !accepts(card, lane.columnId)) return;

    const itemId = getItemId(card.item);
    const from = card.columnId;
    const to = lane.columnId;
    const outcome = onMove(itemId, from, to);
    if (outcome === undefined || typeof outcome.then !== 'function') return;

    nextToken.current += 1;
    const token = nextToken.current;
    setPending((current) => new Map(current).set(itemId, { from, to, token }));
    const settle = (): void => {
      setPending((current) => {
        if (current.get(itemId)?.token !== token) return current;
        const next = new Map(current);
        next.delete(itemId);
        return next;
      });
    };
    outcome.then(settle, (error: unknown) => {
      settle();
      const fromColumn = columnById.get(from);
      if (fromColumn !== undefined) {
        setFailure(labels.moveFailed(card.item, fromColumn, lane.column, error));
      }
    });
  };

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={laneCollision}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: labels.instructions },
      }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      {/* Focusable, so a board wider than the screen can be scrolled from the
          keyboard even when it holds no card to tab to. Padded, because a
          container that scrolls on one axis clips on both, and the lanes'
          rings are drawn outside their boxes. */}
      <div
        role="region"
        aria-label={labels.board}
        tabIndex={0}
        className={cn(
          'flex items-stretch gap-3 overflow-x-auto p-1 pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        {columns.map((column) => {
          const columnId = getColumnId(column);
          const items = view.get(columnId) ?? [];
          const columnState = getColumnState?.(column) ?? 'ready';
          const dropState: KanbanDropState | undefined =
            active === null
              ? undefined
              : active.columnId === columnId
                ? 'source'
                : accepts(active, columnId)
                  ? 'allowed'
                  : 'refused';
          const slot =
            columnState === 'loading'
              ? (renderColumnLoading?.(column) ?? null)
              : columnState === 'error'
                ? (renderColumnError?.(column) ?? null)
                : items.length === 0
                  ? (renderColumnEmpty?.(column) ?? null)
                  : null;
          return (
            <KanbanLane<TColumn>
              key={columnId}
              column={column}
              columnId={columnId}
              label={labels.column(column)}
              columnState={columnState}
              dropState={dropState}
              itemCount={items.length}
              header={(state) => renderColumnHeader(column, state)}
              footer={
                renderColumnFooter === undefined
                  ? undefined
                  : (state) => renderColumnFooter(column, state)
              }
              slot={slot}
            >
              {items.map((item) => {
                const itemId = getItemId(item);
                return (
                  <KanbanCard<TItem>
                    key={itemId}
                    item={item}
                    itemId={itemId}
                    columnId={columnId}
                    isPending={pending.has(itemId)}
                    disabled={disabled}
                    handleLabel={labels.dragHandle(item)}
                    handleRoleDescription={labels.dragHandleRoleDescription}
                    renderCard={renderCard}
                  />
                );
              })}
            </KanbanLane>
          );
        })}
      </div>
      {/* No drop animation: the card it would fly back to has usually moved to
          another lane by then, and nothing here should depend on motion. */}
      <DragOverlay dropAnimation={null}>
        {active === null ? null : (
          <div className={cn(CARD_SHELL, 'cursor-grabbing shadow-lg')}>
            <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
              <GripVertical className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              {renderCard(active.item, { isDragging: true, isOverlay: true, isPending: false })}
            </div>
          </div>
        )}
      </DragOverlay>
      {/* The library's live region speaks the drag; this one speaks what only
          arrives afterwards — a move the caller's promise rejected. */}
      <ReorderAnnouncer message={failure} />
    </DndContext>
  );
}
