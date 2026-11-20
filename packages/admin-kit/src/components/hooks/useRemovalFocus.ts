import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface RemovalFocus<T> {
  /**
   * A callback ref for a row's focus target — its name link, as a rule:
   * `<Link ref={removalFocus.targetRef(row)} …>`.
   */
  targetRef: (row: T) => (element: HTMLElement | null) => void;
  /** The list's create action ("New …"), wherever it is drawn: the header or the empty state. */
  createRef: RefObject<HTMLElement | null>;
  /**
   * `useConfirmDialog`'s `returnFocusTo` for deleting `row`: the next row's target, else the
   * previous one's. With no row left it answers `null` and focuses the create action once the
   * list has rendered empty — the empty state's own "New …", since the header's goes with the
   * last row.
   */
  returnFocusTo: (row: T) => () => HTMLElement | null;
}

/**
 * Where focus goes after a list row is deleted (issue #1495, UX audit CONTENT-13; WCAG 2.4.3).
 * The row's menu opened the confirmation, and the menu goes with the row, so without a target
 * focus would fall to `<body>`. This hands `useConfirmDialog` the neighbouring row instead, and
 * the create action when the list empties.
 *
 * ```tsx
 * const removalFocus = useRemovalFocus(rows, (row) => row.id, load.kind === 'ready');
 * <Link ref={removalFocus.targetRef(row)} to={…}>{row.name}</Link>
 * <Button asChild><Link ref={removalFocus.createRef} to="/x/new">…</Link></Button>
 * await confirm({ …, returnFocusTo: removalFocus.returnFocusTo(row) });
 * ```
 */
export function useRemovalFocus<T>(rows: readonly T[], idOf: (row: T) => string, ready: boolean): RemovalFocus<T> {
  const targets = useRef(new Map<string, HTMLElement>());
  const createRef = useRef<HTMLElement | null>(null);
  const focusCreateOnceEmpty = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const targetRef = useCallback(
    (row: T) =>
      (element: HTMLElement | null): void => {
        const id = idOf(row);
        if (element) targets.current.set(id, element);
        else targets.current.delete(id);
      },
    [idOf],
  );

  const returnFocusTo = useCallback(
    (row: T) => (): HTMLElement | null => {
      const current = rowsRef.current;
      const index = current.findIndex((candidate) => idOf(candidate) === idOf(row));
      const neighbour = current[index + 1] ?? current[index - 1];
      if (neighbour) return targets.current.get(idOf(neighbour)) ?? null;
      focusCreateOnceEmpty.current = true;
      return null;
    },
    [idOf],
  );

  useEffect(() => {
    if (!focusCreateOnceEmpty.current || !ready || rows.length > 0) return;
    focusCreateOnceEmpty.current = false;
    createRef.current?.focus();
  }, [ready, rows.length]);

  return { targetRef, createRef, returnFocusTo };
}
