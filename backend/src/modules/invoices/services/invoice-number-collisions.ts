import type {
  NumberPatternCollision,
  NumberPatternSequenceDefect,
  NumberingSeries,
} from '@endora-commerce/contracts';
import { channelDiscriminator, formatInvoiceNumber } from './invoice-number-generator.js';

/**
 * The collision predicate — feature 078, D-95.1.
 *
 * Two numbering series collide when the **sets of strings they can render**
 * intersect. Not when their pattern strings are equal: `FV {seq}/{YYYY}` and
 * `FV {seq:2}/{YYYY}` are different strings that render identically for every
 * sequence with two or more digits, and one pattern shared by two channels does
 * *not* collide once it carries `{channel}`. The predicate is over
 * `(pattern, channel)` pairs, never over a pattern alone.
 *
 * **Sound and incomplete, by construction.** Sound: every grid point is a
 * `(seq, date)` an issuance can actually reach — `issuedAt` is `new Date()`, so
 * no past year is probed — and therefore every collision reported here will
 * really happen. Incomplete: a pair that collides only above the largest probed
 * sequence, or beyond the year horizon, is not reported. That is deliberate and
 * it is why issuance carries the guarantee: this predicate decides what is
 * *refused* at a configuration write, where a false positive would block
 * legitimate work; the unique index plus `INVOICE_NUMBER_ALREADY_ISSUED` is
 * what makes the platform-wide uniqueness *hold*.
 *
 * Pure: no I/O, no settings read, no clock beyond the current year.
 */

/** A grid point, applied consistently to one render. */
interface ProbePoint {
  readonly seq: number;
  readonly date: Date;
}

/** How far past the current year the sweep looks. */
const YEAR_HORIZON = 10;
/** How far a literal 4-digit year in a pattern may reach and still be probed. */
const LITERAL_YEAR_HORIZON = 100;

/** `{seq}` or `{seq:N}` — the tokens that make a pattern able to number a series. */
const SEQUENCE_TOKEN_RE = /\{seq(?::\d+)?\}/;
/** Every `{seq:N}` width named by a pattern. */
const PADDING_TOKEN_RE = /\{seq:(\d+)\}/g;
/** Literal digit runs, i.e. digits that are not part of a token. */
const TOKEN_RE = /\{(?:seq(?::\d+)?|channel|YYYY|YY|MM)\}/g;

/**
 * `null` when the pattern can produce a distinct number per document.
 *
 * A pattern with no sequence token renders one string for a whole year, so it
 * collides with **itself** on the second document — a self-collision the
 * pairwise sweep would never look for, and a one-condition check.
 */
export function patternSequenceDefect(pattern: string): NumberPatternSequenceDefect | null {
  return SEQUENCE_TOKEN_RE.test(pattern) ? null : 'no_sequence_token';
}

/** The digit runs a pattern contains as literal text, tokens removed first. */
function literalDigitRuns(pattern: string): string[] {
  return pattern.replace(TOKEN_RE, ' ').match(/\d+/g) ?? [];
}

/**
 * The sequence numbers probed, derived from the compared patterns and channels.
 *
 * `1…20` is where every first-year collision lives. The padding points are
 * where `{seq}` and `{seq:N}` converge. The digit-width sweep is what finds the
 * boundary loss in `FV {channel}{seq}` — `A1` + `2` and `A` + `12` are both
 * `A12` — so it reaches one digit further than the longest compared code.
 */
function sequencePoints(series: readonly NumberingSeries[]): number[] {
  const points = new Set<number>();
  for (let seq = 1; seq <= 20; seq += 1) points.add(seq);

  for (const one of series) {
    for (const match of one.pattern.matchAll(PADDING_TOKEN_RE)) {
      const width = Number(match[1]);
      if (!Number.isFinite(width) || width < 1 || width > 9) continue;
      points.add(10 ** (width - 1) - 1);
      points.add(10 ** (width - 1));
      points.add(10 ** width - 1);
      points.add(10 ** width);
    }
  }

  const longestCode = series.reduce((longest, one) => Math.max(longest, one.salesChannelCode.length), 0);
  const widths = 1 + Math.max(6, longestCode);
  for (let k = 1; k <= widths; k += 1) {
    points.add(10 ** (k - 1));
    points.add(10 ** k - 1);
  }
  return [...points].filter((seq) => seq >= 1).sort((a, b) => a - b);
}

/**
 * The years probed.
 *
 * Never a year before the current one: `issuedAt` is `new Date()` at issuance,
 * so a past year is unreachable and probing one would refuse a configuration
 * that cannot collide. The literal-derived years are the plausible operator
 * mistake — `FV {seq}/2026` typed instead of `FV {seq}/{YYYY}`.
 */
function yearPoints(series: readonly NumberingSeries[], currentYear: number): number[] {
  const points = new Set<number>();
  for (let year = currentYear; year <= currentYear + YEAR_HORIZON; year += 1) points.add(year);

  for (const one of series) {
    for (const run of literalDigitRuns(one.pattern)) {
      if (run.length === 4) {
        const year = Number(run);
        if (year >= currentYear && year <= currentYear + LITERAL_YEAR_HORIZON) points.add(year);
      } else if (run.length === 2) {
        const twoDigit = Number(run);
        // The first year at or after the current one whose `YY` equals the run.
        const candidate = Math.floor(currentYear / 100) * 100 + twoDigit;
        points.add(candidate >= currentYear ? candidate : candidate + 100);
      }
    }
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * The grid, restricted to the dimensions this pattern actually uses.
 *
 * A pattern without `{MM}` renders the same string for all twelve months, so
 * probing twelve of them is twelve times the work for one `Set` member. The
 * restriction changes no result — it only skips renders whose output is already
 * in the set — and it is what keeps a 50-series sweep inside its budget.
 */
function probePoints(
  pattern: string,
  seqs: readonly number[],
  years: readonly number[],
): ProbePoint[] {
  const usesMonth = pattern.includes('{MM}');
  const usesYear = pattern.includes('{YYYY}') || pattern.includes('{YY}');
  const usesSeq = SEQUENCE_TOKEN_RE.test(pattern);

  const seqPoints = usesSeq ? seqs : [1];
  const yearPointsUsed = usesYear ? years : [years[0] ?? new Date().getFullYear()];
  const monthPoints = usesMonth ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1];

  const points: ProbePoint[] = [];
  for (const seq of seqPoints) {
    for (const year of yearPointsUsed) {
      for (const month of monthPoints) {
        // Local time: `formatInvoiceNumber` reads `getFullYear`/`getMonth`.
        points.push({ seq, date: new Date(year, month - 1, 15, 12) });
      }
    }
  }
  return points;
}

/** Every string a series can render over the grid. */
function renderSet(
  one: NumberingSeries,
  seqs: readonly number[],
  years: readonly number[],
): Set<string> {
  const channel = channelDiscriminator(one.salesChannelCode);
  const rendered = new Set<string>();
  for (const point of probePoints(one.pattern, seqs, years)) {
    rendered.add(formatInvoiceNumber(one.pattern, { seq: point.seq, date: point.date, channel }));
  }
  return rendered;
}

/**
 * Every pair in `series` that can render one and the same string.
 *
 * Each series is rendered once (`n × |grid|`) and the pairwise sweep intersects
 * the prepared sets, so the cost is never `n² × |grid|` renders.
 */
export function findNumberPatternCollisions(
  series: readonly NumberingSeries[],
): NumberPatternCollision[] {
  if (series.length < 2) return [];
  const currentYear = new Date().getFullYear();
  const seqs = sequencePoints(series);
  const years = yearPoints(series, currentYear);
  const sets = series.map((one) => renderSet(one, seqs, years));

  const collisions: NumberPatternCollision[] = [];
  for (let i = 0; i < series.length; i += 1) {
    for (let j = i + 1; j < series.length; j += 1) {
      const left = sets[i]!;
      const right = sets[j]!;
      const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
      let example: string | null = null;
      for (const candidate of smaller) {
        if (larger.has(candidate)) {
          example = candidate;
          break;
        }
      }
      if (example !== null) {
        collisions.push({ a: series[i]!, b: series[j]!, example });
      }
    }
  }
  return collisions;
}
