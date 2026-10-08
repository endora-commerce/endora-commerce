import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  minuteOfDay,
  type CalendarEntry,
  type DayKey,
} from '../../lib/calendar/date-math.js';
import {
  dayHeadingLabel,
  dayNumberLabel,
  shortWeekdayLabel,
  timeLabel,
} from '../../lib/calendar/format.js';
import { HOUR_HEIGHT, layoutDay, offsetOfMinute } from '../../lib/calendar/layout.js';
import { EventChip, EventChipSkeleton } from './EventChip.js';

/** The height of a day column's head, in pixels. */
const HEAD_HEIGHT = 56;
/** One line of the all-day row. */
const ALL_DAY_LINE = 28;
const ALL_DAY_PADDING = 4;
/** The hour the grid opens on: a working day starts above the fold. */
const OPENING_HOUR = 7;
/** Below this height a timed entry is one line — its time and its name side by side. */
const ONE_LINE_BELOW = 36;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const GRID_HEIGHT = 24 * HOUR_HEIGHT;

export interface WeekViewProps {
  /** The day columns: seven for a week, one for a day. */
  days: readonly DayKey[];
  today: DayKey;
  /** The current time; the line is drawn on today's column only. */
  now: Date;
  byDay: ReadonlyMap<DayKey, readonly CalendarEntry[]>;
  loading: boolean;
  /** The level of a day's heading: one under the range title's. */
  dayHeading: 'h3' | 'h4';
}

/**
 * The week — and, with one column, the day: day columns under an all-day row,
 * beside an hour scale (FR-147).
 *
 * **For assistive technology it is seven sections, not a grid** (research
 * N-CAL10): each day a `section` under a heading that counts its Events,
 * holding one ordered list — the all-day entries first, then the timed ones in
 * order of time. The hour scale, the hour lines and the current-time line are
 * decoration and are hidden; every entry says its own time.
 *
 * The same list is what is drawn. The box scrolls on its own; each column's
 * head and its all-day entries are `sticky`, so they stay put while the hours
 * move under them, and the timed entries are placed by `lib/calendar/layout.ts`
 * — top and height from start and length, overlapping ones side by side.
 */
export function WeekView(props: WeekViewProps): ReactNode {
  const { days, today, now, byDay, loading, dayHeading: DayHeading } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstDay = days[0];

  // Open on the working day, and again whenever another week is shown.
  useLayoutEffect(() => {
    // A little above the hour, so its label on the scale is whole.
    if (scrollRef.current) scrollRef.current.scrollTop = OPENING_HOUR * HOUR_HEIGHT - 12;
  }, [firstDay, days.length]);

  const columns = days.map((day) => {
    const entries = byDay.get(day) ?? [];
    return {
      day,
      count: entries.length,
      allDay: entries.filter((entry) => entry.allDay),
      timed: layoutDay(entries),
    };
  });
  const allDayLines = Math.max(1, ...columns.map((column) => column.allDay.length));
  const bandHeight = allDayLines * ALL_DAY_LINE + 2 * ALL_DAY_PADDING;
  const columnHeight = HEAD_HEIGHT + bandHeight + GRID_HEIGHT;

  return (
    <div
      ref={scrollRef}
      className="max-h-[40rem] overflow-y-auto overflow-x-hidden rounded-md border border-border"
    >
      <div className="flex">
        {/* The hour scale: decoration. Every entry states its own time. */}
        <div
          aria-hidden="true"
          className="relative w-14 shrink-0 border-r border-border text-[11px] text-muted-foreground"
          style={{ height: columnHeight }}
        >
          <div
            className="sticky top-0 z-30 flex items-end justify-end border-b border-border bg-card px-1 pb-1"
            style={{ height: HEAD_HEIGHT + bandHeight }}
          >
            {t('calendar.allDay')}
          </div>
          {HOURS.slice(1).map((hour) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 tabular-nums"
              style={{ top: HEAD_HEIGHT + bandHeight + hour * HOUR_HEIGHT }}
            >
              {timeLabel(new Date(2000, 0, 1, hour), language)}
            </span>
          ))}
        </div>

        {columns.map(({ day, count, allDay, timed }) => {
          const isToday = day === today;
          const headingId = `crm-calendar-day-${day}`;
          const heading =
            count > 0
              ? t('calendar.day.heading', { date: dayHeadingLabel(day, language), count })
              : t('calendar.day.headingEmpty', { date: dayHeadingLabel(day, language) });
          return (
            <section
              key={day}
              aria-labelledby={headingId}
              className={cn(
                'relative min-w-0 flex-1 border-r border-border last:border-r-0',
                isToday && 'bg-primary/5',
              )}
              style={{ height: columnHeight }}
            >
              <DayHeading
                id={headingId}
                className="sticky top-0 z-30 m-0 flex flex-col items-center justify-center border-b border-border bg-card text-xs font-medium"
                style={{ height: HEAD_HEIGHT }}
              >
                <span aria-hidden="true" className="flex flex-col items-center gap-0.5">
                  <span className="uppercase tracking-wide text-muted-foreground">
                    {shortWeekdayLabel(day, language)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm tabular-nums',
                      isToday && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {dayNumberLabel(day, language)}
                  </span>
                </span>
                <span className="sr-only">
                  {isToday ? `${t('calendar.today')}, ${heading}` : heading}
                </span>
              </DayHeading>

              {/* The all-day row's ground: it stays while the hours scroll under it. */}
              <div
                aria-hidden="true"
                className="sticky z-10 border-b border-border bg-card"
                style={{ top: HEAD_HEIGHT, height: bandHeight }}
              />

              {/* Hour lines and the current time: decoration. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0"
                style={{ top: HEAD_HEIGHT + bandHeight, height: GRID_HEIGHT }}
              >
                {HOURS.map((hour) => (
                  <div key={hour} className="border-b border-border/60" style={{ height: HOUR_HEIGHT }} />
                ))}
                {isToday ? (
                  <div
                    data-calendar-now=""
                    className="absolute inset-x-0 z-[5] h-0.5 bg-primary"
                    style={{ top: offsetOfMinute(minuteOfDay(now)) - 1 }}
                  >
                    <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-primary" />
                  </div>
                ) : null}
              </div>

              <ol
                className="relative m-0 list-none p-0"
                style={{
                  marginTop: -bandHeight,
                  paddingTop: ALL_DAY_PADDING,
                  height: bandHeight + GRID_HEIGHT,
                }}
              >
                {loading ? (
                  <li aria-hidden="true" className="absolute inset-x-1" style={{ top: bandHeight + (9 + (Number(day.slice(-1)) % 4)) * HOUR_HEIGHT }}>
                    <EventChipSkeleton className="h-10" />
                  </li>
                ) : (
                  <>
                    {allDay.map((entry, index) => (
                      <li
                        key={entry.id}
                        className="sticky z-20 px-0.5"
                        style={{
                          top: HEAD_HEIGHT + ALL_DAY_PADDING + index * ALL_DAY_LINE,
                          height: ALL_DAY_LINE,
                        }}
                      >
                        <EventChip entry={entry} variant="compact" />
                      </li>
                    ))}
                    {timed.map((placed) => (
                      <li
                        key={placed.entry.id}
                        className="absolute p-px"
                        style={{
                          top: bandHeight + placed.top,
                          height: placed.height,
                          left: `${(placed.lane / placed.lanes) * 100}%`,
                          width: `${100 / placed.lanes}%`,
                        }}
                      >
                        <EventChip
                          entry={placed.entry}
                          variant={placed.height < ONE_LINE_BELOW ? 'compact' : 'block'}
                          continues={placed.continues}
                          nameFirst
                          className="h-full"
                        />
                      </li>
                    ))}
                  </>
                )}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
