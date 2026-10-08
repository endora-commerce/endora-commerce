import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { entryDayKey, type CalendarEntry } from '../../lib/calendar/date-math.js';
import { fullDayLabel, timeLabel } from '../../lib/calendar/format.js';

/**
 * When an entry happens, in words: its day, and its times or "all day". Shared
 * by the calendar's entries and the Events tab's rows, so the two never say the
 * same moment two ways.
 */
export function useEntryWhen(): (entry: Pick<CalendarEntry, 'allDay' | 'allDayDate' | 'startsAt' | 'endsAt'>) => string {
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  return useCallback(
    (entry) => {
      const date = fullDayLabel(entryDayKey(entry), language);
      if (entry.allDay) return t('calendar.entry.wholeDay', { date });
      return t('calendar.entry.timed', {
        date,
        from: timeLabel(new Date(entry.startsAt), language),
        to: timeLabel(new Date(entry.endsAt), language),
      });
    },
    [t, language],
  );
}

export interface EventChipProps {
  entry: CalendarEntry;
  /**
   * `compact` — one line, for a month cell and the all-day row;
   * `block` — fills the box the time grid gives it;
   * `row` — a full-width row of the agenda, 44 px tall.
   */
  variant: 'compact' | 'block' | 'row';
  /** The entry was cut at local midnight and goes on after it. */
  continues?: boolean;
  /**
   * `compact` only — the name before the time, and the time the first to be
   * cut: for the time grid, where a column can be 80 px wide and the position
   * already is the time. A month cell keeps the time first, to be read down.
   */
  nameFirst?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * One Event on a calendar: a link to its Opportunity (FR-148).
 *
 * A real `<a href>` through the router's `Link`, so Enter, a middle click and
 * "open in a new tab" are the browser's and there is no handler to forget.
 *
 * **What is drawn may be cut; what is said never is.** A lane a sixth of a
 * column wide shows two letters, so the accessible name — and the `title` a
 * pointer gets — is always whole: the name, the day and the time, the
 * Opportunity, and whether a reminder is set. All entries are one colour; a
 * reminder is a bell and a word, never a tint.
 */
export function EventChip(props: EventChipProps): ReactNode {
  const { entry, variant, continues = false, nameFirst = false, className, style } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const when = useEntryWhen();

  const time = entry.allDay ? null : timeLabel(new Date(entry.startsAt), language);
  const label = [
    entry.context
      ? t('calendar.entry.label', { name: entry.name, when: when(entry), context: entry.context })
      : t('calendar.entry.labelPlain', { name: entry.name, when: when(entry) }),
    ...(continues ? [t('calendar.continues')] : []),
    ...(entry.hasReminder ? [t('calendar.entry.hasReminder')] : []),
  ].join(', ');

  const bell = entry.hasReminder ? <Bell aria-hidden="true" className="size-3 shrink-0" /> : null;

  return (
    <Link
      to={entry.href}
      aria-label={label}
      title={label}
      style={style}
      className={cn(
        'block overflow-hidden rounded-sm border-l-2 border-primary bg-primary/10 text-foreground no-underline',
        'hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        variant === 'compact' && 'flex min-h-6 items-center gap-1 px-1.5 text-xs leading-6',
        variant === 'block' && 'h-full min-h-6 px-1.5 py-0.5 text-xs leading-4',
        variant === 'row' && 'flex min-h-11 items-center gap-3 px-3 py-2 text-sm',
        className,
      )}
    >
      {variant === 'row' ? (
        <>
          <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
            {time ?? t('calendar.allDay')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{entry.name}</span>
            {entry.context ? (
              <span className="block truncate text-xs text-muted-foreground">{entry.context}</span>
            ) : null}
          </span>
          {bell}
        </>
      ) : variant === 'block' ? (
        <>
          {/* The name first: in a narrow lane it is what there is room for, and the position is the time. */}
          <span className="block truncate font-medium">{entry.name}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="truncate tabular-nums">{time}</span>
            {bell}
          </span>
          {entry.context ? <span className="block truncate text-muted-foreground">{entry.context}</span> : null}
        </>
      ) : (
        <>
          {time && !nameFirst ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">{time}</span>
          ) : null}
          <span className={cn('truncate font-medium', nameFirst ? 'max-w-full shrink-0' : 'min-w-0')}>
            {entry.name}
          </span>
          {time && nameFirst ? (
            <span className="min-w-0 truncate tabular-nums text-muted-foreground">{time}</span>
          ) : null}
          {bell}
        </>
      )}
    </Link>
  );
}

/** A grey bar where an entry will be, while the range is being read. */
export function EventChipSkeleton(props: { className?: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn('block h-5 animate-pulse rounded-sm bg-muted motion-reduce:animate-none', props.className)}
    />
  );
}
