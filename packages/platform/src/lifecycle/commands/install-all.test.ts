import { defineModuleManifest } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { runInstallCommand } from './install.js';
import type { OperatorRuntime } from './operator-runtime.js';

/**
 * `module:install --all` (`specs/110-instance-repository/` T141).
 *
 * The red proof is the acceptance criterion's: an instance's modules are all
 * installed packages, no boot writes their `module_registrations` rows
 * (D-157.6(b)), and the only remedy was this command one module at a time in a
 * dependency order it refuses to compute. Every case below runs with a runtime
 * whose `resources` throws, which is what says the answer was reached without a
 * database — the property that makes a usage error and a plan honest on a
 * machine whose Postgres is down.
 */
const manifestFor = (id: string, dependencies: string[] = []) =>
  defineModuleManifest({
    id,
    name: id,
    description: `${id} fixture`,
    version: '1.0.0',
    dependencies,
  });

function runtimeOver(ids: ReadonlyArray<readonly [string, string[]]>): {
  rt: OperatorRuntime;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    rt: {
      resources: () => {
        throw new Error('this case must answer without opening anything');
      },
      entries: ids.map(([id, dependencies]) => ({
        manifest: manifestFor(id, dependencies),
        filePath: `/fixture/${id}/manifest.js`,
      })),
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
    } as unknown as OperatorRuntime,
  };
}

describe('module:install --all', () => {
  it('plans every registered module, dependencies first', async () => {
    const { rt, out } = runtimeOver([
      ['orders', ['catalog']],
      ['catalog', ['settings']],
      ['settings', []],
    ]);
    expect(await runInstallCommand(['--all', '--dry-run'], rt)).toBe(0);
    expect(out.join('')).toContain('settings, catalog, orders');
  });

  it('reports the plan as data under --json', async () => {
    const { rt, out } = runtimeOver([
      ['catalog', ['settings']],
      ['settings', []],
    ]);
    expect(await runInstallCommand(['--all', '--dry-run', '--json'], rt)).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual({
      all: true,
      dryRun: true,
      order: ['settings', 'catalog'],
    });
  });

  it('refuses a module id beside --all, rather than letting one of them win', async () => {
    const { rt, err } = runtimeOver([['settings', []]]);
    expect(await runInstallCommand(['--all', 'settings'], rt)).toBe(64);
    expect(err.join('')).toContain('--all takes no module id');
  });

  it('still refuses an invocation that names nothing at all', async () => {
    const { rt, err } = runtimeOver([['settings', []]]);
    expect(await runInstallCommand([], rt)).toBe(64);
    expect(err.join('')).toContain('missing module id');
  });

  it('prints `--all` in its usage line, so the flag is discoverable from a misuse', async () => {
    const { rt, err } = runtimeOver([['settings', []]]);
    await runInstallCommand([], rt);
    expect(err.join('')).toContain('module:install <module-id> | --all');
  });
});
