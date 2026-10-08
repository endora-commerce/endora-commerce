import type { ReactNode } from 'react';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  monthMatrix,
  sameMonth,
  type CalendarEntry,
  type DayKey,
} from '../../lib/calendar/date-math.js';
import {
  dayHeadingLabel,
  dayNumberLabel,
  longWeekdayLabel,
  shortWeekdayLabel,
} from '../../lib/calendar/format.js';
import { monthCell } from '../../lib/calendar/layout.js';
import { EventChip, EventChipSkeleton } from './EventChip.js';

export interface MonthViewProps {
  /** Any day of the month shown. */
  date: DayKey;
  today: DayKey;
  byDay: ReadonlyMap<DayKey, readonly CalendarEntry[]>;
  /** The range's name, as the table's caption. */
  caption: string;
  loading: boolean;
  /** "+N more" was pressed on a day. */
  onMore: (day: DayKey) => void;
}

/**
 * The month: **a real table** (research N-CAL10). Seven column headers and six
 * rows of days from Monday, so a screen reader's own table navigation says
 * "Thursday, 8" with nothing added here.
 *
 * A cell does nothing — only its entries and its "+N more" do — so no cell is a
 * focus stop and there is no arrow-key grid: 42 inert stops would be slower,
 * not more accessible. Tab walks the entries in the order of the calendar.
 *
 * Today is a filled disc **and** the word; a day of a neighbouring month is
 * muted and still readable.
 */
export function MonthView(props: MonthViewProps): ReactNode {
  const { date, today, byDay, caption, loading, onMore } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const weeks = monthMatrix(date);
  const firstWeek = weeks[0] ?? [];

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {firstWeek.map((day) => (
            <th
              key={day}
              scope="col"
              className="border border-border bg-muted/50 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground"
            >
              <abbr title={longWeekdayLabel(day, language)} className="no-underline">
                {shortWeekdayLabel(day, language)}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, row) => (
          <tr key={week[0]}>
            {week.map((day, column) => {
              const isToday = day === today;
              const outside = !sameMonth(day, date);
              const cell = monthCell(byDay.get(day) ?? []);
              return (
                <td
                  key={day}
                  className={cn(
                    'h-28 border border-border p-1 align-top',
                    outside && 'bg-muted/40',
                  )}
                >
                  <time
                    dateTime={day}
                    aria-current={isToday ? 'date' : undefined}
                    className={cn(
                      'mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums',
                      isToday
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : outside
                          ? 'text-muted-foreground'
                          : 'text-foreground',
                    )}
                  >
                    {dayNumberLabel(day, language)}
                  </time>
                  {isToday ? <span className="sr-only">{t('calendar.today')}</span> : null}
                  {loading ? (
                    // A scatter that is the same on every render: no layout shift, no random.
                    (row * 7 + column) % 4 === 1 ? (
                      <EventChipSkeleton />
                    ) : null
                  ) : cell.shown.length > 0 ? (
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {cell.shown.map((entry) => (
                        <li key={entry.id}>
                          <EventChip entry={entry} variant="compact" />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!loading && cell.more > 0 ? (
                    <button
                      type="button"
                      className="mt-0.5 min-h-6 w-full rounded-sm px-1.5 text-left text-xs font-medium text-muted-foreground underline-offset-2 hover:bg-accent hover:text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t('calendar.moreLabel', {
                        count: cell.more,
                        date: dayHeadingLabel(day, language),
                      })}
                      onClick={(): void => onMore(day)}
                    >
                      {t('calendar.more', { count: cell.more })}
                    </button>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
