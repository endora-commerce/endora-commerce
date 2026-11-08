import type { ReactNode, Ref } from 'react';

/**
 * A short list of mutually exclusive resolutions as native radios (issue #905).
 *
 * A radio group rather than a `<select>` because some options can be closed: a
 * disabled `<option>` hides both the fact and its reason until the list is
 * opened, and some screen readers skip it altogether. Here every option stays
 * visible, a closed one says why beside its own label, and the whole row is the
 * hit area. The kit has no radio primitive, so this follows the native-radio
 * pattern the other modules' dialogs use (`price_lists` `BulkChangeDialog`).
 */
export interface ResolutionRadioGroupProps<T extends string> {
  /** Shared `name` of the radios; also the prefix of their ids. */
  name: string;
  legend: ReactNode;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  label: (option: T) => string;
  /** Options that cannot be chosen, with the short reason shown beside them. */
  closed?: ReadonlySet<string>;
  closedReason?: string;
  /** Element ids that describe the group (a hint, an error). */
  describedBy?: string;
  required?: boolean;
  invalid?: boolean;
  /** Receives the checked radio, or the first one when none is checked: a dialog's initial focus. */
  focusRef?: Ref<HTMLInputElement>;
}

export function ResolutionRadioGroup<T extends string>(props: ResolutionRadioGroupProps<T>): ReactNode {
  const { name, legend, options, value, onChange, label, closed, closedReason, describedBy, required, invalid, focusRef } =
    props;
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={`${name}-legend`}
      className="space-y-1"
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      {...(required ? { 'aria-required': true } : {})}
      {...(invalid ? { 'aria-invalid': true } : {})}
    >
      <legend id={`${name}-legend`} className="mb-1 text-sm font-medium leading-none">{legend}</legend>
      {options.map((option, index) => {
        const isClosed = closed?.has(option) === true;
        return (
          <label
            key={option}
            htmlFor={`${name}-${option}`}
            className={`flex min-h-11 items-center gap-2 text-sm sm:min-h-8 ${isClosed ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'}`}
          >
            <input
              id={`${name}-${option}`}
              ref={value === option || (value === null && index === 0) ? focusRef : undefined}
              type="radio"
              name={name}
              value={option}
              className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              checked={value === option}
              disabled={isClosed}
              onChange={() => onChange(option)}
            />
            <span>
              {label(option)}
              {isClosed && closedReason ? <span className="text-xs"> ({closedReason})</span> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
