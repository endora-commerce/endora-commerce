import {
  compareEntries,
  dayKeyOf,
  minuteOfDay,
  type CalendarEntry,
} from './date-math.js';

/**
 * The calendar's geometry
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1b): where
 * a timed entry sits in a day column, how overlapping entries share the
 * column's width, and what a month cell shows before it says "+N more".
 *
 * Pure: numbers in, numbers out. The views turn them into CSS.
 */

/** One hour of the time grid, in pixels. */
export const HOUR_HEIGHT = 48;

/** The least an entry is tall, so a 15-minute Event still shows its name. */
export const MIN_ENTRY_HEIGHT = 24;

/** How many entries a month cell shows before it counts the rest. */
export const MONTH_CELL_LIMIT = 3;

const MINUTES_PER_DAY = 24 * 60;

/** Pixels from the top of the grid for a minute of the day. */
export function offsetOfMinute(minute: number): number {
  return (minute / 60) * HOUR_HEIGHT;
}

/** A timed entry as the wall clock of its start day sees it. */
export interface TimedSpan {
  startMinute: number;
  /** Cut at 24:00 when the entry runs past local midnight. */
  endMinute: number;
  /** The entry goes on after the midnight it was cut at. */
  continues: boolean;
}

/**
 * The span of a timed entry on the local day it starts on.
 *
 * An Event is one calendar day **in its own zone**; a reader elsewhere can have
 * it run over their midnight. It is drawn on the day it starts for them and cut
 * at the bottom of that day — never drawn twice.
 */
export function timedSpan(entry: Pick<CalendarEntry, 'startsAt' | 'endsAt'>): TimedSpan {
  const start = new Date(entry.startsAt);
  const end = new Date(entry.endsAt);
  const startMinute = minuteOfDay(start);
  if (dayKeyOf(end) !== dayKeyOf(start)) {
    // An end at exactly the next midnight is the day's own last moment, not a continuation.
    const continues = minuteOfDay(end) > 0 || end.getTime() - start.getTime() > 25 * 3_600_000;
    return { startMinute, endMinute: MINUTES_PER_DAY, continues };
  }
  // The hour a clock goes back happens twice: never shorter than its start.
  return { startMinute, endMinute: Math.max(minuteOfDay(end), startMinute), continues: false };
}

export interface PositionedEntry<T> {
  entry: T;
  /** Pixels from the top of the time grid. */
  top: number;
  height: number;
  /** Which of the cluster's lanes the entry is in, from 0. */
  lane: number;
  /** How many lanes its cluster has: the entry is `1 / lanes` of the column wide. */
  lanes: number;
  continues: boolean;
}

/**
 * One day's timed entries, placed.
 *
 * Greedy column packing over the entries sorted by start: each goes into the
 * first lane that is free at its start, and a cluster — a run of entries each
 * overlapping some earlier one — is as wide as the number of lanes it needed.
 * "Free" is judged by the **drawn** box, minimum height included, so two short
 * entries a quarter of an hour apart do not print over each other.
 *
 * The answer is in reading order (by start), which is the order the day's list
 * is written in.
 */
export function layoutDay<T extends CalendarEntry>(entries: readonly T[]): PositionedEntry<T>[] {
  const timed = entries.filter((entry) => !entry.allDay).sort(compareEntries);
  const placed: PositionedEntry<T>[] = [];
  let cluster: PositionedEntry<T>[] = [];
  let laneBottoms: number[] = [];
  let clusterBottom = -1;

  const close = (): void => {
    for (const item of cluster) item.lanes = laneBottoms.length;
    cluster = [];
    laneBottoms = [];
    clusterBottom = -1;
  };

  for (const entry of timed) {
    const span = timedSpan(entry);
    const top = offsetOfMinute(span.startMinute);
    const height = Math.max(offsetOfMinute(span.endMinute) - top, MIN_ENTRY_HEIGHT);
    const bottom = top + height;
    if (cluster.length > 0 && top >= clusterBottom) close();
    let lane = laneBottoms.findIndex((laneBottom) => laneBottom <= top);
    if (lane === -1) lane = laneBottoms.length;
    laneBottoms[lane] = bottom;
    clusterBottom = Math.max(clusterBottom, bottom);
    const item: PositionedEntry<T> = { entry, top, height, lane, lanes: 1, continues: span.continues };
    cluster.push(item);
    placed.push(item);
  }
  close();
  return placed;
}

/** What a month cell shows: the first few in reading order, and how many it leaves out. */
export function monthCell<T extends CalendarEntry>(
  entries: readonly T[],
  limit: number = MONTH_CELL_LIMIT,
): { shown: T[]; more: number } {
  const ordered = [...entries].sort(compareEntries);
  return { shown: ordered.slice(0, limit), more: Math.max(0, ordered.length - limit) };
}
