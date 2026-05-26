import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap focus inside `containerRef` while `active` (feature 029 mobile drawer).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const root = containerRef.current;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );

    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = items.indexOf(current as HTMLElement);
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          items[items.length - 1]?.focus();
        }
      } else if (idx === items.length - 1) {
        e.preventDefault();
        items[0]?.focus();
      }
    };

    root.addEventListener('keydown', onKeyDown);
    return (): void => {
      root.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [active, containerRef]);
}
