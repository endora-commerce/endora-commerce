import { forwardRef, useCallback, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils.js';

/**
 * `InlineStatus` — the short-lived result of an action, shown next to the
 * control that produced it (issue #1443, UX audit DS-10; owner decision DEC-12 a).
 *
 * It is a `role="status"` live region that is **always mounted**, empty until
 * there is something to say. A region that is created already carrying its
 * message is not reliably announced (WCAG 2.2 SC 4.1.3), which is why a
 * conditionally rendered success `Alert` at the top of the page is not the
 * pattern for "Saved" or "Copied": it is far from the button (Fitts, Proximity)
 * and often silent.
 *
 * It carries `role="status"` **and** `aria-live="polite"`, because the two are
 * honoured inconsistently across screen readers, and `aria-atomic` so the whole
 * sentence is read rather than the changed word.
 */

export type InlineStatusTone = 'success' | 'warning' | 'error' | 'info';

export interface InlineStatusProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'role' | 'children'> {
  /** The message. `null`, `undefined`, `false` or `''` leave the region mounted and empty. */
  children?: ReactNode;
  /**
   * Colour and icon. `success` (default), `warning` and `error` pair the
   * colour with an icon, so the meaning is never carried by colour alone;
   * `info` is plain muted text. `warning` is a result that went through only
   * in part — sent to some recipients, rendered with a fallback (issue #1499). The region stays polite whatever the tone — an error that has
   * to interrupt belongs in an `Alert variant="destructive"`.
   */
  tone?: InlineStatusTone;
  /**
   * Announce without showing — for a control whose visible state already
   * changed (a status badge, a reordered row) and only the screen reader
   * needs the sentence.
   */
  visuallyHidden?: boolean;
  /**
   * Change it to announce the same text again: the message is re-inserted
   * into the region, which screen readers read as new. `useInlineStatus`
   * manages it for you.
   */
  revision?: number | string;
}

const TONE_CLASS: Readonly<Record<InlineStatusTone, string>> = {
  success: 'text-[var(--success-soft-fg)]',
  warning: 'text-[var(--warn-soft-fg)]',
  error: 'text-destructive',
  info: 'text-muted-foreground',
};

const TONE_ICON: Readonly<Record<InlineStatusTone, typeof CheckCircle2 | null>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  info: null,
};

function isEmpty(node: ReactNode): boolean {
  return node === null || node === undefined || node === false || node === '';
}

export const InlineStatus = forwardRef<HTMLParagraphElement, InlineStatusProps>(
  ({ children, tone = 'success', visuallyHidden = false, revision, className, ...props }, ref) => {
    const empty = isEmpty(children);
    const Icon = TONE_ICON[tone];
    return (
      <p
        ref={ref}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-tone={empty ? undefined : tone}
        className={cn(
          visuallyHidden ? 'sr-only' : 'inline-flex items-center gap-1.5 text-sm font-medium',
          !visuallyHidden && TONE_CLASS[tone],
          className,
        )}
        {...props}
      >
        {empty ? null : (
          <span key={revision} className={visuallyHidden ? undefined : 'inline-flex items-center gap-1.5'}>
            {Icon !== null && !visuallyHidden ? (
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            ) : null}
            <span>{children}</span>
          </span>
        )}
      </p>
    );
  },
);
InlineStatus.displayName = 'InlineStatus';

export interface InlineStatusState {
  /** Spread onto `<InlineStatus {...status.props} />`. */
  props: { children: ReactNode; tone: InlineStatusTone; revision: number };
  /** Show a message; calling it again with the same text announces it again. */
  show: (message: ReactNode, tone?: InlineStatusTone) => void;
  /** Empty the region — on the next edit, so a stale "Saved" does not linger. */
  clear: () => void;
}

/**
 * State for one `InlineStatus`: `show(t('…saved'))` after the action succeeds,
 * `clear()` when the user edits again. The message stays until cleared rather
 * than disappearing on a timer, so it can be read at the reader's pace
 * (WCAG 2.2 SC 2.2.1).
 */
export function useInlineStatus(): InlineStatusState {
  const [state, setState] = useState<{ message: ReactNode; tone: InlineStatusTone; revision: number }>({
    message: null,
    tone: 'success',
    revision: 0,
  });
  const show = useCallback((message: ReactNode, tone: InlineStatusTone = 'success'): void => {
    setState((prev) => ({ message, tone, revision: prev.revision + 1 }));
  }, []);
  const clear = useCallback((): void => {
    setState((prev) => (prev.message === null ? prev : { ...prev, message: null }));
  }, []);
  return useMemo(
    () => ({
      props: { children: state.message, tone: state.tone, revision: state.revision },
      show,
      clear,
    }),
    [state, show, clear],
  );
}
