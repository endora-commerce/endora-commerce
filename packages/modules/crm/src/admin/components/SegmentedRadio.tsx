import type { ReactNode } from 'react';
import { cn } from '@endora-commerce/admin-kit/lib';

export interface SegmentedRadioOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedRadioProps<T extends string> {
  /** The group's accessible name — what is being chosen. */
  label: string;
  /** The `name` the radios share; unique on the page. */
  name: string;
  value: T;
  options: readonly SegmentedRadioOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * One choice of a few, drawn as a segmented control.
 *
 * **Native radios underneath**, not buttons with `aria-pressed`: the browser
 * then gives the group one tab stop, the arrow keys, and "radio, 2 of 4" in a
 * screen reader, with no key handler here to get wrong (Jakob's Law — do not
 * rebuild a control the platform has). The chosen segment is raised and set in
 * a heavier weight, so it is not told apart by colour alone. Each segment is
 * 44 px tall on a touch screen and steps down from `sm`.
 */
export function SegmentedRadio<T extends string>(props: SegmentedRadioProps<T>): ReactNode {
  const { label, name, value, options, onChange, className } = props;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-input bg-muted p-0.5', className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center justify-center rounded px-3 text-sm text-muted-foreground sm:min-h-8',
            'has-[:checked]:bg-background has-[:checked]:font-semibold has-[:checked]:text-foreground has-[:checked]:shadow-sm',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1',
          )}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={(): void => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
