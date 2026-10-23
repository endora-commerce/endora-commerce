import { useId, type ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Input, Label } from '@endora-commerce/admin-kit/ui';
import type { Translate } from '../lib/cell-labels.js';

/**
 * A book's schedule and priority (feature 161, FR-002, FR-003). The two dates
 * are optional — empty means "from activation" and "without an end" — and are
 * typed in the browser's local time, sent as ISO instants. Priority is the
 * same-cell tie-break of `specs/pricing/decision-record.md` §5.4, said in words
 * beside the field because an operator otherwise reads it as a ranking of
 * every book.
 */

export interface ScheduleDraft {
  /** `datetime-local` values; `''` for none. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly priority: string;
}

export interface ParsedSchedule {
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly priority: number;
  readonly errors: Record<string, string>;
}

/** A stored instant as a `datetime-local` value in the browser's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseSchedule(draft: ScheduleDraft, t: Translate): ParsedSchedule {
  const errors: Record<string, string> = {};
  const instant = (value: string): string | null => {
    if (value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  const startsAt = instant(draft.startsAt);
  const endsAt = instant(draft.endsAt);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors['endsAt'] = t('priceBooks.validation.endsBeforeStarts');
  }
  const text = draft.priority.trim();
  const priority = text === '' ? 0 : Number(text);
  if (!Number.isInteger(priority) || Math.abs(priority) > 1_000_000) {
    errors['priority'] = t('priceBooks.validation.priorityInteger');
  }
  return { startsAt, endsAt, priority: Number.isInteger(priority) ? priority : 0, errors };
}

export function ScheduleFields(props: {
  readonly value: ScheduleDraft;
  readonly onChange: (next: ScheduleDraft) => void;
  readonly errors: Record<string, string>;
  /** Only the priority (a base book has no schedule). */
  readonly priorityOnly?: boolean;
  readonly readOnly?: boolean;
}): ReactNode {
  const t = useTranslation('price_lists');
  const id = useId();
  const field = (key: 'startsAt' | 'endsAt' | 'priority', label: string, input: ReactNode, help?: string): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      {input}
      {help ? (
        <p id={`${id}-${key}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {props.errors[key] ? (
        <p id={`${id}-${key}-error`} className="text-xs text-destructive">
          {props.errors[key]}
        </p>
      ) : null}
    </div>
  );
  const described = (key: string, help: boolean): string | undefined =>
    [help ? `${id}-${key}-help` : null, props.errors[key] ? `${id}-${key}-error` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-4">
      {props.priorityOnly ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            'startsAt',
            t('priceBooks.field.startsAt'),
            <Input
              id={`${id}-startsAt`}
              type="datetime-local"
              value={props.value.startsAt}
              readOnly={props.readOnly}
              aria-describedby={described('startsAt', false)}
              onChange={(event): void => props.onChange({ ...props.value, startsAt: event.target.value })}
            />,
          )}
          {field(
            'endsAt',
            t('priceBooks.field.endsAt'),
            <Input
              id={`${id}-endsAt`}
              type="datetime-local"
              value={props.value.endsAt}
              readOnly={props.readOnly}
              aria-invalid={props.errors['endsAt'] ? true : undefined}
              aria-describedby={described('endsAt', false)}
              onChange={(event): void => props.onChange({ ...props.value, endsAt: event.target.value })}
            />,
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('priceBooks.schedule.help')}</p>
        </div>
      )}
      {field(
        'priority',
        t('priceBooks.field.priority'),
        <Input
          id={`${id}-priority`}
          inputMode="numeric"
          className="max-w-40"
          value={props.value.priority}
          readOnly={props.readOnly}
          aria-invalid={props.errors['priority'] ? true : undefined}
          aria-describedby={described('priority', true)}
          onChange={(event): void => props.onChange({ ...props.value, priority: event.target.value })}
        />,
        t('priceBooks.schedule.priorityHelp'),
      )}
    </div>
  );
}
