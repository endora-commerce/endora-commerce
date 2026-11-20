import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react';

/**
 * What `/dictionaries` asks of the active tab (issue #1562, UX audit WORK-13).
 * The page header carries the one *Add* for the tab on screen, as every list
 * page does; the tab owns the editor, so the header asks the tab to open it.
 */
export interface DictionaryTabHandle {
  /** Open the editor on a new entry and move focus to its first field. */
  create: () => void;
}

export interface DictionaryTabProps {
  ref?: Ref<DictionaryTabHandle> | undefined;
  /**
   * Told whether the dictionary holds no entry once it has loaded. While it is
   * empty the empty state's *Add* is the view's one primary, so the page hides
   * the header's (Von Restorff).
   */
  onEmptyChange?: ((empty: boolean) => void) | undefined;
}

/**
 * The tab's side of that contract: exposes `create` through `ref`, reports
 * emptiness, and returns the ref for the editor's first field together with
 * `create`, which opens the editor and then focuses that field — on a narrow
 * screen the editor sits below the table, so without the move the header's
 * *Add* would seem to do nothing.
 */
export function useDictionaryTab({
  ref,
  onEmptyChange,
  empty,
  openCreate,
}: DictionaryTabProps & { empty: boolean; openCreate: () => void }): {
  firstFieldRef: RefObject<HTMLInputElement | null>;
  create: () => void;
} {
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const openRef = useRef(openCreate);
  openRef.current = openCreate;

  const create = useRef((): void => {
    openRef.current();
    setFocusRequest((current) => current + 1);
  }).current;

  useImperativeHandle(ref, () => ({ create }), [create]);

  useEffect(() => {
    if (focusRequest > 0) firstFieldRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    onEmptyChange?.(empty);
  }, [empty, onEmptyChange]);

  return { firstFieldRef, create };
}
