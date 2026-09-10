/**
 * Which benchmarks a scheduled `perf:backend` job runs — derived from the
 * benchmarks, not listed in `.gitlab-ci.yml`.
 *
 *   pnpm --filter backend exec tsx scripts/perf-selection.ts --weight fast
 *   pnpm --filter backend exec tsx scripts/perf-selection.ts --weight heavy
 *
 * The selected paths go to **stdout**, one per line, in vitest's own spelling,
 * so `scripts/perf-backend.sh` can pass them straight to `vitest run`. Every
 * word of commentary goes to stderr, so a caller capturing stdout captures the
 * selection and nothing else.
 *
 * Selection is **positive**: the job names the files it runs rather than the
 * files it skips. That inversion is the point. A skip list is wrong in silence
 * when a benchmark arrives that nobody adds to it — which is exactly what
 * happened, three times, between the list being written and pipeline 13444
 * spending an hour on it — while a file that is in no tier cannot be selected
 * by either job and is refused here by name.
 *
 * Exit 0 — the selection is on stdout.
 * Exit 1 — a benchmark is classified wrongly (see `lib/perf-weights.ts`).
 * Exit 2 — the run could not decide: no weight asked for, no benchmark found,
 *          or a tier that came back empty. A green that could mean "not
 *          looking" is not a green (issue #113).
 */

/* eslint-disable no-console -- CLI: stdout is the selection, stderr is the accounting. */

import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectPerfSources,
  PERF_WEIGHTS,
  readPerfWeights,
  type PerfWeight,
} from './lib/perf-weights.js';

const BACKEND_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PERF_ROOT = fileURLToPath(new URL('../test/perf', import.meta.url));

function die2(message: string): never {
  console.error(`[perf-selection] ${message}`);
  process.exit(2);
}

function main(): void {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--weight');
  const asked = index >= 0 ? argv[index + 1] : undefined;
  if (asked === undefined) {
    die2(`--weight is required. One of: ${PERF_WEIGHTS.join(', ')}.`);
  }
  if (!(PERF_WEIGHTS as readonly string[]).includes(asked)) {
    die2(`--weight ${asked} is not a weight this repository recognises. One of: ${PERF_WEIGHTS.join(', ')}.`);
  }
  const weight = asked as PerfWeight;

  const sources = collectPerfSources(PERF_ROOT, BACKEND_ROOT);
  if (sources.length === 0) {
    die2(
      `no benchmark under ${PERF_ROOT}. The perf suite cannot have moved and left this ` +
        'selection correct: a walk that came back empty selects nothing and would report a ' +
        'cheerful pass over a job that measured the platform not at all.',
    );
  }

  const reading = readPerfWeights(sources);
  const selected = reading.files.filter((file) => file.weight === weight);
  const counts = PERF_WEIGHTS.map(
    (name) => `${name}=${reading.files.filter((file) => file.weight === name).length}`,
  ).join(' ');

  console.error(
    `[perf-selection] read: files=${reading.scanned} ${counts} ` +
      `unclassified=${reading.findings.length} weight=${weight} selected=${selected.length}`,
  );

  if (reading.findings.length > 0) {
    console.error(
      '\nA benchmark under test/perf is in neither tier, so no scheduled job runs it.\n' +
        'Declare its weight in the file, with the measurement that decided it:\n' +
        '\n' +
        '    // perf-weight: fast — 6852 ms on the CI runner (pipeline 13444).\n' +
        '\n' +
        '`fast` runs on every schedule; `heavy` runs only on `weekly-heavy`. There is no\n' +
        'default, deliberately: defaulting to `fast` is how a 43-minute benchmark joined\n' +
        'the nightly, and defaulting to `heavy` would drop one out of every schedule with\n' +
        'nothing said.\n',
    );
    for (const finding of reading.findings) {
      console.error(`  - ${finding.path}  [${finding.kind}] ${finding.detail}`);
    }
    process.exit(1);
  }

  if (selected.length === 0) {
    die2(
      `every benchmark classified, and none of them is \`${weight}\`. A job that runs no file ` +
        'reports a pass over nothing measured; if this tier is genuinely empty, delete its job.',
    );
  }

  for (const file of selected) console.log(file.path);
}

// CLI only — importing this module (the unit test does) must not walk the tree.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
