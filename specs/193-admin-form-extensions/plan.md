# Implementation Plan: Admin form extensions — field slots, deployment field overrides, control replacement

**Branch**: `spec/193-admin-form-extensions` | **Date**: 2026-11-27 | **Spec**: `specs/193-admin-form-extensions/spec.md`
**Input**: `spec.md` (FR-001 – FR-127, D-300), `research.md` (R-1 – R-23), `contracts/`,
`data-model.md`.
**Status**: Ruled (D-300). The plan is complete, and `tasks.md` follows from it. The constitution
amendment 4.6.0 is pending the owner's sign-off.

## Summary

Core forms declare their fields once, in contracts, as field sets and admin forms. Three extension
kinds build on those declarations.

- **Slot fields.** Any module may contribute one at an anchor. Its value travels in
  `extensions.<moduleId>`, and the module's own `beforeCommit` hook writes it to the module's own
  storage. The form reads it back on the host's `?extensions=` wire (D-300.1).
- **Field overrides.** A deployment declares them as manifest data, or an installed package does
  under a grant (D-300.2). Composition validates each override against what the field `accepts`.
- **Input controls.** Each declares an output type and is fitted to a field at composition.

Rules that must hold are enforced by one platform **field-rule check**, which runs first in every
declared writer's `beforeCommit` phase, and also on rule-check-only reversible writers. Those rules
are tightened validation, conditional required-ness, control formats and per-field write
permissions. The check binds operator, API-key and system writes. It does not bind buyer
self-service writes (D-300.3), and it does not apply retroactively to existing records (D-300.4).

`custom_fields` gives a business operator a run-time **form layout** screen. It covers presentation
kinds only (label, help, placeholder, position, hidden, read-only), which are stored in its own
table and written by reversible, audited Commands. This layer sits above the deployment code
(D-300.6).

All five hosts adopt in one release (D-300.5). `customer_accounts`, `crm` and `catalog` first
declare the hookable writers they lack. The product editor then adopts section by section, wrapping
its existing scope-aware `EditorField`.

## Technical Context

- **Language/Version**: TypeScript 5.x strict, Node ≥ 22.17; React 19.
- **Primary Dependencies**: existing only. These are Zod, Fastify, MikroORM 7, ioredis pub/sub, and
  the platform's command hooks (176), entity-extension loaders (187) and `ModuleOrigin` (189).
  **No new runtime dependency.**
- **Storage**: one new table, `custom_field_form_layout_overrides` (owned by `custom_fields`).
  Slot data lives in contributors' side tables and D2 columns. The example fixture overlay has one
  side table.
- **Testing**: Vitest unit tests for contracts, the platform, admin-kit and the CLI. Backend contract
  and integration tests per host. A shared vector table. Three-scope accessible-structure snapshots
  for the product editor. A read-only build of the paid PIM admin layers.
- **Performance Goals**: the field-rule check costs one map lookup when no present module adds a
  rule to the set. The operator layer is one query per process per invalidation. Effective forms are
  one request per presence refresh.
- **Constraints**: deterministic layout. Host behaviour is byte-identical with contributors off.
  Composition refusals happen before the first boot hook. The product editor's accessible structure
  is unchanged with no override.
- **Scale/Scope**: five hosts and eight forms. Three modules gain hookable actions. One operator
  screen and one platform screen.

## Constitution Check

The constitution is amended to 4.6.0 (pending sign-off). It is drafted as a delta on #2010's 4.5.0.

| Principle | Verdict | Note |
| --- | --- | --- |
| I Modular (NN) | PASS | Each module owns its data and its writes. The owner opts each field in through `accepts`. The operator layer is `custom_fields`' own. |
| II API-first | PASS | Every shape goes into contracts first. All additions are additive: an `extensions` body field, hookable actions, manifest fields. |
| III TDD (NN) | PASS | `tasks.md` puts a red test before each implementation task. |
| IV YAGNI / deps | PASS | No dependency. No expression language. No operator `default`. No lock flags. No shared Redis cache layer. |
| V / VI / VIII | PASS | — |
| VII SEO | N/A | Admin only. |
| IX UI reuse | PASS | The one new primitive is the layout engine, `DeclaredFormSection`. It is justified because no kit component orders fields from declarations. The operator screen composes reorder, `FormField`, `EditorSection` and the save session. |
| X Queues | N/A | — |
| XI Tenancy (NN) | PASS | Declarations and operator rows are platform-global configuration (`@GlobalEntity`, as `custom_field_definitions` is). Side tables follow their host (187 OR-9). |
| XII Channels (NN) | PASS | Product rules apply per scope. Inheritance is untouched (FR-124). |
| XIII Command Bus (NN) | PASS | Slot writes ride on the host Command. The field-rule check only refuses. Operator writes are reversible Commands. |
| XIV Extensibility | PASS | Operator-added fields stay custom fields. The operator layer reuses the label-map design. |
| XV Overlay | PASS (amended) | The new bullet is this feature's contract. Refusals are contract-gated, and the result is deterministic and auditable. |
| XVI Palette | PASS | Two new actions: "Form extensions" (`_lifecycle`) and "Form layout" (`custom_fields`). |
| XVII Toggleable (NN) | PASS | Everything a module contributes is gated on its presence. The operator layer's owner is non-deactivatable, and rows of absent owners are kept and ignored. |

## Project Structure

### Documentation (this feature)

```text
specs/193-admin-form-extensions/
├── spec.md  research.md  data-model.md  plan.md  tasks.md
├── contracts/
│   ├── form-field-declaration.md   field-slots.md        field-overrides.md
│   ├── input-controls.md           field-rules.md        field-replacement-pattern.md
│   ├── operator-form-layout.md     hookable-writers.md   product-editor-adoption.md
└── checklists/requirements.md
```

The constitution change goes in `.specify/memory/constitution.md` (4.6.0).

### Source code touched (by work package)

```text
packages/contracts/src/admin-forms.ts (+ vectors), admin-contributions.ts, modules.ts            WP-A
packages/contracts/src/{customer-account,opportunity,product}-hooks.ts                           WP-H1..H3
packages/modules/{customer_accounts,crm,catalog}/src/backend/commands/*, manifest.ts             WP-H1..H3
packages/platform/src/forms/*, kernel (fieldSets, fieldFormats, fieldSlotHook), commands hook runner,
  lifecycle/routes.admin.ts (GET /api/v1/admin/forms)                                            WP-B
packages/platform/src/kernel/entity-extensions + schema-extensions/reads.ts (adminReads)          WP-B2
packages/admin-kit/src/lib/forms/*, components/declared-form/*, components/controls/*            WP-C
packages/cli/src/lib/admin-forms.ts, lib/divergence.ts; backend/scripts/check-admin-forms.ts      WP-D
packages/contracts/src/{organization,project,customer-account,opportunity,product}-form.ts       WP-E*/P1
packages/modules/organizations | projects | customers (+customer_accounts) | crm                 WP-E1..E4
packages/modules/catalog/src/admin/** , catalog backend fieldSets                                WP-P1..P7
packages/modules/custom_fields/src/{backend,admin,migrations}, i18n                              WP-L1, WP-L2
packages/admin-shell/src/modules/platform/FormExtensionsPage.tsx                                 WP-F
backend/src/apps/example/modules/form_extension_fixture/                                         WP-G
scripts/check-paid-admin-layers.sh                                                               WP-P1
docs/docs/architecture/admin-form-extensions.md (+pl), customisation-ladder.md (+pl),
  specs/conventions/{contract-surface,module-admin-surfaces}.md                                  WP-DOC
```

## Work packages, in dependency order

| Phase | WP | Owner | Content | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **H1** | customer_accounts | `CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS` (3); `hookData` and `outboxData`; manifest; port forwards `extensions` | — |
| 1 | **H2** | crm | `OPPORTUNITY_HOOKABLE_ACTIONS` (2), same obligations | — |
| 1 | **H3** | catalog | `PRODUCT_HOOKABLE_ACTIONS` (4, including the scoped data); each bulk-edit product write runs as the non-hookable `product.bulk_update.item` (D-300.8), with `hookData` for rule-check-only use | — |
| 1 | **A** | contracts | Declaration types and schemas, conditions and evaluator, vectors, controls and formats, manifest fields, `AdminContributions` arrays, divergence kinds, grants, the `FormLayoutOverrideSource` port and its channel, test-kit schema helper | 189 origin on master |
| 2 | **B** | platform | `FormRegistry.seal` refusals; `ctx.fieldSets` (including `ruleCheckOnly` and `scoped`) and `ctx.fieldFormats`; the field-rule check (ordering-exempt, actor skip, no retroactive `required`); `fieldSlotHook`; formats; `GET /api/v1/admin/forms` with the operator layer and the memo; error codes and bundles; T-B6 API-key scopes; test-kit writer helper | A |
| 2 | **D** | cli + scripts | The `admin-forms` analysis; `check:admin-forms` and its estate obligations; `endora generate`; divergence derivation | A |
| 3 | **B2** | platform | `adminReads` loaders; `?extensions=` reads them; collision refusal | A, B |
| 3 | **C** | admin-kit | Effective-forms provider; layout; `DeclaredFormProvider` and `DeclaredFormSection`; slots; controls; client rules; submission; error mapping | A, B |
| 4 | **E1** | organizations | First adopter: field set and two forms, writers, `extensions` body, render swap | B, B2, C |
| 5 | **E2** | projects | Two forms; `?extensions=` wire on the detail read | E1 |
| 5 | **E3** | customers / customer_accounts | `customer_account` field set (owned by `customer_accounts`) and the `customer.edit` form (declared by `customers`); wire; render swap | E1, H1 |
| 5 | **E4** | crm | Two opportunity forms; wire; render swap | E1, H2 |
| 5 | **P1** | catalog | `PRODUCT_FIELD_SET`, `product.edit`, writers (scoped, rule-check-only `product.bulk_update.item`); record snapshots; paid-layer build script | E1, H3 |
| 6 | **P2 – P6** | catalog | Section MRs: Content, Availability, Identity, Categories, Media | P1 (in order) |
| 7 | **P7** | catalog | Attributes family | P6 |
| 5 | **L1** | custom_fields | Table and migration, entity, Commands (set, reset, rekey), routes, port, cache and invalidation, permission, errors, i18n | B |
| 6 | **L2** | custom_fields | The operator screen, palette, sidebar | L1, C |
| 6 | **F** | admin-shell + `_lifecycle` | `/platform/form-extensions` screen and palette action | B |
| 6 | **G** | example overlay | Fixture: slot, overrides, control, `requiredWhen`, mask, replacement pattern; off-state; 4-path parity on organization; a rule on one product field | E1, P1 |
| 8 | **DOC** | docs + conventions | Architecture page (en + pl), ladder, contract-surface rows, module-admin-surfaces checklist, changesets, upgrade note (additive) | all |

**The cut line.** The release ships with every phase-5 adoption. If the product editor slips, it can
ship with some sections adopted and the rest marked `not-adopted` (R-23). Stopping there is allowed
but not planned.

## Coordination points

- **#2010** (spec 190 docs pass) changes XV first. This branch's constitution text is #2010's 4.5.0
  with this feature's delta on top (4.6.0). Re-apply the delta when #2010 lands.
- **#2005** (notes as custom-field hosts) is independent.
- **187 OR-10** is reopened narrowly by D-300.1. **178 OD-178-6** is closed by E1. Record both in
  those specs' addenda during WP-DOC.
- **Paid modules.** No change is needed. WP-P runs their admin layers' build read-only on every
  catalog MR.

## Complexity Tracking

None. There is no new runtime dependency and no unjustified violation.

## Risks

| Risk | Mitigation |
| --- | --- |
| A writer is missed, so a rule goes unenforced on that path | `accepts-unenforceable`; `expectFieldSetWriters`; R-22's measured table; T002, T006 and T008 verify reversibility |
| The product editor regresses | Wrap without rewriting; three-scope snapshots; unedited existing tests; mount-count test; PIM build; one MR per section |
| One release carries five adoptions | Phases 5 to 7 run in parallel on disjoint files; E1 proves the primitives first; the product cut line |
| Operator and code layers confuse operators | The screen shows every layer with its source, and resets per layer; hidden and read-only are monotone |
| Stale operator layer after a lost subscription | 60-second TTL bound; presentation only, so no rule can be stale |
| The constitution text conflicts with #2010 | The delta is on #2010's text; the report flags it for the coordinator |

## Constitution Check verdict

**PASS.** This depends on the XV amendment to 4.6.0, which is pending the owner's sign-off. IX,
XIII and XVII were reviewed and need no change.

## Handoff summary for `endora-commerce-dev`

Follow `tasks.md` phase by phase. Write each red test before its implementation. Start phase 1:
H1, H2, H3 and A can all begin at once. Run `pnpm run build:packages` first. Then verify with
typecheck, lint, the targeted suites and `pnpm --filter '!backend' run test`. Generated artefacts
(`composer:generate`, `manifests:generate` plus `pnpm install --lockfile-only`, and the admin
registries) are regenerated and committed in the same MR that changes their inputs. The migration in
L1 is scaffolded with `pnpm --filter backend run migration:new`.
