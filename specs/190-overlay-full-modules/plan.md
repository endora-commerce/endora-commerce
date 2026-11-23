# Implementation Plan: Overlay modules as full modules — schema, build, ports and admin

**Branch**: `spec/190-overlay-full-modules` | **Date**: 2026-11-23 | **Spec**: `specs/190-overlay-full-modules/spec.md`
**Ruling**: D-297 (retires D-106 for overlays; D-106.2 unchanged) | **Umbrella**: #1858

**Note**: `update-agent-context.sh` was deliberately **not** run for this plan: five sibling specs
(186 – 189, 191) are being planned in parallel and each run rewrites the generated appendix of
`AGENTS.md`; the appendix is regenerated once when the first of them merges. The plan adds no runtime
dependency, so the appendix's *Active Technologies* would not change anyway.

## Summary

Make a per-deployment overlay module a full module instead of adding a second "local instance
package" concept. Five additions to what exists, each reusing the package path rather than a parallel
one: (1) a type-check and one deployment-level `tsc` build of `apps/` with a freshness guard;
(2) runtime discovery of overlay entities and migrations, merged with origin `overlay` into the same
merge packages use, every overlay migration under the foreign-schema guard with no exemption, and the
three written-twice schema refusals deleted in lockstep; (3) a boot refusal of any unclassified entity,
whatever its origin; (4) sanctioned type-only port imports and dependencies between overlay modules;
(5) a per-deployment admin registry selected at admin build time, palette coverage per deployment.
A reference overlay in `backend/src/apps/example` (also the side-table worked example) and one
documentation pass, including the constitution XV MINOR amendment and the command-middleware material
from closed #1842, close it.

## Technical Context

**Language/Version**: TypeScript 5.9 strict, Node.js ≥ 22.17 (`erasableSyntaxOnly` available)
**Primary Dependencies**: existing only — MikroORM **7.2.11** with `@mikro-orm/decorators/legacy`
after #1866, Fastify, Vite 8 + Tailwind 4 (admin), `typescript` (already every instance's
devDependency). **No new runtime dependency.**
**Storage**: PostgreSQL; no platform table changes (`data-model.md`)
**Testing**: Vitest (platform, CLI, backend unit/contract/integration, admin), the instance acceptance
fixture (`backend/scripts/acceptance/instance.ts`)
**Target Platform**: platform packages (`packages/platform`, `packages/cli`, `packages/contracts`),
this repository's `backend/` and `admin/` wiring, the instance template
**Project Type**: monorepo — host package + CLI + application wiring
**Performance Goals**: freshness guard ≤ 30 ms for 20 overlay modules (stat only); no extra query at
boot (classification is in-memory)
**Constraints**: D-104 (committed artefacts bare core under every `DEPLOYMENT`); D-52/D-53 (the
platform names no file of the installing tree — every root is supplied); the CLI reads an instance
without loading the platform (walks written twice must agree)
**Scale/Scope**: 12 child issues, 11 work packages; ~6 refusal paths deleted, ~10 added

## Constitution Check

*Pre-design gate and post-design re-check — both PASS.*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | PASS | An overlay owns its entities, migrations, port types, admin, i18n and tests; cross-module only via ports (type-only `ports.ts`, `lazyPort`) and events; promotable to a package with the same id (detachable) |
| II API-first | PASS | No new HTTP API. New in-process shapes are typed in platform / contracts (`data-model.md` §2); `DivergenceKind` widened in `@endora-commerce/contracts` first |
| III TDD (NN) | PASS | Every FR maps to a red-first test in `tasks.md`; every refusal has a provoking and a non-provoking case (SC-002) |
| IV YAGNI / deps | PASS | No new dependency; one CLI subcommand (`endora build overlays`) justified in Complexity Tracking; no second module concept |
| V TypeScript | PASS | Overlay code becomes type-checked (today it is not) |
| VI Naming (NN) | PASS | Migration class names module-scoped (`unscoped-name` refusal unchanged); `check:naming` over new files |
| VII SEO/perf | N/A | No storefront change |
| VIII English (NN) | PASS | All artefacts English; user-facing strings pl + en in module bundles |
| IX UI reuse | PASS | Overlay admin layers render inside the shared shell with the kit; no separate admin app |
| X Queue consumers | PASS | Overlay workers stay `ctx.worker` (BullMQ pattern), gated |
| XI Tenancy (NN) | PASS — strengthened | Boot refusal of any unclassified entity of any origin (FR-020); cross-tenant tests for overlay tables (FR-095); side tables inherit host scoping per 187 |
| XII Channel scoping (NN) | PASS | Overlay reads of channel-scoped content use the same bridge accessors; nothing here bypasses them |
| XIII Command Bus (NN) | PASS | Overlay writes go through Commands; side-row writes through a `beforeCommit` hook (176); no bus wrap introduced — the docs pass moves the bus-wrap example to middleware |
| XIV Extensibility | PASS | Custom fields stay rung D0; overlays get D1/D2 on package terms |
| XV Overlay | PASS with amendment | MINOR amendment (`contracts/constitution-xv-amendment.md`); determinism kept (registries bare core, per-deployment artefacts committed and byte-checked); fail-closed refusals added |
| XVI Palette | PASS — gap closed | Overlay `--action` lifted; coverage per deployment (FR-085) |
| XVII Toggleable (NN) | PASS | Overlay with tables keeps both axes, off-state tests mandatory (FR-046), dependency fail-closed between overlays (FR-072); off is non-destructive (tables kept) |

## Project Structure

### Documentation (this feature)

```text
specs/190-overlay-full-modules/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── checklists/requirements.md
└── contracts/
    ├── overlay-module-layout.md        ├── overlay-ports.md
    ├── overlay-build.md                ├── overlay-admin-layer.md
    ├── overlay-schema-discovery.md     ├── trust-tier.md
    ├── entity-classification-refusal.md├── constitution-xv-amendment.md
    ├── overlay-lifecycle.md            └── docs-pass.md
    └── overlay-cli.md
```

### Source code touched (by owner)

```text
packages/platform/src/
├── overlay/overlay-runtime.ts      # assertOverlayLayout replaces the schema refusal; freshness guard; source root
├── overlay/overlay-schema.ts       # rewritten: overlaySchemaContributionsUnder (refusals deleted)
├── overlay/overlay-layout.ts       # new: nested-module, package-in-disguise
├── overlay/overlay-freshness.ts    # new: pairing + verdicts
├── db/configured-entities.ts       # + overlay entities, + classification refusal call
├── db/configured-migrations.ts     # + overlay contributions, guard without exemptions, ownership
├── db/migration-order.ts           # MigrationOrigin + 'overlay'
├── tenancy/entity-classification.ts# new: UnclassifiedEntityError
├── lifecycle/services/module-origin.ts # trustTierOf (unless 189 lands it)
└── composition/compose-app.ts      # deploymentSourceRoot
packages/cli/src/
├── build/                          # new: `endora build overlays`
├── lib/runtime-assets.ts           # moved from backend/scripts/lib
├── lib/migration-naming.ts         # moved from backend/scripts/new-migration.ts
├── lib/overlay-boundary.ts         # new: one analysis, two readers
├── lib/palette-coverage.ts         # moved from admin/test/unit/palette-coverage.test.ts
├── lib/admin-artefacts.ts          # + deployment registries, + Tailwind overlay sources
├── lib/entity-index-artefact.ts    # + overlay entities
├── lib/divergence.ts               # + column-extension; notRecorded
├── generate/{index,divergence}.ts  # overlaySchemaFiles deleted; new reports
├── new-module/overlay.ts           # refusals lifted
├── new-migration/                  # new: `endora new migration`
└── new-instance/{template,deploy}.ts # tsconfig.apps.json, scripts, wiring roots, admin ARG, README text
packages/contracts/src/modules.ts   # DivergenceKind + 'column-extension'
backend/
├── tsconfig.json · tsconfig.apps.json (new) · package.json (typecheck)
├── src/overlay/overlay-roots.ts    # source root
├── src/db/configured-{entities,migrations}.ts # overlay root to the platform
├── scripts/generate-composer.ts    # refusals → validation; deployment admin registries
├── scripts/new-migration.ts        # --module <overlay-id>
├── scripts/check-module-boundary.ts# overlay-boundary analysis
├── src/apps/example/modules/example_erp_keys/ # new reference overlay
└── test/template-identity.ts       # overlay origin
admin/
├── vite.config.ts · tsconfig.json · src/main.tsx
├── src/deployments/{example,none}.generated.ts (new, committed)
└── test/unit/palette-coverage.test.ts # per deployment, analysis from the CLI
```

**Structure Decision**: extend existing owners — the platform's `overlay/`, `db/`, `tenancy/`,
`lifecycle/`; the CLI's `lib/`, `generate/`, `new-module/`, `new-instance/` — and add no module and no
package. A new module would have no domain to own: this is platform mechanism.

## Work packages and order

```text
                ┌─ WP1 #1847 type-check ── WP2 #1848 build ─────────────┐
 D-297 (this) ──┼─ WP3 #1854 ports + deps                               │
                └─ WP4 #1855 admin layer ───────────────────────────────┤
   ══ gate: #1866 MikroORM 7.2.11 merged ══                             │
                   WP5 #1849 classification refusal ─┐                  │
                                   WP2 ──────────────┼─ WP6 #1850 schema discovery
                                                     │      ├─ WP7 #1851 lifecycle
                                                     │      ├─ WP8 #1852 CLI entities + new migration
                                                     │      └─ WP9 #1853 x_* from overlays
              WP4 + WP6 + 187 (#1834) + #1835 ───────────── WP10 #1856 reference overlay
              WP4 + WP6 + 189 (#1840) + #1841 warning ───── WP11 #1857 docs + constitution XV
```

| WP | Issue | Pre-v7? | Depends on | Merge request content | Breaking for instances |
| --- | --- | --- | --- | --- | --- |
| WP1 | #1847 | yes | — | `tsconfig.apps.json` (noEmit) in both trees, scripts, `workspace-resolution` three programs | no (adds a check) |
| WP2 | #1848 | yes | WP1 | `endora build overlays`, runtime-asset classifier move, wiring roots, freshness guard, layout refusals, `endora upgrade` rewrite | **yes** (OQ-190-1) |
| WP3 | #1854 | yes | — | overlay-boundary analysis + two readers, `--ports`, dependency tests | no |
| WP4 | #1855 | yes | D-297 | deployment registries, Vite selection, Tailwind sources, palette coverage per deployment, `--admin`/`--action` | **yes** (admin wiring, OQ-190-1) |
| WP5 | #1849 | no | #1866 | classification refusal | possible for a third-party package with an unclassified entity (none known) |
| WP6 | #1850 | no | WP2, WP5, #1866 | discovery + merge + guard + **all refusals deleted** + convention sentences | no (adds capability) |
| WP7 | #1851 | no | WP6 | lifecycle tests, status listing, divergence `column-extension`/notRecorded, off-state coverage | no |
| WP8 | #1852 | no | WP6 | `--entities`, `endora new migration`, `migration:new --module <overlay>`, test-kit index | no |
| WP9 | #1853 | no | WP6 | overlay `schemaExtensions` V9 – V11 | no |
| WP10 | #1856 | no | WP4, WP6, 187, #1835 | `example_erp_keys` + tests | no |
| WP11 | #1857 | no | WP4, WP6, #1840, #1841 warning | constitution XV, published pages EN+PL, layout section, middleware ladder | no |

Two developers can run WP1→WP2 and WP3/WP4 in parallel before the v7 switch; WP7/WP8/WP9 are parallel
after WP6. WP6 is the only package that **must** land as one merge request (refusal deletion in
lockstep).

## Coordination points with sibling specs

- **C-1 — trust tier (189).** If `specs/189-command-middleware/` defines `trustTierOf`, WP2/WP4 import
  it; 190 never defines a second one (`contracts/trust-tier.md`).
- **C-2 — side-table divergence kind (187).** 190 adds `column-extension`; the side-table kind is
  187's. WP7 renders it if 187 defines one; if not, WP7 raises it on 187 rather than inventing it.
- **C-3 — side-table origin-agnosticism (187).** WP6's merge must hand overlay entities to 187's
  `extends` checks exactly as package entities; 187's tests over a package fixture are re-run with an
  overlay fixture in WP10.
- **C-4 — extension attributes (#1835).** Owned by a sibling spec (186 or 187); WP10 consumes
  `include: ['extensions.<moduleId>']` as published.
- **C-5 — constitution versions.** 187/188/189 may amend I, XIII or XV first; WP11 chains from
  whatever `master` holds (R-A3 precedent).
- **C-6 — MikroORM 7 (#1866).** Its legacy-decorator import check (OR-7) must include overlay sources
  in both trees (FR-022); if #1866 merges first without them, WP6 widens its population.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| **No new runtime dependency** | — | — (the default answer holds: `typescript` is already an instance devDependency; Vite and Tailwind already in the admin) |
| `endora build overlays` CLI subcommand | `tsc` does not copy runtime assets; a `tsc`-only build loses i18n bundles **silently** (raw palette keys) — R-3 | importing bundles to steer `tsc` (an import with no runtime meaning); reading i18n from sources (second rule, breaks a `dist`-only image) |
| `MigrationOrigin` + `'overlay'` (published union widening) | diagnostics, template digest per origin, `module:status` | reuse `'external'` — a stranger's package and the deployment's module become indistinguishable (R-7) |
| Per-deployment admin registry artefacts | a static bundle needs a file; must not leak another deployment's code | one filtered registry (code leak), env-dependent committed registry (#120) — R-8 |
| Third `tsc` program in `backend/` | `erasableSyntaxOnly` is a program-level option | a lint rule re-implementing the flag (two answers to one question) |

## Risks

1. **Instance wiring change (WP2, WP4).** Deployment root moves to `backend/dist`; `build`/`dev`
   scripts and the admin image change. Mitigation: `endora upgrade` rewrites wiring, the acceptance
   fixture runs the upgrade path, upgrade note; owner placement OQ-190-1.
2. **Refusal deletion leaves a stale test** (WP6). The refusals are asserted in platform, CLI and
   backend contract/integration suites that `test:unit:fast` skips. Mitigation: the grep in
   `overlay-schema-discovery.md` §4 is a task; WP6 dispatches `backend-suite.yml` on its branch
   (D-198) before merge.
3. **Derived ledgers move** — composer artefacts gain `admin/src/deployments/*.generated.ts`; read-size
   bands may move with the file count. Mitigation: re-record only entries the band refuses
   (`check-estate.md`), never compute from a delta.
4. **Admin resolution from `apps/` in an instance** — pnpm does not hoist member dependencies to the
   root; the overlay admin layer must resolve the kit and React. Mitigation: `resolve.dedupe` plus the
   acceptance fixture building an overlay admin layer; `check:singleton-identity` covers the bundle.
5. **MikroORM 7 slip** — WP5–WP11 are gated on #1866. Mitigation: WP1–WP4 deliver value alone (checked
   overlays, ports, admin), so the slip blocks schema only.
6. **Sibling drift** — C-1…C-6 above; each is a named task in `tasks.md` so it cannot be forgotten.
7. **Test template growth** — overlay migrations of `example` create a second template for tests that
   set `DEPLOYMENT=example`. Mitigation: keep those tests few and grouped (OQ-190-3).

## Constitution Check verdict

**PASS.** No principle is violated; XV is amended (MINOR) in WP11 with its Sync Impact Report, and XI,
XVI and XVII are strengthened rather than relaxed. No new runtime dependency.

## Handoff summary for `endora-commerce-dev`

- Start with **WP1** (#1847) and **WP3** (#1854) — both stand alone and may merge before #1866. WP2
  follows WP1; WP4 may run in parallel.
- Do **not** start WP5–WP11 until #1866 has merged; WP6 is one merge request that deletes every schema
  refusal (`contracts/overlay-schema-discovery.md` §4) and greps `backend/test/**` and every package's
  tests for the deleted symbols before finishing; dispatch `backend-suite.yml` on the branch.
- Every convention sentence a WP falsifies changes in that WP's merge request (`contracts/docs-pass.md`).
- Run `composer:generate` + `manifests:generate` + `pnpm install --lockfile-only` whenever an artefact
  or a package manifest moves; commit them together.
- Changesets: platform `minor` (WP2, WP5, WP6), contracts `minor` (WP7), cli `minor` (WP2, WP3, WP4,
  WP8); WP2 and WP4 carry the upgrade note and the `breaking change` label pending OQ-190-1.
- Owner questions open: OQ-190-1 (release placement), OQ-190-2 (demo), OQ-190-3 (nightly leg).
