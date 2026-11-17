import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from 'react';
import { cn } from '../lib/utils.js';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type' | 'role' | 'value'> {
  /** Whether the switch is on. The switch is always controlled. */
  checked: boolean;
  /** Called with the value the operator asked for. Not called while disabled or busy. */
  onCheckedChange: (next: boolean) => void;
  /**
   * Why the switch cannot be used. Keeps it focusable — a natively disabled
   * button drops out of the tab order, so its reason is never heard — marks it
   * `aria-disabled` and describes it with this text. Implies disabled.
   */
  disabledReason?: string;
  /**
   * A write started by this switch is in flight (an immediate toggle). The
   * switch shows it, says it (`aria-busy`) and ignores further presses until
   * the caller clears it, so the operator cannot double-submit (Doherty).
   */
  busy?: boolean;
}

/**
 * An on/off control — issue #1442 (UX audit 2026-11-17, DS-09).
 *
 * A native `<button role="switch" aria-checked>`: no new dependency, and the
 * button already brings keyboard operation (Space and Enter), focusability and
 * labelling through `<label for>`, so `FormField` and `SettingRow` name it
 * like any other control. Owner decision DEC-04: every boolean setting and
 * every toggle that takes effect immediately is a `Switch`; in a form it is a
 * `Switch` only where the label describes a state ("Visible on the
 * storefront"), otherwise keep a `Checkbox` ("I accept the terms").
 *
 * - The thumb's position carries the state as well as the track's colour, so
 *   the state is never carried by colour alone (SC 1.4.1); the unchecked track
 *   is `muted-foreground`, not the near-white `input`, so its boundary meets
 *   3:1 (SC 1.4.11).
 * - The visible track is 36 × 20 px; on a coarse pointer a transparent
 *   pseudo-element grows the hit area to 44 × 44 px without growing the box
 *   (Fitts's Law). The label is part of the target too.
 * - The thumb's slide is `motion-safe` only (`prefers-reduced-motion`); the
 *   position still changes, so no information is lost with the motion.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      onCheckedChange,
      disabled,
      disabledReason,
      busy = false,
      className,
      onClick,
      'aria-describedby': describedBy,
      ...props
    },
    ref,
  ) => {
    const reasonId = useId();
    const hasReason = typeof disabledReason === 'string' && disabledReason !== '';
    const inert = hasReason || busy;
    const ids = [describedBy, hasReason ? reasonId : undefined].filter(Boolean).join(' ');

    // Space and Enter on a button arrive here as a click, so this one guard
    // covers pointer and keyboard alike.
    const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
      onClick?.(event);
      if (event.defaultPrevented || inert) return;
      onCheckedChange(!checked);
    };

    return (
      <>
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          data-state={checked ? 'checked' : 'unchecked'}
          disabled={disabled === true && !hasReason}
          {...(hasReason ? { 'aria-disabled': true as const } : {})}
          {...(hasReason && props.title === undefined ? { title: disabledReason } : {})}
          {...(busy ? { 'aria-busy': true as const } : {})}
          {...(ids === '' ? {} : { 'aria-describedby': ids })}
          onClick={handleClick}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
            'motion-safe:transition-colors',
            checked ? 'bg-primary' : 'bg-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
            'aria-busy:cursor-wait aria-busy:opacity-70',
            "pointer-coarse:before:absolute pointer-coarse:before:-inset-x-1 pointer-coarse:before:-inset-y-3 pointer-coarse:before:content-['']",
            className,
          )}
          {...props}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0',
              'motion-safe:transition-transform',
              checked ? 'translate-x-4' : 'translate-x-0',
              busy && 'motion-safe:animate-pulse',
            )}
          />
        </button>
        {hasReason ? (
          <span id={reasonId} className="sr-only">
            {disabledReason}
          </span>
        ) : null}
      </>
    );
  },
);
Switch.displayName = 'Switch';
