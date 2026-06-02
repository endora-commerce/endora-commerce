import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * `modules:install` / `modules:uninstall` deprecation shims.
 *
 * The settings-era `modules:install` / `modules:uninstall` CLI was deprecated
 * by the module-lifecycle work (feature 018) and superseded by the singular
 * `module:install` / `module:uninstall` lifecycle CLI. The remaining scripts
 * are thin shims that print a deprecation notice and forward argv to the new
 * commands.
 *
 * The real install/uninstall behaviour now lives in — and is covered by — the
 * `_lifecycle` CLI suite, and the settings-manifest reconciliation that the
 * old CLI exercised is covered by `modules-install-idempotent.test.ts`. This
 * suite only asserts the deprecation-and-forward contract of the shims.
 *
 * The shims are tsx entrypoints; we exercise them by spawning a real
 * subprocess with the same DATABASE_URL as the test harness.
 */

const REPO_ROOT = resolve(__dirname, '../../../../');
const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b_test';

function runCli(
  script: 'modules-install' | 'modules-uninstall',
  args: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'pnpm',
    ['exec', 'tsx', `src/modules/settings/scripts/${script}.ts`, ...args],
    {
      cwd: resolve(REPO_ROOT, 'backend'),
      env: { ...process.env, DATABASE_URL },
      encoding: 'utf8',
    },
  );
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('modules:install / modules:uninstall — deprecation shims', () => {
  it('modules:install prints a deprecation notice pointing at module:install and forwards', () => {
    const r = runCli('modules-install', ['definitely-not-a-module']);
    expect(r.stderr).toContain('[deprecated]');
    expect(r.stderr).toContain('module:install');
    // Forwarded to the lifecycle install CLI, which rejects an unknown id with
    // a misuse exit code (64).
    expect(r.exitCode).toBe(64);
  }, 30_000);

  it('modules:uninstall prints a deprecation notice pointing at module:uninstall and forwards', () => {
    const r = runCli('modules-uninstall', ['definitely-not-a-module']);
    expect(r.stderr).toContain('[deprecated]');
    expect(r.stderr).toContain('module:uninstall');
  }, 30_000);
});
