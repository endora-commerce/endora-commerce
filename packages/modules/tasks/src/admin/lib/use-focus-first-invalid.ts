import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Focus to the first invalid field after a refused submit (issue #512; WCAG
 * 3.3.1 *Error identification*, 4.1.3 *Status messages*).
 *
 * A form that only paints its errors leaves a screen-reader user on the
 * submit button with nothing said. Moving focus to the first field marked
 * `aria-invalid="true"` reads that field's name and — through its
 * `aria-describedby` — the error, and puts the cursor where the fix is typed.
 *
 * `refuse()` is called where the submit stops; the focus moves after the
 * render that marks the fields, so it lands on what the user sees as invalid.
 * `container` is the form's element when the form already holds a ref to it.
 */
export function useFocusFirstInvalid<T extends HTMLElement>(container?: RefObject<T | null>): {
  containerRef: RefObject<T | null>;
  refuse: () => void;
} {
  const own = useRef<T>(null);
  const containerRef = container ?? own;
  const [refusals, setRefusals] = useState(0);

  useEffect(() => {
    if (refusals === 0) return;
    containerRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusals, containerRef]);

  const refuse = useCallback((): void => setRefusals((count) => count + 1), []);
  return { containerRef, refuse };
}
