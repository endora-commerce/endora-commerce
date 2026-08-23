/**
 * The reporter is wired to a real vitest run, over a real dead fork (issue #199).
 *
 * `run-completeness.test.ts` holds the arithmetic; this holds the thing the
 * arithmetic was written for, because the two can be wrong independently. A
 * reporter whose `onPathsCollected` never fires, or that vitest drops for
 * arriving as a class instance rather than a module path, produces exactly the
 * silence it exists to break — and a unit test over `incompleteRun` is green
 * throughout.
 *
 * The fixture kills the fork the way the CI shards did: from inside a test file,
 * with the process simply gone. `poolOptions.forks.singleFork` puts all four
 * files in one `pool.run`, so the two files after the killer never run and no
 * result is ever reported for them.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
const VITEST = join(BACKEND_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const REPORTER = join(BACKEND_ROOT, 'test', 'run-completeness.ts');

/** `backend/tmp/` is git-ignored, so an interrupted run leaves nothing tracked behind. */
const FIXTURE_PARENT = join(BACKEND_ROOT, 'tmp');

/** Vitest's default sequencer orders a shard by file size, descending. */
function padTo(body: string, bytes: number): string {
  const filler = `// ${'x'.repeat(60)}\n`;
  let text = body;
  while (text.length < bytes) text += filler;
  return text;
}

let fixture = '';
let stdout = '';
let stderr = '';
let status: number | null = null;

beforeAll(() => {
  mkdirSync(FIXTURE_PARENT, { recursive: true });
  fixture = mkdtempSync(join(FIXTURE_PARENT, 'run-completeness-'));

  writeFileSync(
    join(fixture, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config';\n` +
      `import { RunCompletenessReporter } from ${JSON.stringify(REPORTER)};\n` +
      `export default defineConfig({\n` +
      `  test: {\n` +
      `    include: ['*.test.ts'],\n` +
      `    pool: 'forks',\n` +
      `    poolOptions: { forks: { singleFork: true } },\n` +
      `    fileParallelism: false,\n` +
      `    reporters: ['default', new RunCompletenessReporter()],\n` +
      `  },\n` +
      `});\n`,
  );

  writeFileSync(
    join(fixture, 'first.test.ts'),
    padTo(
      `import { expect, it } from 'vitest';\nit('runs', () => { expect(1).toBe(1); });\n`,
      8_000,
    ),
  );
  writeFileSync(
    join(fixture, 'killer.test.ts'),
    padTo(
      // SIGKILL rather than `process.exit`: vitest intercepts the latter and
      // turns it into a failing test, which is the opposite of the case under
      // measurement. This is the CI signature exactly — a fork the host kills,
      // with no message and no failing test.
      `import { it } from 'vitest';\n` +
        `it('takes the fork with it', () => { process.kill(process.pid, 'SIGKILL'); });\n`,
      4_000,
    ),
  );
  writeFileSync(
    join(fixture, 'never-a.test.ts'),
    `import { expect, it } from 'vitest';\nit('never runs', () => { expect(1).toBe(1); });\n`,
  );
  writeFileSync(
    join(fixture, 'never-b.test.ts'),
    `import { expect, it } from 'vitest';\nit('never runs', () => { expect(1).toBe(1); });\n`,
  );

  const run = spawnSync(process.execPath, [VITEST, 'run'], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, CI: '', FORCE_COLOR: '0' },
  });
  stdout = run.stdout ?? '';
  stderr = run.stderr ?? '';
  status = run.status;
}, 180_000);

afterAll(() => {
  if (fixture !== '') rmSync(fixture, { recursive: true, force: true });
});

describe('a run whose fork dies mid-way says so', () => {
  it('reproduces the failure this reporter exists for — a dead fork and no failing test', () => {
    const output = stdout + stderr;

    expect(output, output).toContain('Worker exited unexpectedly');
    expect(output, output).not.toMatch(/\d+ failed/);
  });

  it('names both counts, so the summary cannot be read as a verdict on the whole run', () => {
    const output = stdout + stderr;

    // Two, not three: the file that killed the fork had already been collected,
    // so vitest holds a result entry for it. The two files after it have none,
    // and they are the ones nothing else in the output mentions.
    expect(output, output).toContain('Incomplete run');
    expect(output, output).toContain('4 test files');
    expect(output, output).toContain('2 never ran');
  });

  it('names the files that never ran', () => {
    const output = stdout + stderr;

    expect(output, output).toContain('never-a.test.ts');
    expect(output, output).toContain('never-b.test.ts');
  });

  it('fails the run — the counts printed above it are not a pass', () => {
    expect(status, `${stdout}\n${stderr}`).not.toBe(0);
  });
});
