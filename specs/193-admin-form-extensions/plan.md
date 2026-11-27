# Implementation Plan: Admin form extensions — field slots, deployment field overrides, control replacement

**Branch**: `spec/193-admin-form-extensions` | **Date**: 2026-11-27 | **Spec**: `specs/193-admin-form-extensions/spec.md`
**Input**: `spec.md`, `research.md` (R-1 – R-20), `contracts/`, `data-model.md`.
**Status**: Planned against the recommended answers to OQ-193-1 – OQ-193-6. A different answer
changes the work packages named in *Owner-answer sensitivity*; nothing else.

## Summary

Core forms declare their fields once, in contracts (field sets and admin forms). Three extension
kinds build on those declarations: **slot fields** that any module contributes at an anchor, valued in
`extensions.<moduleId>` and written by the module's own `beforeCommit` hook into its own storage;
**field overrides** that a deployment (or a granted package) declares as manifest data, validated at
composition against what each field `accepts`; and **input controls** with declared output types,
fitted to fields at composition. Rules that must hold — tightened validation, conditional
required-ness, control formats, per-field write permissions — are enforced by one platform
**field-rule check** that runs first in every declared writer's `beforeCommit` phase, over a
projection of the writer's hook data the owner registers; the admin reads the same effective rules
from `GET /api/v1/admin/forms` and evaluates conditions with the same pure function. Presentation
(hide, read-only, labels, order, masks, derivations) never reaches access control. Organizations'
create and edit forms adopt first.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17 (backend, platform, CLI); React 19 (admin-kit, admin-shell).
**Primary Dependencies**: existing only — Zod, Fastify, MikroORM 7, `@endora-commerce/platform` command hooks (176), entity-extension loaders (187), module origin (189). **No new runtime dependency.**
**Storage**: none new in core/platform; slot data in contributors' side tables / D2 columns.
**Testing**: Vitest (contracts, platform, admin-kit, CLI unit; backend contract + integration for the organizations adoption and the fixture overlay); shared vector table for client/server parity.
**Target Platform**: platform package, admin SPA, instance CLI.
**Project Type**: monorepo web application (platform + modules + admin).
**Performance Goals**: field-rule check is a map lookup when no present module contributes a rule to the set (the common case); with rules, O(fields with rules) per Command, no I/O except `hasPermission` for changed fields carrying a `writePermission`. One extra admin request per presence refresh (SC-007).
**Constraints**: deterministic layout (SC-005); byte-identical host behaviour with contributors off (SC-004); composition refusals before the first boot hook.
**Scale/Scope**: first release — one host (organizations, 2 forms), one fixture overlay; the platform mechanism complete.

## Constitution Check

| Principle | Verdict | Note |
| --- | --- | --- |
| I Modular (NN) | PASS | Slot data in the contributor's own tables; writes via the contributor's hook; no module imports another's internals; the owner opts each field in (`accepts`). |
| II API-first | PASS | All shapes in `packages/contracts` first (WP-A); host body gains an optional `extensions` (additive). |
| III TDD (NN) | PASS | Every FR maps to a red-first test (handoff list); refusals each have a red test (SC-003). |
| IV YAGNI / deps | PASS | No dependency; no expression language; no `formSlotOrder`; no per-tenant variants; no runtime override editor (OQ-193-6 A). |
| V / VI / VIII | PASS | TS, naming per conventions, English. |
| VII SEO | N/A | Admin only. |
| IX UI reuse | PASS | `DeclaredFormSection` composes `FormField`, `EditorSection`, existing inputs; platform controls wrap existing kit inputs. One new primitive (the layout engine) — justified: no kit component computes a field order from declarations, and composing `FormField` by hand per host is exactly the undeclared JSX the feature replaces. Promoted into admin-kit. |
| X Queue consumers | N/A | No worker. |
| XI Tenancy (NN) | PASS | Declarations carry no tenant data; side tables follow host tenancy (187 OR-9); the check runs on the Command's scoped `em`. |
| XII Channel scoping (NN) | PASS | No channel-scoped read added; product editor scope deferred to its own pass (R-16). |
| XIII Command Bus (NN) | PASS | Slot writes ride the host Command, one audit entry; the field-rule check refuses only, writes nothing, audits nothing, inside a declared hookable action. No bus stage added. |
| XIV Extensibility | PASS | Operator-added fields stay custom fields; coded slots are developer-declared extensions (XIV last bullet). |
| XV Overlay | PASS | Contract-gated (`accepts`, fit table, keys as contract surface), deterministic (layout algorithm), no silent conflict (refusals + documented tie-break), auditable (`form-override` divergence). Recommended PATCH clarification: name "accepted field overrides" in the bounded-surface list (R-9) — not required. |
| XVI Palette | PASS | `_lifecycle` action for `/platform/form-extensions`. |
| XVII Toggleable (NN) | PASS | Everything presence-gated; server-served overrides; off-state tests for the fixture overlay (WP-G). |

**Re-check after design**: PASS, no violation; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/193-admin-form-extensions/
├── spec.md
├── research.md
├── data-model.md
├── plan.md
├── contracts/
│   ├── form-field-declaration.md
│   ├── field-slots.md
│   ├── field-overrides.md
│   ├── input-controls.md
│   ├── field-rules.md
│   └── field-replacement-pattern.md
└── checklists/requirements.md
```

`tasks.md` is **not** produced yet: OQ-193-1, -2 and -5 each add or remove whole work packages
(the read wire, the grant, the second-release hosts), and a task list written before them would be
half wrong. `/speckit.tasks` runs on the answered plan.

### Source code touched (by owner)

```text
packages/contracts/src/
  admin-forms.ts (+ .test.ts, admin-forms.vectors.ts)     WP-A  types, schemas, PLATFORM_INPUT_CONTROLS, FIELD_FORMATS, conditions + evaluator
  admin-contributions.ts                                  WP-A  AdminContributions.fields / controls / fieldBehaviours
  modules.ts                                              WP-A  manifest fieldSets/adminForms/formOverrides/inputControls; formOverrideGrants; DivergenceKind
  organization-form.ts                                    WP-E  ORGANIZATION_FIELD_SET, ORGANIZATION_FORMS
  organizations.ts                                        WP-E  extensions on admin create/patch bodies
packages/platform/src/
  forms/ (registry.ts, seal.ts, field-rule-check.ts, formats.ts, effective-forms.ts)   WP-B
  kernel/ (ModuleContext.fieldSets, fieldFormats; fieldSlotHook on ./kernel)            WP-B
  commands/ hook runner: ordering-exempt platform entry                                WP-B
  kernel/entity-extensions: adminReads on loaders; schema-extensions/reads.ts consults loaders  WP-B2 (OQ-193-1 A)
  lifecycle/routes.admin.ts: GET /api/v1/admin/forms; error codes; i18n                WP-B
packages/admin-kit/src/
  lib/forms/ (provider, layout, submission, client rule eval)                          WP-C
  components/declared-form/ (DeclaredFormProvider, DeclaredFormSection)               WP-C
  components/controls/ (platform controls registry)                                    WP-C
packages/admin-shell/src/modules/platform/FormExtensionsPage.tsx                       WP-F2
packages/cli/src/lib/admin-forms.ts (+ endora generate wiring); lib/divergence.ts      WP-D
backend/scripts/check-admin-forms.ts (+ inventory, estate, read-size entries)          WP-D
packages/modules/organizations/                                                        WP-E  manifest, ctx.fieldSets, routes, OrganizationCreate/Detail render path, tests
backend/src/apps/example/modules/form_extension_fixture/                               WP-G  slot + side table + overrides + replacement pattern + off-state
packages/test-kit/: expectFieldSetMatchesSchemas, expectFieldSetWriters                WP-A/B
docs/docs/architecture/admin-form-extensions.md (+ pl), customisation-ladder.md (+ pl),
specs/conventions/contract-surface.md rows, specs/conventions/module-admin-surfaces.md section  WP-H
```

## Work packages and order

| WP | Owner | Content | Depends on |
| --- | --- | --- | --- |
| **A** | contracts | Declaration types and Zod schemas; condition schema + evaluator + vectors; control and format vocabularies; manifest fields; `AdminContributions` arrays; divergence kinds; `formOverrideGrants`; test-kit helpers (schema half). | 189 `ModuleOrigin` on master |
| **B** | platform | `FormRegistry` + `seal` refusals (field-overrides §3, form-field-declaration §3); `ctx.fieldSets` / `ctx.fieldFormats`; field-rule check as ordering-exempt first `beforeCommit` entry; `fieldSlotHook`; platform format validators; `GET /api/v1/admin/forms`; error codes + `fieldRules.*` bundle (pl+en). T-B6: API-key scope resolution for `writePermission` (R-12 NEEDS CLARIFICATION). | A |
| **B2** | platform | `adminReads` on entity-extension loaders; `?extensions=` consults loaders; collision refusal (187 R-17 tasks 1–5). | A; OQ-193-1 = A |
| **C** | admin-kit | Effective-forms provider beside module presence; layout algorithm; `DeclaredFormProvider` / `DeclaredFormSection`; slot rendering with presence + permission; platform controls; client rule evaluation; submission split; server-error mapping; switched-off slot notice. | A, B (route) |
| **D** | cli + backend scripts | `admin-forms` analysis; `check:admin-forms` (inventory, estate manifest `package`/admin, read-size band, companion test, `quality` job); `endora generate` reader; divergence derivation for `form-override` / `form-override-grant`. | A |
| **E** | organizations | Field set + two forms; manifest; `ctx.fieldSets` writers for `create`, `admin_patch`, `set_custom_field_values` (and `register` per OQ-193-3: listed, skipped for buyer actors); `extensions` on admin POST/PATCH; `?extensions=` loaders path; render-path swap of `OrganizationCreate.tsx` and the detail's editable sections; tests (SC-006 unchanged behaviour). | B, C (B2 if OQ-193-1 A) |
| **G** | example overlay | `form_extension_fixture`: one side table (migration via `migration:new`), one slot on both forms, five overrides (US2), one control replacement (US3), one `requiredWhen` + mask (US4), the replacement pattern (US5); off-state integration test on the deployment's own database (`overlay-notes-fixture-off-state.test.ts` template); 4-path parity test (SC-002). | E |
| **F2** | admin-shell + `_lifecycle` | `/platform/form-extensions` read-only screen; palette action; i18n. | B |
| **H** | docs + conventions | Architecture page + Polish; ladder section; contract-surface rows; `module-admin-surfaces.md` § *Form extensions* (host adoption checklist); upgrade note (additive); changesets. | E, G |
| **Next release** | projects; customers/customer_accounts; crm | Declare hookable writers where missing (FR-081), then adopt (E's recipe). | First release |
| **Later** | catalog | Product field set with existing `fieldPath` keys; scope-aware projection design pass. | OQ-193-5 |

Parallelism: A first; then B, C, D in parallel (C mocks the route until B lands); E after B+C; G and
F2 after E/B; H last. Generated artefacts (`composer:generate`, `manifests:generate`, admin
registries) are regenerated and committed in the MR that changes their inputs.

## Owner-answer sensitivity

| Question | If not the recommendation |
| --- | --- |
| OQ-193-1 = B | Drop B2; each slot module adds an admin read route; C's provider fetches per module. |
| OQ-193-2 = B | Drop `formOverrideGrants` and its two errors; package `formOverrides` refused outright. |
| OQ-193-3 = B/C | Field-rule check step 2 changes (skip system actors / skip nothing); C needs a storefront follow-up. |
| OQ-193-4 = B | Check step 4 evaluates `required` on every write; the guide adds a backfill section. |
| OQ-193-5 = B/C | Add the hookable-action declarations and adoptions for the extra hosts to the first release. |
| OQ-193-6 = B | A new Settings-backed override source + screen; tightened rules stay code-only. |

## Coordination points

- **#2005** (notes as custom-field hosts): independent. Notes are a comment thread, not a declared
  form; a later field set for notes is possible once #2005 lands, not planned here.
- **187 OR-10** is reopened only by OQ-193-1 A, narrowly (adopting hosts, opt-in loaders).
- **178 OD-178-6**: this feature is its named follow-up; record the closure in 178's spec addendum
  when E merges.
- **Paid modules**: none needs a change (R-16). The `paid-modules-consume-kit` rule applies to
  admin-kit additions only as additions.

## Complexity Tracking

None. No new runtime dependency; no constitution violation.

## Risks

| Risk | Mitigation |
| --- | --- |
| A writer is missed, so a rule is unenforced on that path | `accepts-unenforceable` + `expectFieldSetWriters`; host adoption checklist names every Command writing the entity; review. Bounded like `check:custom-field-writes` and stated as such. |
| Render-path swap changes the organization screens' behaviour | SC-006: existing tests unchanged except the render path; designer review of the two screens. |
| Client/server rule drift | One evaluator; shared vectors run in three packages. |
| ReDoS through `pattern` | Deployment- or granted-package-authored (code already trusted on the server); 256-char cap; documented. |
| Product editor adoption harder than estimated | Deferred (OQ-193-5 A); its keys are fixed now so contributors don't wait. |

## Constitution Check verdict

**PASS** — all non-negotiable principles hold by construction; no amendment required; one optional
PATCH clarification to XV recommended with the docs pass.

## Handoff summary for `endora-commerce-dev`

Do not start before the owner answers OQ-193-1 – OQ-193-6; then run `/speckit.tasks`. Start with
WP-A. Red-first tests to write, by FR:

- FR-001/002/003: contracts schema tests; `expectFieldSetMatchesSchemas` on organizations.
- FR-010/011/012: admin-forms analysis unit tests, one red per finding code; shuffled-registration
  layout test (SC-005).
- FR-013/014/016: organizations contract test — POST/PATCH with `extensions`, unclaimed key 422,
  atomic create with fixture side row, one audit entry with `changedFields`.
- FR-020–025: `FormRegistry.seal` unit tests, one red per refusal code (SC-003); effective-forms
  route contract test incl. presence filtering.
- FR-030–033: fit-table tests; `format-without-validator`; platform format vectors.
- FR-040–045: evaluator vectors; field-rule check unit + integration (4-path parity, SC-002).
- FR-050–053, FR-060–062: origin/grant composition tests; off-state integration (SC-004); hidden-field
  API write accepted (I-9); `FIELD_WRITE_FORBIDDEN` on changed field only.
- FR-070–073: divergence derivation test; palette coverage; bundle-shape test; docs build.
- FR-080–082: organizations adoption; PIM-contributor compile check unchanged (`product.editor.field.after`).

Run `pnpm run build:packages` first; verify with typecheck, lint, the targeted suites above and
`pnpm --filter '!backend' run test` for contracts, platform, admin-kit and CLI.
