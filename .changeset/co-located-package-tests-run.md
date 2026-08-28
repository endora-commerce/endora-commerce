---
'@endora-commerce/mod-google-tag-manager': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-prompt-actions': patch
'@endora-commerce/mod-quick-order': patch
---

These four packages now declare a `test` script and ship a `vitest.config.ts`, so the unit
tests they already carried beside their sources are collected and run.

They were not. `specs/deferred-defects.md`'s *"Co-located tests inside a module package run
nowhere"* is the entry this closes: no vitest configuration included `packages/**` and no
module package declared a test command, so fifteen files across these four packages were
collected by no run, reported by no job and counted in no total. They were not failing —
as far as the pipeline was concerned they did not exist, which in review reads as coverage.
All fifteen pass on first collection: 103 tests, and the CI job that will now run them,
`test:frontend`, goes from 229 files / 1240 tests to 244 / 1343.

**If you consume one of these packages**, nothing you import changes: `files` still ships
`dist` and `i18n`, `tsconfig.build.json` still roots the emit at `src/`, and the test files
and the configuration are in neither. The only difference is that `pnpm test` inside the
package now does something.

**If you write a module package**, two rules now hold and are enforced rather than
documented:

* The generated `test` script is a bare `vitest run` — never `--passWithNoTests`. Measured
  on vitest 2.1.9 over a package with no test file, bare `run` exits 1 with *"No test files
  found"* and the flag turns that into 0. A package that declares a runner and collects
  nothing must fail, or the repair reproduces the defect it fixes.
* `manifests:generate` and `manifests:check` **refuse** a package that holds a test file and
  declares no `vitest.config.ts`, naming the file. That is what stops the gap reopening
  silently for the next package.

A package's `vitest.config.ts` must `mergeConfig` the repository root's
`vitest.config.base.ts`: that is where issue #255's foreign-workspace-link refusal lives,
and a configuration that skips it can execute another checkout's sources while reporting on
this branch.
