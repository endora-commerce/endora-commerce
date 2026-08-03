import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Keyboard-, pointer- and touch-operable list reordering, announced.
 *
 * Reorder is already reimplemented ad hoc in several admin surfaces
 * (`dictionaries/LanguagesTab`, `catalog/ProductEditor`, `megamenu`), each with
 * its own drag state and none with an announcement. This hook is the shared
 * version, introduced for feature 067 (FR-069, SC-014) under Principle IX's UX
 * escape hatch and deliberately placed in `components/` rather than inside the
 * module that needed it first.
 *
 * **Three affordances, one result, all announced.** Pointer drag is native
 * HTML5 (the in-repo idiom — `@dnd-kit` is not installed and this needs no
 * dependency); `moveBy` drives `TouchReorderButtons` unchanged; and the handle
 * implements the ARIA grab-mode keyboard map. A reorder available only through
 * dragging fails FR-069 outright, and dragging is also the affordance that does
 * not fire on touch at all.
 *
 * **The hook owns no list.** The caller passes `items` and receives
 * `onReorder(next)`, so the order lives wherever the caller's state does —
 * usually a draft the operator has not saved yet.
 *
 * **All copy is a prop.** The hook carries no strings, so it needs no i18n
 * namespace of its own and cannot leak one module's vocabulary into another's.
 */

export interface ReorderLabelContext {
  /** The moved item's label, in the operator's own words. */
  name: string;
  /** 1-based, because it is read aloud to a human. */
  index: number;
  total: number;
}

export interface ReorderLabels {
  grabbed: (context: ReorderLabelContext) => string;
  moving: (context: ReorderLabelContext) => string;
  dropped: (context: ReorderLabelContext) => string;
  cancelled: (context: ReorderLabelContext) => string;
  moved: (context: ReorderLabelContext) => string;
  atStart: (context: ReorderLabelContext) => string;
  atEnd: (context: ReorderLabelContext) => string;
  /** `aria-label` of the drag handle. */
  handle: (context: ReorderLabelContext) => string;
  /** `aria-roledescription` for a row. Defaults to `'sortable item'`. */
  roleDescription?: string;
}

export interface UseReorderListOptions<T> {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (next: T[]) => void;
  labels: ReorderLabels;
  /**
   * Turns every affordance off and announces nothing. Used when the list is
   * filtered: reordering a subset has no unambiguous meaning, and guessing at
   * one is worse than refusing (ux-design §3.5).
   */
  disabled?: boolean;
  /** Id of the visually-hidden instructions paragraph, for `aria-describedby`. */
  instructionsId?: string;
}

export interface ReorderItemProps {
  draggable: boolean;
  'aria-roledescription': string;
  'aria-posinset': number;
  'aria-setsize': number;
  onDragStart: (event: { dataTransfer?: { effectAllowed?: string } | null }) => void;
  onDragOver: (event: { preventDefault: () => void }) => void;
  onDragLeave: () => void;
  onDrop: (event: { preventDefault: () => void }) => void;
  onDragEnd: () => void;
}

export interface ReorderHandleProps {
  ref: (element: HTMLElement | null) => void;
  type: 'button';
  tabIndex: 0 | -1;
  'aria-label': string;
  'aria-pressed': boolean;
  'aria-describedby': string | undefined;
  onKeyDown: (event: ReorderKeyboardEvent) => void;
  onFocus: () => void;
}

/** The slice of a React keyboard event the hook consumes. */
export interface ReorderKeyboardEvent {
  key: string;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface UseReorderListResult<T> {
  /** The sentence the live region is currently carrying. */
  announcement: string;
  /** Which item the keyboard is holding, if any. */
  grabbedId: string | null;
  /** Which item the pointer is dragging, if any. */
  draggingId: string | null;
  /** The row a drag is currently over, for the drop indicator. */
  dropTargetId: string | null;
  /** The list's single tab stop (the ARIA composite-widget pattern). */
  activeId: string | null;
  moveBy: (id: string, delta: number) => void;
  /** `targetIndex` is 0-based; the announcement says the 1-based position. */
  moveTo: (id: string, targetIndex: number) => void;
  onHandleKeyDown: (id: string, event: ReorderKeyboardEvent) => void;
  onDragStart: (id: string) => void;
  onDrop: (overId: string) => void;
  getItemProps: (item: T, index: number) => ReorderItemProps;
  getHandleProps: (item: T, index: number) => ReorderHandleProps;
}

export function useReorderList<T>(
  options: UseReorderListOptions<T>,
): UseReorderListResult<T> {
  const { items, getId, getLabel, onReorder, labels, disabled = false } = options;

  const [announcement, setAnnouncement] = useState('');
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /** Where a grabbed item started, so `Escape` can undo the whole gesture. */
  const grabOriginRef = useRef<number | null>(null);
  const handlesRef = useRef(new Map<string, HTMLElement | null>());

  const ids = useMemo(() => items.map(getId), [items, getId]);
  const activeId = focusedId && ids.includes(focusedId) ? focusedId : (ids[0] ?? null);

  const indexOf = useCallback((id: string): number => ids.indexOf(id), [ids]);

  /**
   * The single mutation. Everything else — drag, buttons, keyboard, "move to
   * position…" — funnels through it, which is what keeps one announcement
   * vocabulary across three affordances that would otherwise drift apart.
   */
  const applyMove = useCallback(
    (
      id: string,
      targetIndex: number,
      announce: (context: ReorderLabelContext) => string,
    ): boolean => {
      if (disabled) return false;
      const from = indexOf(id);
      if (from < 0) return false;
      const total = items.length;
      const name = getLabel(items[from]!);

      if (targetIndex < 0) {
        setAnnouncement(labels.atStart({ name, index: 1, total }));
        return false;
      }
      if (targetIndex > total - 1) {
        setAnnouncement(labels.atEnd({ name, index: total, total }));
        return false;
      }
      if (targetIndex === from) return false;

      const next = [...items];
      next.splice(from, 1);
      next.splice(targetIndex, 0, items[from]!);
      onReorder(next);
      setAnnouncement(announce({ name, index: targetIndex + 1, total }));
      // The tab stop follows the item, not the slot: React keys are ids, so the
      // DOM node travels with it and focus survives without a manual `.focus()`.
      setFocusedId(id);
      return true;
    },
    [disabled, indexOf, items, getLabel, labels, onReorder],
  );

  const moveBy = useCallback(
    (id: string, delta: number): void => {
      applyMove(id, indexOf(id) + delta, labels.moved);
    },
    [applyMove, indexOf, labels.moved],
  );

  const moveTo = useCallback(
    (id: string, targetIndex: number): void => {
      applyMove(id, targetIndex, labels.moved);
    },
    [applyMove, labels.moved],
  );

  const focusHandle = useCallback((id: string): void => {
    setFocusedId(id);
    handlesRef.current.get(id)?.focus();
  }, []);

  const onHandleKeyDown = useCallback(
    (id: string, event: ReorderKeyboardEvent): void => {
      if (disabled) return;
      const index = indexOf(id);
      if (index < 0) return;
      const total = items.length;
      const name = getLabel(items[index]!);
      const grabbed = grabbedId === id;

      // Alt+arrow moves without grabbing — the VS Code / Notion convention an
      // experienced operator will try first (Jakob's Law).
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveBy(id, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }

      switch (event.key) {
        case ' ':
        case 'Spacebar':
        case 'Enter': {
          event.preventDefault();
          if (grabbed) {
            setGrabbedId(null);
            grabOriginRef.current = null;
            setAnnouncement(labels.dropped({ name, index: index + 1, total }));
          } else {
            setGrabbedId(id);
            grabOriginRef.current = index;
            setFocusedId(id);
            setAnnouncement(labels.grabbed({ name, index: index + 1, total }));
          }
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault();
          const delta = event.key === 'ArrowUp' ? -1 : 1;
          if (grabbed) {
            applyMove(id, index + delta, labels.moving);
            return;
          }
          const neighbour = ids[index + delta];
          if (neighbour) focusHandle(neighbour);
          return;
        }
        case 'Home':
        case 'End': {
          event.preventDefault();
          const target = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
          if (!target) return;
          if (grabbed) {
            applyMove(id, event.key === 'Home' ? 0 : total - 1, labels.moving);
            return;
          }
          focusHandle(target);
          return;
        }
        case 'Escape': {
          if (!grabbed) return;
          event.preventDefault();
          const origin = grabOriginRef.current;
          setGrabbedId(null);
          grabOriginRef.current = null;
          if (origin === null || origin === index) return;
          applyMove(id, origin, () => '');
          setAnnouncement(labels.cancelled({ name, index: origin + 1, total }));
          return;
        }
        default:
      }
    },
    [
      disabled,
      indexOf,
      items,
      getLabel,
      grabbedId,
      ids,
      labels,
      moveBy,
      applyMove,
      focusHandle,
    ],
  );

  const onDragStart = useCallback(
    (id: string): void => {
      if (disabled) return;
      setDraggingId(id);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (overId: string): void => {
      if (disabled) return;
      const sourceId = draggingId;
      setDraggingId(null);
      setDropTargetId(null);
      if (!sourceId || sourceId === overId) return;
      applyMove(sourceId, indexOf(overId), labels.moved);
    },
    [disabled, draggingId, applyMove, indexOf, labels.moved],
  );

  const getItemProps = useCallback(
    (item: T, index: number): ReorderItemProps => {
      const id = getId(item);
      return {
        draggable: !disabled,
        'aria-roledescription': labels.roleDescription ?? 'sortable item',
        'aria-posinset': index + 1,
        'aria-setsize': items.length,
        onDragStart: (): void => onDragStart(id),
        onDragOver: (event): void => {
          if (disabled) return;
          // Without this the browser never fires `drop` at all.
          event.preventDefault();
          setDropTargetId(id);
        },
        onDragLeave: (): void => setDropTargetId((current) => (current === id ? null : current)),
        onDrop: (event): void => {
          event.preventDefault();
          onDrop(id);
        },
        onDragEnd: (): void => {
          setDraggingId(null);
          setDropTargetId(null);
        },
      };
    },
    [disabled, getId, items.length, labels.roleDescription, onDragStart, onDrop],
  );

  const getHandleProps = useCallback(
    (item: T, index: number): ReorderHandleProps => {
      const id = getId(item);
      return {
        ref: (element: HTMLElement | null): void => {
          handlesRef.current.set(id, element);
        },
        type: 'button',
        // Exactly one tab stop for the whole list: 23 rows × 5 controls would
        // otherwise be ~115 stops between the search box and the inspector.
        tabIndex: id === activeId ? 0 : -1,
        'aria-label': labels.handle({
          name: getLabel(item),
          index: index + 1,
          total: items.length,
        }),
        'aria-pressed': grabbedId === id,
        'aria-describedby': options.instructionsId,
        onKeyDown: (event): void => onHandleKeyDown(id, event),
        onFocus: (): void => setFocusedId(id),
      };
    },
    [
      getId,
      getLabel,
      items.length,
      activeId,
      grabbedId,
      labels,
      options.instructionsId,
      onHandleKeyDown,
    ],
  );

  return {
    announcement,
    grabbedId,
    draggingId,
    dropTargetId,
    activeId,
    moveBy,
    moveTo,
    onHandleKeyDown,
    onDragStart,
    onDrop,
    getItemProps,
    getHandleProps,
  };
}

/** Utility for callers that need the same move outside the hook's affordances. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items;
  }
  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, items[from]!);
  return next;
}

/** Also exported for the labels-only consumer that renders `labelOf` elsewhere. */
export type { UseReorderListOptions as ReorderListOptions };
