import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export interface FilterChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onChange' | 'aria-pressed' | 'children'> {
  /** Whether the filter is applied. The chip is always controlled. */
  pressed: boolean;
  /** Called with the state the operator asked for. Not called while disabled. */
  onPressedChange: (next: boolean) => void;
  /** A decorative leading icon; hidden from assistive technology. */
  icon?: ReactNode;
  /** The visible label, which is also the accessible name. */
  children: ReactNode;
}

/**
 * A one-press filter toggle — issue #1440 (UX audit 2026-11-17, DS-06).
 *
 * A native `<button type="button" aria-pressed>`: the pressed state is
 * announced, not only drawn, so the theme's `is-on` colour is never the one
 * carrier of meaning (SC 1.4.1, 4.1.2). Use it for a filter that is either on
 * or off ("Low stock", "Overdue"); a filter with several values is a labelled
 * `Select` or `MultiSelect` instead — a chip that cycles through values on each
 * press says nothing about what the next press does.
 *
 * It renders the theme's `b2b-filterchip` vocabulary, so a chip looks the same
 * on every list (Law of Similarity). The visible chip is 30 px tall; on a
 * coarse pointer a transparent pseudo-element grows the hit area past 44 px
 * without growing the box (Fitts's Law).
 */
export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ pressed, onPressedChange, icon, children, className, onClick, disabled, ...props }, ref) => {
    const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
      onClick?.(event);
      if (event.defaultPrevented || disabled === true) return;
      onPressedChange(!pressed);
    };
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          'b2b-filterchip relative',
          pressed && 'is-on',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-2 pointer-coarse:before:content-['']",
          className,
        )}
        {...props}
      >
        {icon ? (
          <span aria-hidden="true" className="inline-flex">
            {icon}
          </span>
        ) : null}
        <span>{children}</span>
      </button>
    );
  },
);
FilterChip.displayName = 'FilterChip';
