import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(
  here,
  '../../../src/lifecycle/scripts/uninstall.ts',
);

/**
 * Integration test for FR-013-adjacent — `--hard` in a non-tty shell
 * MUST require `--force` (data-loss safety net for CI / cron).
 *
 * Lives in `test/integration/` (not `test/contract/`) because the
 * already-existing CLI argv contract test is sufficient for the
 * argv-only paths; this test asserts the orchestrator-side guard
 * holds when invoked through the real CLI script in a real
 * subprocess (which has no tty).
 *
 * Authored skeleton; relies on the dev DB being reachable so the
 * orchestrator boot path doesn't error before the safety check fires.
 */

describe('Module uninstall — --hard requires --force in non-tty (integration)', () => {
  it('exits 64 with a clear error when --hard is passed without --force in a subprocess', async () => {
    const result = await exec('pnpm', [
      'exec',
      'tsx',
      script,
      'fixture_hard_needs_force',
      '--hard',
    ]).catch((e: { code?: number; stdout?: string; stderr?: string }) => ({
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    }));

    if ('code' in result) {
      expect(result.code).toBe(64);
      expect(result.stderr).toMatch(/--hard.*--force/);
    } else {
      // Should not reach here — exec succeeded means the command exited 0.
      expect.fail('expected --hard without --force to exit 64');
    }
  }, 30_000);
});
