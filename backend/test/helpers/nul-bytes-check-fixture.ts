import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_LIB_ROOT } from './check-lib-root.js';

/**
 * A synthetic repository with a copy of `check-nul-bytes` inside it.
 *
 * The script derives its root from its own location — `<script>/../..`, the
 * idiom `shell-check-fixture.ts` already uses for the two bash checks — so a
 * copy at `<tmp>/node_modules/scripts/` scans `<tmp>` and nothing else. The
 * `node_modules` level is chosen on purpose: it is pruned, so the copy is not
 * in its own population and an untouched fixture really is an **empty** tree.
 * Without that the exit-2 guard would be assertable only as source text, which
 * is the shape issue #113 is about.
 *
 * It lives here rather than inside the companion test because the directory
 * exclusions have **two** consumers — the walk, which prunes for speed, and
 * `isScannablePath`, which states the rule — and only a fixture on disk enters
 * above both. A `ScannedFile` record hands the analysis a path the walk already
 * decided to produce, so it cannot prove that a pruned tree is never walked;
 * issue #248's exclusions are proven through this, from the inventory as well
 * as from the companion test.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(REPO_ROOT, 'backend', 'node_modules', '.bin', 'tsx');
const SCRIPT = join(REPO_ROOT, 'backend', 'scripts', 'check-nul-bytes.ts');
/** The shared read-size reporter the check imports (issue #244). */
const READ_SIZE_LIB = join(CHECK_LIB_ROOT, 'read-size.ts');

export interface NulBytesFixture {
  readonly root: string;
  /** Writes a file into the fixture repository, creating its directories. */
  write(path: string, content: Uint8Array): void;
  run(): { status: number | null; output: string };
  cleanup(): void;
}

export function createNulBytesFixture(): NulBytesFixture {
  const root = mkdtempSync(join(tmpdir(), 'nul-bytes-check-'));
  const checker = join(root, 'node_modules', 'scripts', 'check-nul-bytes.ts');
  mkdirSync(dirname(checker), { recursive: true });
  copyFileSync(SCRIPT, checker);
  // The check imports the shared reporter by a relative path, so the copy needs
  // it beside itself or the fixture run dies at module resolution and every
  // exit code below reads as 1.
  mkdirSync(join(dirname(checker), 'lib'), { recursive: true });
  copyFileSync(READ_SIZE_LIB, join(dirname(checker), 'lib', 'read-size.ts'));

  return {
    root,
    write: (path, content) => {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    run: () => {
      const result = spawnSync(TSX, [checker], { encoding: 'utf8' });
      return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * 1 when a tree holding a NUL in `generated` and a NUL in `source` reports
 * **exactly** the source one, 0 otherwise — the shape a discrimination needs.
 *
 * Written as a discrimination because "the generated file was not reported" is
 * green on a check that reported nothing at all, which is the failure the whole
 * inventory exists to refuse. The source file beside it is what makes the proof
 * able to go red in both directions: drop the exclusion and two paths come
 * back, widen it over `backend/src` and none do.
 */
export function reportsOnlyTheSourceFile(generated: string, source: string): number {
  const fixture = createNulBytesFixture();
  try {
    fixture.write(generated, new TextEncoder().encode('const k = `a\0b`;\n'));
    fixture.write(source, new TextEncoder().encode('const k = `a\0b`;\n'));
    const result = fixture.run();
    if (result.status !== 1) return 0;
    if (!result.output.includes('violations=1')) return 0;
    if (result.output.includes(generated)) return 0;
    return result.output.includes(source) ? 1 : 0;
  } finally {
    fixture.cleanup();
  }
}
