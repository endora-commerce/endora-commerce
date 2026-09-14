import { mkdtempSync, rmSync } from 'node:fs';
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
    expect(Object.keys(runtime).sort()).toEqual(['entries', 'err', 'out', 'resources']);
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
