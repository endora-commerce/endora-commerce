import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell, CalendarDays, CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import type { OpportunityEvent, OpportunityEventReminder } from '@endora-commerce/contracts';
import { cn, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmCalendarApi } from '../../../calendar-api.js';
import { EventCalendar } from '../../../components/calendar/EventCalendar.js';
import { useEntryWhen } from '../../../components/calendar/EventChip.js';
import { EventDialog } from '../../../components/EventDialog.js';
import { ModalDialog } from '../../../components/ModalDialog.js';
import {
  dayKeyOf,
  entryDayKey,
  type CalendarEntry,
  type CalendarView,
  type DayKey,
} from '../../../lib/calendar/date-math.js';
import { dateTimeLabel } from '../../../lib/calendar/format.js';
import { errorMessage } from '../../../lib/labels.js';
import { useNarrowScreen } from '../../../lib/use-narrow-screen.js';
import type { OpportunityTabProps } from '../tabs.js';

/** The query parameter that names the Event a link points at. */
export const EVENT_PARAM = 'event';

/** How many past Events are listed before *Show all*. */
const PAST_SHOWN = 10;

/** The views the tab's calendar offers: one Opportunity has no use for an agenda beside its own list. */
const TAB_VIEWS: readonly CalendarView[] = ['month', 'week'];

const CALENDAR_PATH = '/crm/calendar';

/** Where a press on one of this Opportunity's Events leads: this tab, with the Event marked. */
function eventHref(opportunityId: string, eventId: string): string {
  return `/crm/opportunities/${opportunityId}?tab=events&${EVENT_PARAM}=${eventId}`;
}

/**
 * The *Events* tab of an Opportunity (User Story 21; FR-133, FR-141;
 * `contracts/admin-surfaces.md` §1b): what is planned for the deal and when.
 *
 * Top to bottom: the heading with *Add event* — the tab's one primary action —
 * and a way to the Calendar; the Events as a list, what is still ahead first
 * and soonest first, what is over after it; then the same Events on a calendar
 * of this Opportunity alone. Under 640 px the calendar is not drawn: the list
 * above already is an agenda.
 *
 * **A reader sees everything and changes nothing**: without `crm:write` there
 * is no *Add*, *Edit* or *Delete*. **A closed Opportunity keeps the tab and its
 * editing** and says, quietly, what closing changed: its Events are off the
 * Calendar and its reminders are held.
 *
 * `?event=<id>` — the address a reminder and a calendar entry lead to — marks
 * that Event's row and brings it into view.
 */
export function EventsTab(props: OpportunityTabProps): ReactNode {
  const { opportunity, reload } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const narrow = useNarrowScreen();
  const when = useEntryWhen();
  const [searchParams] = useSearchParams();
  const asked = searchParams.get(EVENT_PARAM);

  const [events, setEvents] = useState<OpportunityEvent[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  /** The moment the list was read: what "upcoming" is judged against. */
  const [readAt, setReadAt] = useState(() => new Date());
  const [dialog, setDialog] = useState<{ event: OpportunityEvent | null } | null>(null);
  const [removing, setRemoving] = useState<OpportunityEvent | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [allPast, setAllPast] = useState(false);
  const [view, setView] = useState<CalendarView>('month');
  const [date, setDate] = useState<DayKey>(() => dayKeyOf(new Date()));
  const sequence = useRef(0);
  const markedRow = useRef<HTMLLIElement>(null);
  const opportunityId = opportunity.id;

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    try {
      const loaded = await crmCalendarApi.listEvents(opportunityId);
      if (current !== sequence.current) return;
      setEvents(loaded);
      setReadAt(new Date());
      setState('ready');
    } catch {
      if (current === sequence.current) setState('error');
    }
  }, [opportunityId]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  /** After a write: the list, and the Opportunity — its tab label counts the Events ahead. */
  const reread = async (): Promise<void> => {
    await Promise.all([load(), reload()]);
  };

  const { upcoming, past } = useMemo(() => {
    const now = readAt.getTime();
    const byStart = (a: OpportunityEvent, b: OpportunityEvent): number =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);
    const all = events ?? [];
    return {
      upcoming: all.filter((event) => Date.parse(event.endsAt) > now).sort(byStart),
      past: all
        .filter((event) => Date.parse(event.endsAt) <= now)
        .sort((a, b) => byStart(b, a)),
    };
  }, [events, readAt]);

  // An id that is not one of this Opportunity's Events marks nothing.
  const marked = asked !== null && (events ?? []).some((event) => event.id === asked) ? asked : null;
  const markedEvent = marked === null ? null : ((events ?? []).find((event) => event.id === marked) ?? null);
  const markedDay = markedEvent ? entryDayKey(markedEvent) : null;
  const markedIsHidden = marked !== null && past.findIndex((event) => event.id === marked) >= PAST_SHOWN;

  // Once per Event pointed at: show its row, and turn the calendar to its day.
  useEffect(() => {
    if (marked === null) return;
    if (markedIsHidden) setAllPast(true);
    if (markedDay) setDate(markedDay);
  }, [marked, markedDay, markedIsHidden]);
  useEffect(() => {
    if (marked !== null && markedRow.current && typeof markedRow.current.scrollIntoView === 'function') {
      markedRow.current.scrollIntoView({ block: 'center' });
    }
  }, [marked, allPast]);

  const entries = useMemo<CalendarEntry[]>(
    () =>
      (events ?? []).map((event) => ({
        id: event.id,
        name: event.name,
        allDay: event.allDay,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDayDate: event.allDayDate,
        href: eventHref(opportunityId, event.id),
        context: null,
        hasReminder: event.reminder !== null,
      })),
    [events, opportunityId],
  );

  /** What became of a reminder, in words (FR-141). */
  const reminderLabel = (reminder: OpportunityEventReminder): string => {
    const channels = new Intl.ListFormat(language, { type: 'conjunction' }).format(
      reminder.channels.map((channel) => t(`events.channel.${channel}`)),
    );
    const at = reminder.state === 'sent' && reminder.handledAt ? reminder.handledAt : reminder.at;
    return t(`events.reminder.${reminder.state}`, {
      at: dateTimeLabel(new Date(at), language),
      channels,
    });
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await crmCalendarApi.deleteEvent(opportunityId, removing.id);
      setAnnouncement(t('events.saved.deleted', { name: removing.name }));
      setRemoving(null);
      await reread();
    } catch (failure) {
      setRemoveError(errorMessage(failure, t('events.remove.error')));
    } finally {
      setRemoveBusy(false);
    }
  };

  const row = (event: OpportunityEvent): ReactNode => {
    const isMarked = event.id === marked;
    return (
      <li
        key={event.id}
        ref={isMarked ? markedRow : undefined}
        aria-current={isMarked ? 'true' : undefined}
        className={cn(
          'rounded-md border border-border p-3',
          isMarked && 'border-primary ring-2 ring-ring ring-offset-1',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs tabular-nums text-muted-foreground">
              <time dateTime={event.allDayDate ?? event.startsAt}>{when(event)}</time>
            </p>
            <h4 className="text-sm font-medium [overflow-wrap:anywhere]">{event.name}</h4>
            {event.description ? (
              <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {event.description}
              </p>
            ) : null}
            {event.reminder ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Bell aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                <span>{reminderLabel(event.reminder)}</span>
              </p>
            ) : null}
          </div>
          {canWrite ? (
            <div className="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-8"
                aria-label={t('events.editNamed', { name: event.name })}
                onClick={(): void => setDialog({ event })}
              >
                <Pencil aria-hidden="true" />
                {tCore('common.action.edit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                // A step away from Edit: the one that cannot be undone is not its
                // neighbour. Quiet until it is pointed at — a red word on every
                // row would outshout the tab's one primary action; the
                // confirmation it opens is where the red is.
                className="ml-3 min-h-11 text-muted-foreground hover:text-destructive focus-visible:text-destructive sm:min-h-8"
                aria-label={t('events.removeNamed', { name: event.name })}
                onClick={(): void => {
                  setRemoveError(null);
                  setRemoving(event);
                }}
              >
                <Trash2 aria-hidden="true" />
                {tCore('common.action.delete')}
              </Button>
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  const closed = opportunity.status.kind !== 'open';
  const shownPast = allPast ? past : past.slice(0, PAST_SHOWN);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('events.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" className="min-h-11 sm:min-h-9">
            <Link to={CALENDAR_PATH}>
              <CalendarDays aria-hidden="true" />
              {t('events.openCalendar')}
            </Link>
          </Button>
          {canWrite ? (
            <Button className="min-h-11 sm:min-h-9" onClick={(): void => setDialog({ event: null })}>
              <CalendarPlus aria-hidden="true" />
              {t('events.add')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Mounted before it has anything to say, so what it says is announced. */}
      <p role="status" className={announcement ? 'text-sm text-muted-foreground' : 'sr-only'}>
        {announcement}
      </p>

      {closed ? (
        <p role="note" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t('events.closedNote')}
        </p>
      ) : null}

      {state === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('events.error.load')}</span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={(): void => {
                setState('loading');
                void load();
              }}
            >
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {events === null && state === 'loading' ? (
        <>
          <p role="status" className="sr-only">
            {t('events.loading')}
          </p>
          <div aria-hidden="true" className="space-y-2">
            <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          </div>
        </>
      ) : null}

      {events !== null && events.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
          <CalendarDays aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{t('events.empty')}</p>
          <p className="text-sm text-muted-foreground">
            {canWrite ? t('events.emptyHint') : t('events.emptyReadOnly')}
          </p>
        </div>
      ) : null}

      {events !== null && events.length > 0 ? (
        <>
          <section aria-labelledby="crm-events-upcoming" className="space-y-2">
            <h3 id="crm-events-upcoming" className="text-sm font-semibold">
              {t('events.upcoming')}
            </h3>
            {upcoming.length > 0 ? (
              <ul className="m-0 list-none space-y-2 p-0">{upcoming.map(row)}</ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('events.upcomingEmpty')}</p>
            )}
          </section>

          {past.length > 0 ? (
            <section aria-labelledby="crm-events-past" className="space-y-2">
              <h3 id="crm-events-past" className="text-sm font-semibold">
                {t('events.past')}
              </h3>
              <ul className="m-0 list-none space-y-2 p-0">{shownPast.map(row)}</ul>
              {past.length > shownPast.length ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-8"
                  onClick={(): void => setAllPast(true)}
                >
                  {t('events.showAllPast', { count: past.length })}
                </Button>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {/* Under 640 px the list above is the agenda; a second one would only repeat it. */}
      {!narrow && events !== null && events.length > 0 ? (
        <div className="border-t border-border pt-6">
          <EventCalendar
            events={entries}
            view={view}
            date={date}
            views={TAB_VIEWS}
            onNavigate={(nextView, nextDate): void => {
              setView(nextView);
              setDate(nextDate);
            }}
            state="ready"
            onRetry={(): void => void load()}
            titleHeading="h3"
          />
        </div>
      ) : null}

      {dialog ? (
        <EventDialog
          opportunityId={opportunityId}
          event={dialog.event}
          onSaved={(saved, mode): void => {
            setAnnouncement(t(`events.saved.${mode}`, { name: saved.name }));
            void reread();
          }}
          onClose={(): void => setDialog(null)}
        />
      ) : null}

      {removing ? (
        <ModalDialog
          title={t('events.remove.title')}
          busy={removeBusy}
          onClose={(): void => setRemoving(null)}
          footer={
            <>
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={removeBusy}
                onClick={(): void => setRemoving(null)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                disabled={removeBusy}
                aria-busy={removeBusy}
                onClick={(): void => void remove()}
              >
                {t('events.remove.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('events.remove.body', { name: removing.name, when: when(removing) })}</p>
          {removeError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}
    </div>
  );
}

export default EventsTab;
