import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { instanceOperatorRuntime } from './operator-entry.js';

/**
 * The half of an instance's `module:*` entry point that answers with no
 * process and no database (`contracts/operator-half.md` R2.6; R1.4).
 *
 * It is the whole of what the assertion can be here, and deliberately so: the
 * other half opens PostgreSQL and Redis, and the property that matters about it
 * is **that it is not reached**. An invocation that answers out of argv or the
 * resolved registry alone must open neither, and `dispose` on such a run must
 * close nothing — without the second half the five commands print their answer
 * and then hang forever on a live Redis handle.
 *
 * So the ORM configuration handed in below **throws**. A test that passed a
 * working one would report green whether or not the laziness held, which is the
 * shape this file exists to refuse; a thrown configuration turns any eager open
 * into a failure with the reason in it.
 *
 * The deployment root is an empty directory: no `apps/`, no `node_modules`, so
 * the only entry the walk can produce is the resident `_lifecycle` — the one
 * module the packaging sweep did not turn into a package, which arrives with
 * the platform and is in **every** composition's set whatever a tree installed
 * (D-160.11). What a populated root resolves is `installed-packages`' and
 * `overlay-runtime`'s own tests, and asserting it a second time here would be a
 * second answer to their question.
 */
const roots: string[] = [];

function emptyDeploymentRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'operator-entry-'));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const refusingConfig = (): Promise<never> => {
  throw new Error('the ORM configuration was read, and this run should not have opened one');
};

describe('instanceOperatorRuntime', () => {
  it('R2.2 — resolves the manifest set before anything is opened', async () => {
    const { runtime, dispose } = await instanceOperatorRuntime({
      deploymentRoot: emptyDeploymentRoot(),
      ormConfig: refusingConfig,
      env: {},
    });
    // A value rather than a thunk: the five bodies read it directly, and a
    // discovery refusal has already been raised by the time they run. The
    // resident module is the floor and there is nothing else here to find.
    expect(runtime.entries.map((entry) => entry.manifest.id)).toEqual(['_lifecycle']);
    await expect(dispose()).resolves.toBeUndefined();
  });

  it('R2.6 — `resources` is not called during the build, and `dispose` closes nothing', async () => {
    const { runtime, dispose } = await instanceOperatorRuntime({
      deploymentRoot: emptyDeploymentRoot(),
      ormConfig: refusingConfig,
      env: {},
    });
    // Reaching for it is what opens it, and nothing above has reached.
    await expect(runtime.resources()).rejects.toThrow('should not have opened one');
    await expect(dispose()).resolves.toBeUndefined();
  });

  it('R2.4 — output goes through the runtime, never `process.stdout`', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const { runtime } = await instanceOperatorRuntime({
      deploymentRoot: emptyDeploymentRoot(),
      ormConfig: refusingConfig,
      env: {},
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    runtime.out('one\n');
    runtime.err('two\n');
    expect(out).toEqual(['one\n']);
    expect(err).toEqual(['two\n']);
  });

  it('R2.1 — there is no container on it, and no composition seam either', async () => {
    const { runtime } = await instanceOperatorRuntime({
      deploymentRoot: emptyDeploymentRoot(),
      ormConfig: refusingConfig,
      env: {},
    });
    // A command that cannot reach a composition cannot run one, which is what
    // makes D-157.2/.4's failure structurally unreachable rather than
    // remembered. Asserted over the built object rather than over the type, so
    // a field added later fails here and not only in review.
    expect(Object.keys(runtime).sort()).toEqual([
      'entries',
      'err',
      'migrationOwnership',
      'out',
      'resources',
    ]);
  });

  it('supplies the migration ownership `uninstall --hard` reverts by, and opens nothing to do it', async () => {
    const { runtime, dispose } = await instanceOperatorRuntime({
      deploymentRoot: emptyDeploymentRoot(),
      ormConfig: refusingConfig,
      env: {},
    });
    // Absent, the orchestrator refuses every hard uninstall — and in an
    // instance every module is a package, so the command could never succeed.
    expect(runtime.migrationOwnership).toBeTypeOf('function');
    const ownership = await runtime.migrationOwnership!();
    // The platform's own chain is covered; a module nobody installed is not,
    // and `null` is what the orchestrator refuses on.
    expect(ownership.migrationNamesFor('core')).not.toBeNull();
    expect(ownership.migrationNamesFor('not_installed_here')).toBeNull();
    // `refusingConfig` was never called: the answer is read from `node_modules`.
    await expect(dispose()).resolves.toBeUndefined();
  });

  it('answers for this deployment\'s overlay modules: they are covered, and own no migration', async () => {
    const deploymentRoot = emptyDeploymentRoot();
    const moduleDir = join(deploymentRoot, 'apps', 'shop', 'modules', 'proof_notice');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      join(moduleDir, 'manifest.js'),
      "export const manifest = { id: 'proof_notice', version: '1.0.0', dependencies: [] };\n",
      'utf8',
    );
    const { runtime } = await instanceOperatorRuntime({
      deploymentRoot,
      ormConfig: refusingConfig,
      env: { DEPLOYMENT: 'shop' },
    });
    expect(runtime.entries.map((entry) => entry.manifest.id)).toContain('proof_notice');
    const ownership = await runtime.migrationOwnership!();
    // An empty list, not `null`: an overlay module contributes no schema, so
    // there is nothing to revert and the hard uninstall may proceed to its hook.
    expect(ownership.migrationNamesFor('proof_notice')).toEqual([]);
  });

  it('D-217 — nothing supplies `confirm`, so `--hard` cannot be taken past its refusal', async () => {
    const { runtime } = await instanceOperatorRuntime({
      deploymentRoot: emptyDeploymentRoot(),
      ormConfig: refusingConfig,
      env: {},
    });
    expect(runtime.confirm).toBeUndefined();
  });
});
