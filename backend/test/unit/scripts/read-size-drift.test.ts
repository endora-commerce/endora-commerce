import { describe, expect, it } from 'vitest';

import { formatDriftReport, type DriftObservation } from '../../helpers/read-size-drift.js';
import { readSizeBounds, type RecordedReadSize } from '../../helpers/check-read-sizes.js';

/**
 * Proofs for the drift report's grammar
 * (`specs/095-read-size-drift-report/contracts/drift-report-line.md`).
 *
 * The formatter is pure, so every one of these enters at the **top** of it,
 * with fixture records and fixture observations — never with a value the
 * formatter computes. That is the estate's rule for an instrument that can go
 * red, applied to one that can go quiet: a fixture entering below the
 * judgement cannot catch a judgement that stopped judging.
 *
 * One proof per shape the report claims to print, each asserting the shape
 * rather than a non-empty string.
 */

function record(files: number, sites: number | null): RecordedReadSize {
  return {
    prefix: '[fixture]',
    run: { kind: 'tsx', path: 'scripts/fixture.ts', args: [] },
    files,
    sites,
    sources: [],
  };
}

function seen(files: number, sites: number | null): DriftObservation {
  return { files, sites, measured: true };
}

const UNMEASURED: DriftObservation = { files: null, sites: null, measured: false };

/** The report's lines minus the header and the trailing instruction. */
function entryLines(lines: readonly string[]): readonly string[] {
  return lines.slice(1).filter((line) => !line.includes('re-record these in'));
}

describe('the drift report names what moved', () => {
  it('prints a falling site count against the floor, and no dimension that did not move', () => {
    const lines = formatDriftReport(
      { 'backend/scripts/check-admin-surface.ts': record(358, 2408) },
      new Map([['backend/scripts/check-admin-surface.ts', seen(358, 2367)]]),
    );

    // floor of 2408 is 2167, so 41 of 241 available units — 17%.
    expect(entryLines(lines)).toEqual([
      '[read-size drift] backend/scripts/check-admin-surface.ts sites 2408 -> 2367 (-41, 17% to floor)',
    ]);
    expect(entryLines(lines)[0]).not.toContain('files');
  });

  it('prints a rising file count against the ceiling, with the sign on the delta', () => {
    const lines = formatDriftReport(
      { 'backend/scripts/check-module-boundary.ts': record(3916, null) },
      new Map([['backend/scripts/check-module-boundary.ts', seen(3926, null)]]),
    );

    // ceiling of 3916 is 5874, so 10 of 1958 available units — 1%.
    expect(entryLines(lines)).toEqual([
      '[read-size drift] backend/scripts/check-module-boundary.ts files 3916 -> 3926 (+10, 1% to ceiling)',
    ]);
  });

  it('prints both dimensions on one line, sites first', () => {
    // Batch 11's real shape, on `master` at `67a369c32`: `check-admin-surface`
    // recorded `files: 354 sites: 2408`, walked `files=358 sites=2367`. The
    // file count *rose* while the site count fell, because packaging a
    // directory keeps every file in the walk and collapses its reaches — which
    // is the regression this whole feature exists for, and the reason `sites`
    // is printed first.
    const lines = formatDriftReport(
      { 'backend/scripts/check-admin-surface.ts': record(354, 2408) },
      new Map([['backend/scripts/check-admin-surface.ts', seen(358, 2367)]]),
    );

    expect(entryLines(lines)).toEqual([
      '[read-size drift] backend/scripts/check-admin-surface.ts ' +
        'sites 2408 -> 2367 (-41, 17% to floor)  files 354 -> 358 (+4, 2% to ceiling)',
    ]);
  });

  it('invents no site dimension for an entry recorded without one', () => {
    const lines = formatDriftReport(
      { 'backend/scripts/check-nul-bytes.ts': record(5470, null) },
      new Map([['backend/scripts/check-nul-bytes.ts', seen(5480, null)]]),
    );

    expect(entryLines(lines)[0]).not.toContain('sites');
    expect(entryLines(lines)[0]).not.toContain('-> 0');
  });

  it('prints the census header when nothing drifted', () => {
    const lines = formatDriftReport(
      {
        'backend/scripts/a.ts': record(10, 5),
        'backend/scripts/b.ts': record(20, null),
      },
      new Map([
        ['backend/scripts/a.ts', seen(10, 5)],
        ['backend/scripts/b.ts', seen(20, null)],
      ]),
    );

    expect(lines).toEqual(['[read-size drift] 0 drifted, 2 agree, 0 not measured, of 2 recorded']);
  });

  it('names an entry it could not measure, and does not count it as agreeing', () => {
    const lines = formatDriftReport(
      {
        'backend/scripts/check-port-catches.ts': record(1541, 47),
        'backend/scripts/agrees.ts': record(10, null),
      },
      new Map([
        ['backend/scripts/check-port-catches.ts', UNMEASURED],
        ['backend/scripts/agrees.ts', seen(10, null)],
      ]),
    );

    // The whole block, not just the entry lines: nothing drifted, so there is
    // nothing to re-record and the trailing instruction must not be printed.
    expect(lines).toEqual([
      '[read-size drift] 0 drifted, 1 agree, 1 not measured, of 2 recorded',
      '[read-size drift] backend/scripts/check-port-catches.ts not measured (no read line)',
    ]);
  });

  it('counts an entry missing from the observations as not measured', () => {
    // `beforeAll` timed out part-way: the map is partial, and an entry nothing
    // wrote must read as unmeasured rather than as agreeing (FR-004).
    const lines = formatDriftReport(
      { 'backend/scripts/never-spawned.ts': record(10, null) },
      new Map(),
    );

    expect(lines[0]).toBe('[read-size drift] 0 drifted, 0 agree, 1 not measured, of 1 recorded');
    expect(entryLines(lines)).toEqual([
      '[read-size drift] backend/scripts/never-spawned.ts not measured (no read line)',
    ]);
  });

  it('counts an entry that stopped printing its recorded site count as not measured', () => {
    // The recorded dimension has no observed counterpart, so the entry was not
    // measured *as recorded*. Counting it as agreeing on the file count alone
    // is the silence FR-004 refuses.
    const lines = formatDriftReport(
      { 'backend/scripts/lost-its-sites.ts': record(10, 5) },
      new Map([['backend/scripts/lost-its-sites.ts', seen(10, null)]]),
    );

    expect(lines[0]).toBe('[read-size drift] 0 drifted, 0 agree, 1 not measured, of 1 recorded');
  });

  it('asks for the re-record only when something drifted', () => {
    const quiet = formatDriftReport(
      { 'backend/scripts/a.ts': record(10, null) },
      new Map([['backend/scripts/a.ts', seen(10, null)]]),
    );
    expect(quiet.some((line) => line.includes('re-record these in'))).toBe(false);

    const loud = formatDriftReport(
      { 'backend/scripts/a.ts': record(10, null) },
      new Map([['backend/scripts/a.ts', seen(12, null)]]),
    );
    expect(loud.at(-1)).toBe(
      '[read-size drift] re-record these in backend/test/helpers/check-read-sizes.ts, ' +
        'in this merge request, and say what moved them',
    );
  });

  it('reads the entry nearest its floor first, then the rises, then ties by key', () => {
    const lines = formatDriftReport(
      {
        // A large absolute fall that has consumed little of a wide floor.
        'backend/scripts/wide.ts': record(10_000, null),
        // A small absolute fall that has consumed most of a narrow one.
        'backend/scripts/narrow.ts': record(20, null),
        // Two rises, identical percentages, ordered by key.
        'backend/scripts/rise-b.ts': record(100, null),
        'backend/scripts/rise-a.ts': record(100, null),
      },
      new Map([
        ['backend/scripts/wide.ts', seen(9_800, null)], // 200 of 1000 — 20%
        ['backend/scripts/narrow.ts', seen(19, null)], // 1 of 2 — 50%
        ['backend/scripts/rise-b.ts', seen(110, null)],
        ['backend/scripts/rise-a.ts', seen(110, null)],
      ]),
    );

    expect(entryLines(lines).map((line) => line.split(' ')[2])).toEqual([
      'backend/scripts/narrow.ts',
      'backend/scripts/wide.ts',
      'backend/scripts/rise-a.ts',
      'backend/scripts/rise-b.ts',
    ]);
  });

  it('reports a percentage past 100 rather than clamping it', () => {
    const recorded = record(1000, null);
    // Below the floor: the band assertion is failing, and the report says by
    // how far rather than reporting a tidy 100%.
    expect(readSizeBounds(1000).min).toBe(900);
    const lines = formatDriftReport(
      { 'backend/scripts/below.ts': recorded },
      new Map([['backend/scripts/below.ts', seen(800, null)]]),
    );

    expect(entryLines(lines)).toEqual([
      '[read-size drift] backend/scripts/below.ts files 1000 -> 800 (-200, 200% to floor)',
    ]);
  });

  it('aligns the dimensions past the longest key it prints', () => {
    const lines = formatDriftReport(
      {
        'backend/scripts/check-module-boundary.ts': record(3916, null),
        'backend/scripts/check-admin-zones.ts': record(2206, null),
      },
      new Map([
        ['backend/scripts/check-module-boundary.ts', seen(3926, null)],
        ['backend/scripts/check-admin-zones.ts', seen(2211, null)],
      ]),
    );

    const columns = entryLines(lines).map((line) => line.indexOf('files'));
    expect(columns[0]).toBe(columns[1]);
    expect(new Set(columns).size).toBe(1);
  });
});
