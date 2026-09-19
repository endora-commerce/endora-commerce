/**
 * Setup file — re-assert the pinned generable secrets before **every** test
 * file, not once per run.
 *
 * `global-setup.ts` applies `applyGenerableSecretEnv` once, in the parent
 * process before any worker forks, and that is enough only if nothing in the
 * run ever writes those variables afterwards. It does. Measured over
 * `backend/test/`, of the 151 files that assign
 * `SETTINGS_SECRET_ENCRYPTION_KEY`:
 *
 *   - **112** use the preserving idiom, `process.env[K] = process.env[K] ??
 *     randomBytes(32).toString('base64')`. Once the key is pinned these are
 *     self-assignments and harmless — which is what made pinning look like a
 *     complete repair.
 *   - **36** assign `randomBytes(32).toString('base64')` **unconditionally**,
 *     overwriting the pinned value for every file that runs after them in the
 *     same fork.
 *   - **2** capture the ambient value and restore it, and **1** assigns its own
 *     `TEST_KEY`. 112 + 36 + 2 + 1 = 151, which is how this breakdown is known
 *     to be complete rather than a subtraction.
 *
 * Separately, **38** files `delete` the variable in `afterAll` — correct while it
 * was withheld, and it leaves a pinned key absent now.
 *
 * Both of the last two shapes break the pin, and
 * `test/unit/harness/generable-secrets.test.ts` is the instrument that says so:
 * it failed on `master` at `047c4f3b1` with a **random** value where the pin was
 * expected, because the last writer before it was an unconditional assignment
 * whose `afterAll` had not yet run. A deleter in the same position produces
 * `undefined` instead. Same defect, two received values.
 *
 * A setup file is evaluated once per test file, after the previous file's
 * `afterAll` and before this file's own module graph, so re-applying here is the
 * narrowest place that makes the pin true for every file rather than only for
 * the first. It is the `process.env` counterpart of the
 * `settings.global_value` reset in `helpers/test-server.ts` — state that
 * survives the file that wrote it, reset by the harness rather than by asking
 * 151 authors to restore what they wrote.
 *
 * **Only the pinned values, deliberately.** Re-deriving the withheld population
 * here would mean `derivedGenerableSecrets()`, which dynamically imports the
 * platform's environment declarations and this deployment's manifest registry —
 * a module graph bound before every test file's `vi.mock` registrations, which
 * is the hazard `tenancy-setup.ts` documents at length. `PINNED_GENERABLE_SECRETS`
 * is a plain record and `generable-secrets.ts`'s only import is `import type`,
 * so this file reaches nothing at runtime. A withheld variable cannot come back
 * on its own; only a pinned one can be overwritten with something that looks
 * valid.
 *
 * Fixing the 36 unconditional assignments to use the pinned value, and dropping
 * the 38 deletes, is the deeper cleanup and is **not** done here: it is dozens of
 * files for no behaviour a caller can see, and this file makes the invariant hold
 * whether or not that happens.
 */
import { beforeAll } from 'vitest';

import { PINNED_GENERABLE_SECRETS } from './generable-secrets.js';

function applyPinnedSecrets(): void {
  for (const [name, entry] of Object.entries(PINNED_GENERABLE_SECRETS)) {
    process.env[name] = entry.value;
  }
}

// At module load: before this test file's own module graph, so a module whose
// top-level code constructs a cipher from the environment sees the pin.
applyPinnedSecrets();

// And again before this file's hooks. Cheap, and it does not depend on the
// ordering guarantee above continuing to hold between vitest versions.
beforeAll(applyPinnedSecrets);
