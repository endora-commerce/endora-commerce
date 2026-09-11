// The release-gate suite: `test/release/`, one file, run by the
// `release:changeset` CI job (feature 080, T043).
//
//   pnpm --filter backend run test:release-gate
//
// It is its own config for one reason: **git**. The files under `test/release/`
// measure `changeset status --since` and the diff-shaped release-branch
// discriminator over real branches, and every other backend job runs in
// `node:22.17-slim`, which ships no git — `test/helpers/shell-check-fixture.ts`
// fakes `git ls-files` for exactly that reason. Faking it here would prove the
// fake, since the discriminator under test *is* a `git diff`. So this root is
// excluded from `vitest.config.ts` and included here, and the job that runs it
// is `release:changeset`, which installs git already, runs on every merge
// request, and is the job whose behaviour these tests are about.
//
// `check-release-intent.test.ts`, which does run in the unit suite, asserts
// that `.gitlab-ci.yml` still names `test:release-gate` — so a root nothing
// runs fails somewhere that always runs.

import { defineConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import { backendTestOptions, mergeBackendConfig } from './vitest.shared.js';

// Choosing this config *is* the declaration that the run has no services, in
// the idiom of `vitest.unit.config.ts`: it is made here rather than left to
// whoever writes the command line, so it cannot be forgotten or inferred from a
// connection that failed. `test/global-setup.ts` reads it and provisions
// nothing.
process.env['BACKEND_TEST_SERVICES'] = 'none';

export default mergeBackendConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend-release',
      include: ['test/release/**/*.test.ts'],
      ...backendTestOptions(),
    },
  }),
);
