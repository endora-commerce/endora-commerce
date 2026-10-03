# Tasks: upgrade an instance from one release to the next

**Feature directory**: `specs/140-instance-upgrade/` — requirements in `spec.md`.

- [x] T001 Measure the upgrade a user would type, on npmjs, from `0.101.0` and from `0.100.2`
  (spec M1…M8).
- [x] T002 Failing tests first — `packages/cli/test/upgrade.test.ts` (FR-001…FR-009) and the
  argv cases in `packages/cli/test/cli.test.ts`.
- [x] T003 `endora upgrade` — `packages/cli/src/upgrade/index.ts`, wired in
  `packages/cli/src/bin/endora.ts` and exported from `packages/cli/src/index.ts`.
- [x] T004 The scaffold declares `"upgrade": "endora upgrade"` and its README names it instead
  of `pnpm update` (FR-009) — `packages/cli/src/new-instance/template.ts`.
- [x] T005 The local-registry acceptance mode holds FR-007 as verdict L23 —
  `backend/scripts/acceptance/instance-local-registry.ts`.
- [x] T006 *Upgrading an instance*, English and Polish, with its translation cache entry; linked
  from *Getting started*, *Module lifecycle*, *Create your first Module*, the root README and
  the CLI README (FR-010).
- [x] T007 Changeset: `minor` for `@endora-commerce/cli` (the release moves in lockstep).
- [x] T008 Prove on npmjs with the branch's CLI tarball: `0.101.0 → 0.101.1` (instance and
  storefront) and `0.100.2 → 0.101.1` (instance; storefront written afterwards), each ending in
  admin sign-in 200, `GET /api/v1/admin/modules` 200 and a demo product rendered.
- [ ] T009 Run the local-registry acceptance mode with `--services` and record L23.

## Not proven here

- An upgrade that applies a **new migration** or installs a **new module**: no published release
  pair to date adds either between `0.100.2` and `0.101.1`, so `setup`'s `migrate` and
  `module:install --all` were measured only as the idempotent no-ops they are on an installed
  instance.
- The verb against a release that raises a third-party peer range (none has yet).
