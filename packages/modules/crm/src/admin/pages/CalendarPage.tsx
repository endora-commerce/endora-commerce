import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CalendarEventsResponse, CalendarScope } from '@endora-commerce/contracts';
import { Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmCalendarApi } from '../calendar-api.js';
import { EventCalendar, effectiveView } from '../components/calendar/EventCalendar.js';
import { SegmentedRadio } from '../components/SegmentedRadio.js';
import {
  readCalendarAddress,
  writeCalendarAddress,
  type CalendarAddress,
} from '../lib/calendar/calendar-address.js';
import {
  CALENDAR_VIEWS,
  dayKeyOf,
  rangeCovers,
  requestRange,
  visibleRange,
  type CalendarEntry,
  type DayRange,
} from '../lib/calendar/date-math.js';
import { useNarrowScreen } from '../lib/use-narrow-screen.js';

/** *Mine* first: it is the narrower one, and the only one a Sales Rep has. */
const SCOPE_ORDER: readonly CalendarScope[] = ['mine', 'all'];

/** One answer of the server, and what was asked to get it. */
interface LoadedRange {
  /** The days it covers — the days drawn when it was asked, without the widening. */
  range: DayRange;
  /** The scope the address asked for; `null` = the caller's default. */
  asked: CalendarScope | null;
  response: CalendarEventsResponse;
}

/**
 * The CRM Calendar (`specs/143-crm-sales-opportunities/`, User Story 22;
 * FR-142 – FR-151; `contracts/admin-surfaces.md` §1b): the Events of every
 * active Opportunity the reader may see, across Opportunities.
 *
 * **The address is the state.** The view, the date and *Mine / All* are read
 * from `?view=&date=&scope=` and written back with `replace`, so a reload and a
 * shared link show the same thing and Back leaves the Calendar instead of
 * replaying every step through it.
 *
 * **One read per range, and none when the range is already here.** A month's
 * answer holds its weeks and its days, so switching to *Week* or *Day* inside
 * it — or pressing "+N more" — asks the server nothing. A truncated answer is
 * the exception: a narrower range may be complete where the wider one was cut,
 * so it is asked again.
 *
 * **Who sees what is the server's**: the *Mine / All* switch is drawn from
 * `meta.scopes` — absent when there is one — and shows the scope the server
 * *applied*, whatever the address asked.
 *
 * The page holds no write: an Event is added on its Opportunity (research
 * N-CAL9, OQ-7), and every entry is a link there.
 */
export function CalendarPage(): ReactNode {
  const t = useTranslation('crm');
  const [searchParams, setSearchParams] = useSearchParams();
  const narrow = useNarrowScreen();
  const today = dayKeyOf(new Date());
  const address = readCalendarAddress(searchParams, today);
  const view = effectiveView(address.view, narrow);
  const needed = visibleRange(view, address.date);

  const [loaded, setLoaded] = useState<LoadedRange | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const loadedRef = useRef<LoadedRange | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    // Whatever is in flight was asked for a range that is no longer shown.
    const current = ++sequence.current;
    const have = loadedRef.current;
    if (
      have !== null &&
      have.asked === address.scope &&
      !have.response.meta.truncated &&
      rangeCovers(have.range, { from: needed.from, to: needed.to })
    ) {
      setState('ready');
      return;
    }
    setState('loading');
    const range = { from: needed.from, to: needed.to };
    crmCalendarApi
      .calendarEvents({ ...requestRange(range), scope: address.scope })
      .then((response) => {
        if (current !== sequence.current) return;
        const next = { range, asked: address.scope, response };
        loadedRef.current = next;
        setLoaded(next);
        setState('ready');
      })
      .catch(() => {
        if (current !== sequence.current) return;
        // What was loaded is for another range or scope: it is not shown as this one.
        loadedRef.current = null;
        setState('error');
      });
  }, [needed.from, needed.to, address.scope, attempt]);

  const navigate = useCallback(
    (next: Partial<CalendarAddress>): void => {
      setSearchParams(
        (previous) => {
          const now = dayKeyOf(new Date());
          return writeCalendarAddress(previous, { ...readCalendarAddress(previous, now), ...next }, now);
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const meta = loaded?.response.meta ?? null;
  const appliedScope = meta?.scope ?? null;
  const entries = useMemo<CalendarEntry[]>(
    () =>
      (loaded?.response.data ?? []).map((event) => ({
        id: event.id,
        name: event.name,
        allDay: event.allDay,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDayDate: event.allDayDate,
        href: `/crm/opportunities/${event.opportunity.id}?tab=events&event=${event.id}`,
        // Under *All* an entry is somebody's: say whose. Under *Mine* it is the reader's.
        context: [
          event.opportunity.number,
          event.opportunity.title,
          ...(appliedScope === 'all' && event.opportunity.assignee ? [event.opportunity.assignee.name] : []),
        ].join(' · '),
        hasReminder: event.hasReminder,
      })),
    [loaded, appliedScope],
  );

  const scopes = SCOPE_ORDER.filter((scope) => meta?.scopes.includes(scope));
  // While a choice is being fetched the switch already shows it; once answered, what the server applied.
  const shownScope = state === 'loading' && address.scope !== null ? address.scope : appliedScope;

  return (
    <>
      <PageHeader title={t('calendar.title')} description={t('calendar.description')} />
      <Card className="min-w-0">
        <CardContent className="pt-6">
          <EventCalendar
            events={state === 'ready' ? entries : []}
            view={address.view}
            date={address.date}
            views={CALENDAR_VIEWS}
            onNavigate={(nextView, nextDate): void => navigate({ view: nextView, date: nextDate })}
            state={state}
            onRetry={(): void => setAttempt((previous) => previous + 1)}
            truncated={meta?.truncated ?? false}
            toolbarExtra={
              scopes.length > 1 && shownScope !== null ? (
                <SegmentedRadio
                  label={t('calendar.scope.label')}
                  name="crm-calendar-scope"
                  value={shownScope}
                  options={scopes.map((scope) => ({ value: scope, label: t(`calendar.scope.${scope}`) }))}
                  onChange={(scope): void => navigate({ scope })}
                />
              ) : null
            }
          />
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default CalendarPage;
