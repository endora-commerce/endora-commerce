# Tasks: stand each component up on its own

**Input**: [spec.md](spec.md), [plan.md](plan.md),
`specs/110-instance-repository/contracts/instance-tree.md` §7

## Format

`- [ ] **ID** description` — files, then **Test**. Test first (Constitution III): write the named
test, see it fail, then implement. Tasks are in dependency order; none is parallel, because all
but T10 edit the same two files.

**Before T01**: rebase on `origin/master` after `feat/storefront-from-registry` has merged, run
`pnpm install && pnpm run build:packages`, and re-derive plan.md's evidence table.

---

- [x] **T01** The selection, as data. Add `COMPONENT_VOCABULARY` (`api`, `admin`, `storefront`)
  and a pure `resolveSelection(only, without, storefront)` returning
  `{ components, without, storefront, writesTree }` or a refusal sentence — the plan's selection
  table, FR-001–FR-003.
  Files: `packages/cli/src/install/selection.ts` (new).
  **Test**: `packages/cli/test/install-selection.test.ts` — one case per table row, the unknown
  name, the empty selection, both contradictions, and *absent ≡ all three*.

- [x] **T02** Origins. A pure `parseOrigin(value)` accepting `http(s)://host[:port]` and refusing
  a path, a trailing slash, credentials and any other scheme (FR-011).
  Files: `packages/cli/src/install/selection.ts`.
  **Test**: same file as T01 — accepted and refused spellings, and that the answer is
  `new URL(value).origin`.

- [x] **T03** argv. `--only` (repeatable, comma-separated), `--api-url`, `--admin-url`,
  `--storefront-url`, `--sales-channel` parsed into `InstallOptions`; usage text updated.
  Files: `packages/cli/src/bin/endora.ts`, `packages/cli/src/install/index.ts` (`InstallOptions`).
  **Test**: `packages/cli/test/cli.test.ts` — each flag reaches `runInstall`; `--help` names them.

- [x] **T04** Decide phase. `runInstall` resolves the selection first; adds T01's and T02's
  refusals to the collected refusal; makes the demo, administrator and Docker preconditions
  conditional on `api`; requires `--api-url` without `api`, and `--storefront-url` and
  `--revalidate-secret` for a storefront without `api`; refuses a flag for a removed question
  (FR-002, FR-010, FR-012, FR-013, D7).
  Files: `packages/cli/src/install/index.ts`.
  **Test**: `packages/cli/test/install.test.ts` — for `--only admin`, `--only storefront` and
  `--only api`: the exact refusal sentences when a required flag is missing, one refusal naming
  all of them, and no refusal about demo data or the administrator when `api` is absent.

- [x] **T05** Pipelines. `plan()` takes the selection: adds the `build-admin` step
  (`pnpm run build:admin`), drops `services`/`setup`/`admin`/`demo` without `api`, and plans
  `storefront-install` alone when no tree is written. `runNewInstance` is not called when
  `writesTree` is false, and `<dir>` is then the storefront's directory (FR-005–FR-009).
  Files: `packages/cli/src/install/index.ts`.
  **Test**: `packages/cli/test/install.test.ts` — the step-id list per table row through the
  injected `run`; `--dry-run` prints the same list; **and a snapshot of the no-`--only` list
  taken before this task, unchanged after it** (SC-003).

- [x] **T06** The `.env` lines. Write `admin/.env` (`VITE_API_BASE_URL`); pass `--api-url`,
  `--storefront-url`, `--sales-channel` and `--revalidate-secret` into `storefrontInputs`; write
  `PUBLIC_API_BASE_URL`, `ADMIN_BASE_URL`, `STOREFRONT_BASE_URL` and `CORS_ALLOWED_ORIGINS` over
  the instance's placeholders when given; generate and write `REVALIDATE_SECRET` for an API
  without a storefront. Never over an answered line (FR-012–FR-016).
  Files: `packages/cli/src/install/index.ts` (beside `deriveEnvironment` and
  `writeSharedSecret`, reusing `writeEnvFile`).
  **Test**: `packages/cli/test/install.test.ts` — on a real temporary tree per selection: each
  file's parsed values; an existing answered value survives; a storefront-only run with no
  secret is a refusal and writes no file; `ADMIN_BASE_URL` is written only when the instance
  declares it.

- [x] **T07** The wizard. Replace the parts checklist rows with the three components followed by
  the non-component members; add the *at least one* re-ask; add the follow-up origin, channel
  and secret questions with the plan's wording; map the outcome through T01 so an untouched list
  yields no `only`; make `INSTALL_QUESTIONS`' count a function of the selection
  (FR-017–FR-019).
  Files: `packages/cli/src/install/wizard.ts`, `packages/cli/src/install/index.ts`
  (`answersLine` call, wizard context).
  **Test**: `packages/cli/test/install-wizard.test.ts` — scripted input for each single-component
  selection asserting the questions asked, the ones not asked, the secret not echoed, an empty
  required answer re-asking, a bad origin re-asking, and that Enter on everything equals the
  answers of a flagless run. `packages/cli/test/install-wizard-tty.test.ts` — still green.

- [x] **T08** Closing block. Start commands for the selected components only, and FR-020's four
  facts under one heading for a strict subset; the secret's file is named and its value is not
  printed.
  Files: `packages/cli/src/install/index.ts` (`closing`).
  **Test**: `packages/cli/test/install.test.ts` — per selection: lines present, lines absent,
  and the generated secret's value absent from `result.output`.

- [x] **T09** The refusal's remedy and the deploy README. `memberRefusal`'s `--without backend`
  sentence names `--only admin` (FR-004); `deploy/README.md`'s three-host section gains FR-020's
  four facts (FR-021).
  Files: `packages/cli/src/new-instance/template.ts`, `packages/cli/src/new-instance/deploy.ts`.
  **Test**: `packages/cli/test/new-instance-members.test.ts` (the sentence),
  `packages/cli/test/new-instance.test.ts` (the README under `three-host`).

- [x] **T10** Acceptance. `acceptance:separate-components`: tarball supply and throwaway services
  as `instance.ts` does them, every port taken from the OS, S1–S7 of contract §7.4 as pure
  functions in an assertions file.
  Files: `backend/scripts/acceptance/separate-components.ts`,
  `backend/scripts/acceptance/separate-components-assertions.ts`, `backend/package.json`
  (the script and its `:ci` twin).
  **Test**: `backend/test/unit/acceptance/separate-components-assertions.test.ts` — each
  assertion red on a fixture that violates it, green on one that does not. Then one real run,
  its output attached to the pull request.

- [x] **T11** Documentation and release. The install page of the documentation site (English,
  and Polish through the manual i18n workflow) gains the selection table and the three
  single-component commands; a `minor` changeset for `@endora-commerce/cli` names `--only` and
  the four new flags; tick D-284 as accepted in `spec.md` once the owner has ruled.
  Files: `docs/docs/` install page and its Polish twin, `.changeset/`.
  **Test**: `pnpm --filter backend run check:doc-snippets`, `check:docs-translations`,
  `check:release-intent -- --since origin/master`.

## Done when

`pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter '!backend' run test`,
`pnpm --filter backend run test:unit:fast`, the read sizes re-measured if the file count moved,
and one green `acceptance:separate-components` run.
