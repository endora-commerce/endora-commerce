import type { ReactNode } from 'react';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  AGENDA_DAYS,
  daysFrom,
  type CalendarEntry,
  type DayKey,
} from '../../lib/calendar/date-math.js';
import { dayHeadingLabel } from '../../lib/calendar/format.js';
import { EventChip, EventChipSkeleton } from './EventChip.js';

export interface AgendaViewProps {
  /** The first day listed. */
  date: DayKey;
  today: DayKey;
  byDay: ReadonlyMap<DayKey, readonly CalendarEntry[]>;
  loading: boolean;
  /** The level of a day's heading: one under the range title's. */
  dayHeading: 'h3' | 'h4';
}

/**
 * The agenda: the days that have entries, thirty days from the anchor, each a
 * heading and a list (FR-147). It is the only view under 640 px, so every row
 * is a 44 px target and nothing in it has a width of its own to scroll.
 */
export function AgendaView(props: AgendaViewProps): ReactNode {
  const { date, today, byDay, loading, dayHeading: DayHeading } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();

  if (loading) {
    return (
      <div aria-hidden="true" className="space-y-4">
        {[0, 1, 2].map((group) => (
          <div key={group} className="space-y-2">
            <EventChipSkeleton className="h-4 w-40" />
            <EventChipSkeleton className="h-11" />
            {group === 0 ? <EventChipSkeleton className="h-11" /> : null}
          </div>
        ))}
      </div>
    );
  }

  const days = daysFrom(date, AGENDA_DAYS).filter((day) => (byDay.get(day)?.length ?? 0) > 0);

  return (
    <div className="space-y-5">
      {days.map((day) => {
        const entries = byDay.get(day) ?? [];
        return (
          <section key={day} aria-labelledby={`crm-agenda-${day}`}>
            <DayHeading id={`crm-agenda-${day}`} className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold">
              <time dateTime={day}>{dayHeadingLabel(day, language)}</time>
              {day === today ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                  {t('calendar.today')}
                </span>
              ) : null}
              <span className="text-xs font-normal text-muted-foreground">
                {t('calendar.day.count', { count: entries.length })}
              </span>
            </DayHeading>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <EventChip entry={entry} variant="row" />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
