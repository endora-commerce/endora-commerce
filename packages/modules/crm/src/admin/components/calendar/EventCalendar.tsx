import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { CALENDAR_EVENTS_MAX_RESULTS } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  dayKeyOf,
  entriesByDay,
  entriesInRange,
  isDayKey,
  rangeTitle,
  shiftDate,
  visibleRange,
  weekDays,
  type CalendarEntry,
  type CalendarView,
  type DayKey,
} from '../../lib/calendar/date-math.js';
import { timeZoneLabel } from '../../lib/calendar/format.js';
import { useNarrowScreen } from '../../lib/use-narrow-screen.js';
import { SegmentedRadio } from '../SegmentedRadio.js';
import { AgendaView } from './AgendaView.js';
import { MonthView } from './MonthView.js';
import { WeekView } from './WeekView.js';

/**
 * The view a width draws. Under 640 px the calendar **is** the agenda,
 * whatever was asked (FR-150): seven columns at 390 px are 50 px of clipped
 * text and a sideways scroll, and a list of days is what every phone calendar
 * shows (Jakob's Law). The asked view is kept — in the address, in the state —
 * so the same link opens as a month again on a wide screen.
 */
export function effectiveView(view: CalendarView, narrow: boolean): CalendarView {
  return narrow ? 'agenda' : view;
}

/** The current time, re-read every half minute — for today's mark and the current-time line. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return (): void => window.clearInterval(timer);
  }, []);
  return now;
}

/** How long the date field waits after the last change before it navigates. */
const GO_TO_DATE_DELAY_MS = 300;

/** The years the date field navigates to: a year being typed passes through 0002 and 0202 on its way to 2026. */
function isPlausibleDay(value: string): value is DayKey {
  return isDayKey(value) && value >= '1970-01-01' && value <= '2199-12-31';
}

/**
 * *Go to date*: a native date field with a visible label (Jakob's Law — the
 * platform's own picker, on a phone as on a desktop).
 *
 * A native field reports a change on **every keystroke** once its three parts
 * are filled, so a date being typed is a run of other dates. The field keeps
 * its own draft and navigates once the typing has paused — one move and at
 * most one read, instead of a calendar that jumps under the fingers.
 */
function GoToDate(props: { id: string; label: string; date: DayKey; onGo: (date: DayKey) => void }): ReactNode {
  const { id, label, date, onGo } = props;
  const [draft, setDraft] = useState<string>(date);
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;

  // The calendar moved by other means: the field follows.
  useEffect(() => setDraft(date), [date]);

  useEffect(() => {
    if (draft === date || !isPlausibleDay(draft)) return undefined;
    const timer = window.setTimeout(() => onGoRef.current(draft), GO_TO_DATE_DELAY_MS);
    return (): void => window.clearTimeout(timer);
  }, [draft, date]);

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        className="h-11 w-auto sm:h-9"
        value={draft}
        onChange={(event): void => setDraft(event.target.value)}
        // An emptied or half-typed field left behind shows where the calendar is.
        onBlur={(): void => {
          if (!isPlausibleDay(draft)) setDraft(date);
        }}
      />
    </div>
  );
}

export interface EventCalendarProps {
  events: readonly CalendarEntry[];
  /** Controlled: the parent owns the address (the page) or the state (the tab). */
  view: CalendarView;
  /** The anchor day, controlled. */
  date: DayKey;
  /** Which views the switch offers, in the order drawn. */
  views: readonly CalendarView[];
  onNavigate: (view: CalendarView, date: DayKey) => void;
  state: 'loading' | 'ready' | 'error';
  onRetry: () => void;
  /** The server cut the answer: the range holds more than it returned. */
  truncated?: boolean;
  /** Controls the parent adds to the toolbar — the page's *Mine / All*. */
  toolbarExtra?: ReactNode;
  /** The level of the range title; a day is one under it. */
  titleHeading?: 'h2' | 'h3';
}

/**
 * The calendar (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md`
 * §1b; FR-146 – FR-150), used twice: by the Calendar page with every Event the
 * caller may see, and by an Opportunity's Events tab with its own.
 *
 * **It is given its Events and draws them** — it fetches nothing and knows no
 * route. The date arithmetic is `lib/calendar/date-math.ts` and the geometry
 * `lib/calendar/layout.ts`; this file is the toolbar, the four states in
 * words, and the choice of view.
 *
 * Keyboard: Tab walks the toolbar and then the entries in the order of the
 * document, which in every view is the order of time. Each day is a heading.
 * A "Skip the calendar" link stands before the first entry.
 */
export function EventCalendar(props: EventCalendarProps): ReactNode {
  const { events, date, views, onNavigate, state, onRetry, truncated = false, toolbarExtra } = props;
  const TitleHeading = props.titleHeading ?? 'h2';
  const dayHeading = TitleHeading === 'h2' ? 'h3' : 'h4';
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const narrow = useNarrowScreen();
  const now = useNow();
  const today = dayKeyOf(now);
  const titleId = useId();
  const groupName = useId();
  const endRef = useRef<HTMLDivElement>(null);

  const view = effectiveView(props.view, narrow);
  const { from, to } = visibleRange(view, date);
  const byDay = useMemo(() => entriesByDay(events), [events]);
  const shown = useMemo(() => entriesInRange(byDay, { from, to }), [byDay, from, to]);
  const loading = state === 'loading';
  const empty = state === 'ready' && shown.length === 0;
  const title = rangeTitle(view, date, language);

  // What the live region says. It is mounted before it has anything to say.
  const status = loading
    ? t('calendar.loading')
    : [
        ...(empty ? [t('calendar.empty')] : []),
        ...(truncated && state === 'ready'
          ? [t('calendar.truncated', { count: CALENDAR_EVENTS_MAX_RESULTS })]
          : []),
      ].join(' ');

  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3">
      <div
        role="toolbar"
        aria-label={t('calendar.toolbar')}
        className="flex flex-wrap items-center gap-x-2 gap-y-3"
      >
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={(): void => onNavigate(props.view, today)}
        >
          {t('calendar.today')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
          aria-label={t(`calendar.previous.${view}`)}
          onClick={(): void => onNavigate(props.view, shiftDate(view, date, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
          aria-label={t(`calendar.next.${view}`)}
          onClick={(): void => onNavigate(props.view, shiftDate(view, date, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        {/* Polite: moving announces the range that is now shown. */}
        <TitleHeading
          id={titleId}
          aria-live="polite"
          className="m-0 mr-auto min-w-0 text-lg font-semibold [overflow-wrap:anywhere] first-letter:uppercase"
        >
          {title}
        </TitleHeading>
        <GoToDate
          id={`${groupName}-goto`}
          label={t('calendar.goToDate')}
          date={date}
          onGo={(next): void => onNavigate(props.view, next)}
        />
        {!narrow && views.length > 1 ? (
          <SegmentedRadio
            label={t('calendar.viewSwitch')}
            name={`${groupName}-view`}
            value={props.view}
            options={views.map((option) => ({ value: option, label: t(`calendar.view.${option}`) }))}
            onChange={(next): void => onNavigate(next, date)}
          />
        ) : null}
        {toolbarExtra}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('calendar.timeZone', { zone: timeZoneLabel(language, now) })}
      </p>

      {state === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('calendar.error')}</span>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={onRetry}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        role="status"
        className={
          status
            ? 'flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground'
            : 'sr-only'
        }
      >
        {status ? <CalendarDays aria-hidden="true" className="size-4 shrink-0" /> : null}
        <span>{status}</span>
        {empty && date !== today ? (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={(): void => onNavigate(props.view, today)}
          >
            {t('calendar.backToToday')}
          </Button>
        ) : null}
      </div>

      {shown.length > 0 ? (
        <a
          href="#calendar-end"
          className="sr-only rounded-sm focus:not-sr-only focus:inline-block focus:px-2 focus:py-1 focus:text-sm focus:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event): void => {
            event.preventDefault();
            endRef.current?.focus();
          }}
        >
          {t('calendar.skip')}
        </a>
      ) : null}

      <div aria-busy={loading}>
        {view === 'month' ? (
          <MonthView
            date={date}
            today={today}
            byDay={byDay}
            caption={title}
            loading={loading}
            onMore={(day): void => onNavigate(views.includes('day') ? 'day' : 'week', day)}
          />
        ) : view === 'agenda' ? (
          <AgendaView date={date} today={today} byDay={byDay} loading={loading} dayHeading={dayHeading} />
        ) : (
          <WeekView
            days={view === 'day' ? [date] : weekDays(date)}
            today={today}
            now={now}
            byDay={byDay}
            loading={loading}
            dayHeading={dayHeading}
          />
        )}
      </div>

      <div ref={endRef} tabIndex={-1} className="sr-only">
        {t('calendar.end')}
      </div>
    </section>
  );
}
