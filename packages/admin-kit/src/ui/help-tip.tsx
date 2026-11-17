import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useTranslation } from '../i18n/useTranslation.js';

export interface HelpTipProps {
  /** The explanation. Any length — this is where text too long for a hint goes. */
  children: ReactNode;
  /**
   * The id of the element naming what the tip explains (a field's label, a page
   * title). The button is then announced as *"More information: Payment terms"*
   * rather than as one of several identical *"More information"* buttons.
   */
  subjectId?: string;
  /** Where the panel opens, relative to the button. */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * A ⓘ button that discloses a longer explanation — issue #1432 (UX audit DS-08,
 * shared with DS-02's `PageHeader` `help`).
 *
 * **A disclosure, not a tooltip.** A hover tooltip cannot be reached on a touch
 * screen and disappears under a magnifier; a button with `aria-expanded` can be
 * opened by click, tap and keyboard alike (WCAG 2.2 SC 1.4.13, 2.1.1). The
 * panel closes on Escape — focus goes back to the button — and on a press
 * outside it.
 *
 * The visible icon is 16 px; a pseudo-element grows the hit area to 36 px so the
 * button is not a pin-prick target beside a label (Fitts's Law), without pushing
 * the label line apart.
 *
 * The panel is not part of any control's `aria-describedby`: the point of moving
 * text here is that it is not read on every focus. The one-line `hint` is what
 * is.
 */
export function HelpTip({ children, subjectId, align = 'start', className }: HelpTipProps): ReactNode {
  const t = useTranslation('core');
  const [open, setOpen] = useState(false);
  const buttonId = useId();
  const panelId = `${buttonId}-panel`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return (
    <span ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-label={t('common.helpTip.label')}
        // Its own label first, then the subject's: "More information: Payment terms".
        aria-labelledby={subjectId ? `${buttonId} ${subjectId}` : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          "after:absolute after:-inset-2.5 after:content-['']",
          open && 'text-foreground',
        )}
      >
        <CircleHelp aria-hidden="true" className="h-4 w-4" />
      </button>
      {open ? (
        <span
          id={panelId}
          className={cn(
            'absolute top-full z-30 mt-2 block w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-3',
            'text-xs font-normal leading-relaxed text-popover-foreground shadow-md',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
