// The platform package's own test run (`specs/110-instance-repository/`, T119a).
//
// The host carries the unit tests that cover its own sources beside those
// sources, which is `specs/106-module-owned-tests/`'s convention applied to the
// one package in this tree that had a `src/` and no tests. It is not a
// tidying: inside the package a test names a **relative** path, so an internal
// the barrels deliberately do not publish — `normalise`, `parseAcceptLanguage`,
// `SETTINGS_LRU_TTL_MS`, `duplicateModuleIds`, `validateRegistrations`,
// `withScopeNotice`, `makePreDispatchOnRoute` — stops being a surface question
// altogether rather than being given an address it should not have (D-160.8).
//
// Three things here are load-bearing rather than boilerplate:
//
//   * **`mergeConfig(baseConfig, …)`** — the base is the one file every
//     workspace's vitest configuration merges, and it is where issue #255's
//     foreign-workspace-link refusal lives. A configuration that skipped it
//     would let this package's run execute *another checkout's* sources while
//     reporting on this branch, and would print no
//     `[workspace-resolution] read:` line for anybody to notice the absence by.
//   * **no `--passWithNoTests`, anywhere** — neither here nor in the `test`
//     script. A run that collects zero files from a package that ships them
//     must exit non-zero, or the repair reproduces the defect it fixes.
//   * **`--expose-gc`** — `src/kernel/scope-retention.test.ts` measures a
//     post-GC `heapUsed`, which is noise without a forced collection. It came
//     from `backend/vitest.shared.ts` with the file and has to travel with it;
//     the test refuses to run rather than measure noise when it is absent.
//
// The tests stay out of `tsconfig.build.json`'s emit (they import `vitest`, a
// devDependency no consumer installs); `vitest` transpiles them itself.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'platform',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // `backend/test/tenancy-setup.ts`'s counterpart — see `vitest.setup.ts`.
      // Feature 050's ambient `system` scope is a property of the *run*, and
      // four of the moved files assert over it.
      setupFiles: ['./vitest.setup.ts'],
      poolOptions: {
        forks: {
          execArgv: ['--expose-gc'],
        },
      },
    },
  }),
);
