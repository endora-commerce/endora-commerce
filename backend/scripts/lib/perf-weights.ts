/**
 * How much wall clock a benchmark under `backend/test/perf` costs, read off the
 * file's own declaration.
 *
 * ## The defect this replaces
 *
 * `.gitlab-ci.yml` used to carry the heavy files as a hand-written list:
 *
 *     SKIP_HEAVY="--exclude test/perf/product_feeds/generation-100k.test.ts \
 *                 --exclude test/perf/pim_ergonode/import-throughput.test.ts"
 *
 * and the comment above it called the remainder *"the nine fast benchmarks"*.
 * Three PIM integrations landed after that list was written, each with a
 * 10 000-record benchmark, and none of them was added to it — because nothing
 * asked. On the nightly of 2026-09-09 (pipeline 13444)
 * `test/perf/pim_unopim/import-throughput.test.ts` ran for **2 599 075 ms**, the
 * runner's one-hour wall arrived while `pim_akeneo/full-delivery-apply.perf.ts`
 * was still going, and three files never ran at all. Zero tests failed and no
 * budget was exceeded: the nightly cost an hour of a shared runner and reported
 * on 14 of its 17 files.
 *
 * That is a derived fact written down (D-100), failing in the direction that
 * costs an hour before anybody learns.
 *
 * ## What is derived and what is declared
 *
 * A file's wall-clock weight is not derivable from its source: it is a property
 * of running it. What *is* derivable is whether every file has been classified,
 * and that is the half that went wrong — so the classification is **declared in
 * the file** and the membership of each tier is **derived** from those
 * declarations. A benchmark that declares nothing is a finding, never a default:
 * defaulting to `fast` is precisely how a 43-minute file joined the nightly, and
 * defaulting to `heavy` would drop a benchmark out of every schedule in silence.
 *
 * The marker is a comment, in the idiom of `command-coverage-ignore` and
 * `naming:allow-snake-case`, and it carries a reason for the same reason those
 * do — the next author needs the measurement, not the verdict:
 *
 *     // perf-weight: heavy — 2 599 075 ms on the CI runner (pipeline 13444).
 *
 * ## The findings
 *
 * All four are refusals rather than debt, and there is deliberately **no
 * ledger**: every one of them is one comment line away from compliance, so an
 * entry could only license a benchmark nobody has decided about.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The two tiers a benchmark can be in. Neither is a default. */
export type PerfWeight = 'fast' | 'heavy';

/** Every weight this repository recognises, in the order a message lists them. */
export const PERF_WEIGHTS: readonly PerfWeight[] = ['fast', 'heavy'];

/** A benchmark file that declared exactly one weight, with its reason. */
export interface PerfFile {
  /** Path relative to the walk root, in vitest's own spelling (`test/perf/…`). */
  readonly path: string;
  readonly weight: PerfWeight;
  readonly reason: string;
}

export type PerfWeightFindingKind =
  /** No `perf-weight:` marker anywhere in the file. */
  | 'undeclared-weight'
  /** More than one marker: two answers to one question, waiting to disagree. */
  | 'duplicate-weight'
  /** A marker naming something that is not one of {@link PERF_WEIGHTS}. */
  | 'unknown-weight'
  /** A marker with no sentence after it. */
  | 'weight-without-a-reason';

export interface PerfWeightFinding {
  readonly kind: PerfWeightFindingKind;
  readonly path: string;
  readonly detail: string;
}

export interface PerfWeightReading {
  /** Every file that declared exactly one recognised weight, with a reason. */
  readonly files: readonly PerfFile[];
  readonly findings: readonly PerfWeightFinding[];
  /** How many files the walk opened, findings included. */
  readonly scanned: number;
}

/** One source file, as the walk hands it to {@link readPerfWeights}. */
export interface PerfSource {
  readonly path: string;
  readonly source: string;
}

/**
 * The marker, matched only where the line is a comment.
 *
 * Requiring `//`, `*` or `#` before it is what keeps a string literal — a test
 * asserting on this very text, for instance — out of the population, in the
 * idiom `check:diacritic-folds` uses to keep the file that documents a rule out
 * of the rule's own reach.
 */
const MARKER = /^[ \t]*(?:\/\/+|\*|#)[ \t]*perf-weight:(.*)$/;

/** `<weight> — <reason>`, with `--` accepted for an author without an em dash. */
const DECLARATION = /^\s*([A-Za-z-]+)\s*(?:—|--)\s*(.+?)\s*$/;

/**
 * Classify one file's source text.
 *
 * Exported so a test can drive it over source text directly: a fixture that
 * enters where a real file's bytes enter is a fixture that can catch the
 * classifier, and one that enters below it cannot (issue #130).
 */
export function classifySource(path: string, source: string): PerfFile | PerfWeightFinding {
  const markers = source
    .split('\n')
    .map((line) => MARKER.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1] ?? '');

  if (markers.length === 0) {
    return {
      kind: 'undeclared-weight',
      path,
      detail:
        'no `perf-weight:` marker. Every benchmark declares which tier it belongs to; ' +
        'neither tier is a default, because a default is how a 43-minute file joined the nightly.',
    };
  }
  if (markers.length > 1) {
    return {
      kind: 'duplicate-weight',
      path,
      detail: `${markers.length} \`perf-weight:\` markers. One file, one answer.`,
    };
  }

  const declaration = DECLARATION.exec(markers[0] ?? '');
  if (declaration === null) {
    return {
      kind: 'weight-without-a-reason',
      path,
      detail:
        `the marker reads \`perf-weight:${markers[0] ?? ''}\`. ` +
        'The spelling is `perf-weight: <fast|heavy> — <why>`, and the sentence is the point: ' +
        'the next author needs the measurement, not the verdict.',
    };
  }

  const named = declaration[1] ?? '';
  const reason = declaration[2] ?? '';
  if (!(PERF_WEIGHTS as readonly string[]).includes(named)) {
    return {
      kind: 'unknown-weight',
      path,
      detail: `\`${named}\` is not a weight this repository recognises. Recognised: ${PERF_WEIGHTS.join(', ')}.`,
    };
  }

  return { path, weight: named as PerfWeight, reason };
}

/** Classify a whole set of sources. */
export function readPerfWeights(sources: readonly PerfSource[]): PerfWeightReading {
  const files: PerfFile[] = [];
  const findings: PerfWeightFinding[] = [];

  for (const { path, source } of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    const verdict = classifySource(path, source);
    if ('kind' in verdict) findings.push(verdict);
    else files.push(verdict);
  }

  return { files, findings, scanned: sources.length };
}

/** The file extensions vitest's backend config collects under `test/perf`. */
const PERF_SUFFIXES = ['.bench.ts', '.perf.ts', '.test.ts'] as const;

/**
 * Every benchmark file under `root`, as paths relative to `relativeTo`.
 *
 * The suffix set is `vitest.config.ts`' own `include` narrowed to this
 * directory, so a benchmark written with any of the three spellings the backend
 * suite already collects is in the population. A file the walk cannot see is a
 * file no tier contains, which is why the callers refuse an empty walk rather
 * than reporting a tidy selection over nothing.
 */
export function collectPerfSources(root: string, relativeTo: string): readonly PerfSource[] {
  const out: PerfSource[] = [];

  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!PERF_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
      out.push({
        path: relative(relativeTo, full).split(sep).join('/'),
        source: readFileSync(full, 'utf8'),
      });
    }
  };

  walk(root);
  return out;
}
