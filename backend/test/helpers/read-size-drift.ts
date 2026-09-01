import { readSizeBounds, type RecordedReadSize } from './check-read-sizes.js';

/**
 * The drift report — what the read-size sweep already knows and used to throw
 * away (`specs/095-read-size-drift-report/`).
 *
 * `test/unit/scripts/check-read-size.test.ts` spawns every static check, parses
 * the `read:` line each one prints, and holds the numbers to the band recorded
 * in `check-read-sizes.ts`. Inside the band it discards them. That is the whole
 * defect: the run that failed to notice batch 11 moving `check:admin-surface`
 * by 41 sites **had the number 2367 in memory**, compared it against the
 * recorded 2408, found it in band, and dropped it.
 *
 * Three recorded values went wrong in ten days, two of them silently, and each
 * was found by a later merge request rather than by the one that caused it. The
 * prescriptions in force ("re-record in the merge request that moved it", "read
 * it off the merged tree") both presuppose the author knows *which* entries
 * their change moved — and that mapping is the computation each check performs.
 * No checklist can enlarge it; the run that already did the computation can
 * simply say so.
 *
 * This module is the saying. It is **pure**: no I/O, no `console`, no spawn. It
 * returns lines and the caller prints them, which is what makes every shape it
 * claims to report provable from a fixture rather than from a 35-process sweep.
 *
 * The grammar, the ordering, the percentage arithmetic, the header census and
 * the `not measured` line are normative in
 * `specs/095-read-size-drift-report/contracts/drift-report-line.md`.
 *
 * It changes nothing. No recorded number, no band edge, no assertion — the
 * report is additive, and a reader who finds it noisy is answered with a change
 * to what it prints, never with a suppression.
 */

/**
 * What the sweep observed for one recorded entry.
 *
 * `measured: false` is the entry the run could not measure at all — a child the
 * kernel killed, a check that printed no read line, or an entry the sweep never
 * reached because its hook timed out. It is never silently counted as agreeing:
 * that is issue #113 applied to the report, and an entry nothing could measure
 * must not read the same as one that was measured and agreed.
 */
export interface DriftObservation {
  /** Files the check reported opening, or `null` when nothing was parsed. */
  readonly files: number | null;
  /** Sites it reported examining, or `null` when it printed none. */
  readonly sites: number | null;
  /** False when the run produced no read line for this entry at all. */
  readonly measured: boolean;
}

/**
 * The literal every line carries, so `grep` on it in a CI log returns the whole
 * report and nothing else.
 */
export const DRIFT_PREFIX = '[read-size drift]';

const RE_RECORD =
  're-record these in backend/test/helpers/check-read-sizes.ts, ' +
  'in this merge request, and say what moved them';

type DimensionName = 'sites' | 'files';

interface Drift {
  readonly name: DimensionName;
  readonly recorded: number;
  readonly observed: number;
  /** `floor` for a fall, `ceiling` for a rise. */
  readonly edge: 'floor' | 'ceiling';
  /** How much of the distance to that edge the observed value has consumed. */
  readonly percent: number;
}

interface Entry {
  readonly script: string;
  readonly measured: boolean;
  /** Empty when the entry agrees, or when it was not measured. */
  readonly drifts: readonly Drift[];
}

/**
 * How much of the slack a move has consumed, as a whole percent.
 *
 * A delta means nothing without the width it sits in: −41 is 17% of
 * `check-admin-surface`'s floor and would be 300% of a small entry's. The
 * percentage is the only figure that makes two entries comparable, and it is
 * what tells a reader that this entry has spent a sixth of its slack in one
 * merge request.
 *
 * Reported as-is above 100 rather than clamped — an entry past its edge is
 * failing its band assertion and the number says by how far.
 */
function consumed(recorded: number, observed: number): { edge: 'floor' | 'ceiling'; percent: number } {
  const bounds = readSizeBounds(recorded);
  const falling = observed < recorded;
  const distance = falling ? recorded - bounds.min : bounds.max - recorded;
  // `readSizeBounds` gives every positive record at least
  // `READ_SIZE_SLACK` units in each direction, so this only guards the
  // degenerate record of 0, which nothing can fall below.
  const fraction = distance <= 0 ? 0 : Math.abs(observed - recorded) / distance;
  return {
    edge: falling ? 'floor' : 'ceiling',
    percent: Math.max(0, Math.round(fraction * 100)),
  };
}

function driftOf(name: DimensionName, recorded: number, observed: number): Drift | null {
  if (recorded === observed) return null;
  return { name, recorded, observed, ...consumed(recorded, observed) };
}

function classify(script: string, recorded: RecordedReadSize, seen: DriftObservation | undefined): Entry {
  // An entry with no observation at all is the partial-map case: the sweep's
  // hook timed out before it reached this one.
  if (seen === undefined || !seen.measured || seen.files === null) {
    return { script, measured: false, drifts: [] };
  }
  // A recorded dimension with no observed counterpart was not measured *as
  // recorded*. Counting it as agreeing on the other dimension alone is exactly
  // the silence FR-004 refuses; the sweep's own assertion fails for it too.
  if (recorded.sites !== null && seen.sites === null) {
    return { script, measured: false, drifts: [] };
  }
  const drifts: Drift[] = [];
  // `sites` first: it is the finer population, and the one issues #235 and #237
  // moved while the file count stood still.
  if (recorded.sites !== null && seen.sites !== null) {
    const sites = driftOf('sites', recorded.sites, seen.sites);
    if (sites !== null) drifts.push(sites);
  }
  const files = driftOf('files', recorded.files, seen.files);
  if (files !== null) drifts.push(files);
  return { script, measured: true, drifts };
}

/**
 * Falls first, because the floor is the defect direction; then rises; then the
 * entries nothing could measure. Within each, the largest consumed percentage
 * first, ties broken on the script key so the block is deterministic and
 * diffable between pipelines.
 *
 * A not-measured entry has no dimension and therefore falls under neither of
 * the contract's two ordering rules, so it sorts after both — the header has
 * already counted it, and the sweep's own assertions are what fail for it.
 */
function rank(entry: Entry): number {
  if (!entry.measured) return 2;
  return entry.drifts.some((drift) => drift.edge === 'floor') ? 0 : 1;
}

function worst(entry: Entry): number {
  return entry.drifts.reduce((most, drift) => Math.max(most, drift.percent), 0);
}

function renderDrift(drift: Drift): string {
  const delta = drift.observed - drift.recorded;
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return (
    `${drift.name} ${drift.recorded} -> ${drift.observed} ` +
    `(${signed}, ${drift.percent}% to ${drift.edge})`
  );
}

/**
 * The report, as lines. The caller prints them; this returns them.
 *
 * The population is `RECORDED_READ_SIZES` itself — no entry declares itself
 * volatile, derived or interesting, and the thirty-sixth entry is covered by
 * existing (D-100).
 */
export function formatDriftReport(
  recorded: Readonly<Record<string, RecordedReadSize>>,
  observed: ReadonlyMap<string, DriftObservation>,
): readonly string[] {
  const entries = Object.entries(recorded).map(([script, size]) =>
    classify(script, size, observed.get(script)),
  );

  const drifted = entries.filter((entry) => entry.measured && entry.drifts.length > 0);
  const unmeasured = entries.filter((entry) => !entry.measured);
  const agreeing = entries.length - drifted.length - unmeasured.length;

  // Printed unconditionally, `0 drifted` included. A report that says nothing
  // when nothing drifted is indistinguishable from a report that did not run,
  // which is issue #244's own defect arriving inside the instrument built to
  // answer #244. The four counts sum to the record, so the header is also the
  // statement that the sweep covered it.
  const header =
    `${DRIFT_PREFIX} ${drifted.length} drifted, ${agreeing} agree, ` +
    `${unmeasured.length} not measured, of ${entries.length} recorded`;

  const printed = [...drifted, ...unmeasured].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    const byPercent = worst(right) - worst(left);
    if (byPercent !== 0) return byPercent;
    return left.script < right.script ? -1 : left.script > right.script ? 1 : 0;
  });

  if (printed.length === 0) return [header];

  // The identity is the record's own key — the script path — and not the
  // check's printed prefix: the reader's next action is to edit that entry, and
  // the key is what they search for.
  const column = Math.max(...printed.map((entry) => entry.script.length)) + 1;
  const lines = printed.map((entry) => {
    const body = entry.measured
      ? entry.drifts.map(renderDrift).join('  ')
      : 'not measured (no read line)';
    return `${DRIFT_PREFIX} ${entry.script.padEnd(column)}${body}`;
  });

  // Only when something drifted. It names the file and the merge request, and
  // it asks for the sentence because the sentence is the part no instrument can
  // produce and the part every future reader depends on.
  return drifted.length > 0
    ? [header, ...lines, `${DRIFT_PREFIX} ${RE_RECORD}`]
    : [header, ...lines];
}
