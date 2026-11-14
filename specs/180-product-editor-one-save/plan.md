# Implementation Plan: One Save for every panel on the product edit page

**Branch**: `spec/407-product-editor-one-save` | **Date**: 2026-11-14 | **Spec**: `specs/180-product-editor-one-save/spec.md`
**Input**: Issue #407; `specs/161-price-book-editor/` (FR-020, R7, OQ-1 = B);
`specs/174-product-editor-scope-switcher/` (FR-070…FR-076, `contracts/editor-ui.md`); PR #1217.

## Summary

Add a save-participation API to `@endora-commerce/admin-kit`: a save session the host editor
provides, a hook with which a zone contribution registers its draft, change count, validation and
save, and one orchestrator (`runSave`) that validates every part first, then writes the host's own
changes and each participant in order through its own module's API. The product editor adopts it:
the one Save (`ProductEditorSaveAction`, #1217) counts and saves participants, one guard covers
the page, and the base-price panel drops *Save prices*. `price_lists` gains a dry-run of its
base-price write so the server's rules are checked before anything is written. No database
change, no new dependency.

## Technical Context

**Language/Version**: TypeScript 5.x strict, React 19 (admin), Node ≥ 22.17 (backend)
**Primary Dependencies**: existing only — admin-kit primitives, Fastify, Zod
**Storage**: none new
**Testing**: Vitest; `admin/test/` (jsdom) for host and panels; co-located `*.test.ts` in
`packages/admin-kit` and `packages/modules/price_lists`; `backend/test/contract/` for the route
**Target Platform**: admin SPA; `price_lists` HTTP API
**Project Type**: monorepo web application
**Performance Goals**: a Save with one participant adds one dry-run and one write request; the
validate phase runs in parallel
**Constraints**: writes stay per module (XIII, issue); zone props contract checked by `tsc`
**Scale/Scope**: one host, one participant in-tree, three packages touched (contracts, admin-kit,
price_lists) plus `catalog` admin

## Constitution Check

| Principle | Verdict | Note |
| --- | --- | --- |
| I. Modular (NN) | Pass | Catalog never names `price_lists`; participation flows through the zone props contract; each module keeps its write path |
| II. API-first | Pass | Handle type in `packages/contracts/src/admin-contributions.ts`; dry-run response schema in contracts first |
| III. TDD (NN) | Pass | Every FR traces to a failing test first (*Traceability*) |
| IV. YAGNI / dependencies | Pass | No dependency; no correlation column (R7); no second host (OQ-8 A) |
| VI. Naming (NN) / VIII. English (NN) | Pass | `check:naming`, `check:language` on this spec |
| IX. UI reuse | Pass | `ProductEditorSaveAction`, `Alert`, `ModalDialog`, `StickyFormActions`; no new primitive (R9) |
| XI. Tenancy (NN) | Pass | No new entity or query; the dry run runs inside the existing tenant-scoped route |
| XII. Channel scoping (NN) | N/A | No channel-scoped read added |
| XIII. Command Bus (NN) | Pass | Each part writes in its module's existing Command; the dry run writes nothing and runs none |
| XVI. Command palette | N/A | No new admin surface; the editor is already reachable |
| XVII. Toggleable modules (NN) | Pass | Participants exist only through `useAdminZone`'s presence filter; module-gone and `503` handled (R8); off-state test in WP-3 |

**Verdict: pass, no violations.** Re-checked after design: unchanged.

## Cross-cutting design

- **Admin permissions**: no new code. Save's visibility follows OQ-6 (R12).
- **Command palette**: nothing new.
- **i18n**: en + pl; kit strings in `core`, labels in `catalog` and `price_lists`
  (`contracts/editor-save-ui.md` §5).
- **Settings**: none.
- **Audit**: one entry per module written (FR-017).
- **Tenancy**: unchanged.
- **Cache invalidation**: unchanged; the base-price write's existing lifecycle invalidation runs as
  today; the dry run invalidates nothing.
- **Migrations**: none.
- **Changesets**: `@endora-commerce/contracts` minor (new prop, required for product-editor zones —
  external contributors to those zones must accept it; it is an addition to props they receive,
  so their code compiles unchanged), `@endora-commerce/admin-kit` minor, `@endora-commerce/mod-catalog`
  minor, `@endora-commerce/mod-price-lists` minor.

## Project Structure

### Documentation (this feature)

```text
specs/180-product-editor-one-save/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── save-participation.md
│   ├── base-prices-dry-run.md
│   └── editor-save-ui.md
├── checklists/requirements.md
└── tasks.md
```

### Source code

```text
packages/contracts/src/admin-contributions.ts          # EditorSaveSessionHandle; saveSession prop
packages/contracts/src/price-books.ts                  # basePricesDryRunResponseSchema
packages/admin-kit/src/save-session/                   # NEW: provider, hooks, run-save.ts (+ tests)
packages/admin-kit/src/zones/AdminZone.tsx             # zone contribution context (module id)
packages/admin-kit/src/lib/index.ts                    # explicit exports
packages/modules/_i18n/i18n/{en,pl}.json               # core saveSession.* keys
packages/modules/catalog/src/admin/pages/ProductEditor.tsx
packages/modules/catalog/src/admin/components/ProductEditorSaveAction.tsx   # from #1217
packages/modules/catalog/src/admin/components/ProductInventoryTab.tsx       # WP-5 only
packages/modules/catalog/i18n/{en,pl}.json
packages/modules/catalog/docs/catalog/editing-a-product-at-a-scope.md (+ PL)
packages/modules/price_lists/src/admin/zones/ProductBasePrices.tsx
packages/modules/price_lists/src/backend/routes.price-books.ts
packages/modules/price_lists/src/backend/services/price-book-service.ts
packages/modules/price_lists/i18n/{en,pl}.json
packages/modules/price_lists/docs/price_lists/price-book-editor.md, price_lists.md (+ PL)
admin/test/kit/save-session.test.tsx
admin/test/modules/catalog/product-editor-one-save.test.tsx
admin/test/modules/price_lists/product-base-prices*.test.tsx
backend/test/contract/price_lists/  (base-prices dry run)
```

**Structure Decision**: extend existing modules and admin-kit; no new module (the session is a
kit concern, not a domain).

## Delivery phases and work packages

| WP | Content | Depends on | Stories |
| --- | --- | --- | --- |
| WP-1 | contracts handle + admin-kit session, hooks, `runSave`, zone context | — | US6 |
| WP-2 | catalog host adoption: provider, props, count, `run`, summary, guard, permission | WP-1, #1217 | US1–US4 |
| WP-3 | `price_lists`: dry run (backend + contracts), base-price panel as participant, off-state test | WP-1 (backend part independent) | US1–US3, US5 |
| WP-4 | docs EN + PL, changesets | WP-2, WP-3 | — |
| WP-5 | *(OQ-7 = B only)* Inventory product-row settings into the host's own write | WP-2 | US7 |

WP-1 and WP-3's backend half may run in parallel. WP-2 and WP-3's admin half must merge together
(one merge request, or WP-3 first with the panel behind the participant API but still rendering
*Save prices* until WP-2 lands — recommended: one merge request for WP-2 + WP-3 admin).

## Requirement → test traceability

| FR | Test |
| --- | --- |
| FR-001, FR-004, FR-005 | `packages/admin-kit/src/save-session/*.test.ts(x)`, `admin/test/kit/save-session.test.tsx` |
| FR-002 | `tsc` (type-level test file `save-session.types.test-d.ts` with `@ts-expect-error`) |
| FR-003 | `admin/test/kit/save-session.test.tsx` (unmount/remount), `product-editor-one-save.test.tsx` (tab switch) |
| FR-010…FR-016 | `run-save.test.ts`, `product-editor-one-save.test.tsx` |
| FR-017 | `backend/test/integration/price_lists/` existing base-price audit test (unchanged) + catalog save audit test (unchanged) |
| FR-020, FR-024 | `admin/test/modules/price_lists/product-base-prices.save.test.tsx`, `product-editor-one-save.test.tsx` (no other Save button: SC-001) |
| FR-021 | `backend/test/contract/price_lists/base-prices-dry-run.test.ts` |
| FR-022, FR-023 | existing `ProductEditor.channels-tab.test.tsx`, `product-editor-immediate-actions.test.tsx`, `product-editor-save.test.tsx` stay green |
| FR-025 | `admin/test/modules/catalog/product-editor-inventory-save.test.tsx` (WP-5) |
| FR-030…FR-033 | `product-editor-one-save.test.tsx` (guard cases), `product-editor-scope-switcher.test.tsx` extended |
| FR-034 | `admin/test/modules/price_lists/product-base-prices-off.test.tsx`, `save-session.test.tsx` (module gone) |
| FR-035 | `product-editor-one-save.test.tsx` (read-only operator with price write) |
| FR-040 | `i18n:hardcoded` ratchet, catalogue parity test |
| FR-041 | `product-editor-a11y.test.tsx` extended (axe) |
| FR-042 | `check:docs-translations`, `check:module-docs` |

## Conflicts with in-flight work

- **PR #1217** (#717) — must merge first; WP-2 edits `ProductEditorSaveAction`'s caller only, not
  its layout.
- No open PR touches `ProductBasePrices.tsx` or the base-price route (checked 2026-11-14).

## Follow-ups (not in this feature)

- Version on the base-price write (R11).
- `inventory` participant for per-warehouse thresholds (OQ-7 C).
- Adoption by other editors (OQ-8).

## Complexity Tracking

No violations; no new runtime dependency.

## Handoff to `endora-commerce-dev`

Blocked on the owner's answers to OQ-1…OQ-8 and on #1217 merging. With the recommendations
accepted: implement WP-1 → (WP-2 + WP-3) → WP-4, then WP-5 if OQ-7 = B. Tests first per
*Traceability*. Run `pnpm run build:packages` after editing contracts / admin-kit; verify with
`pnpm -r run typecheck`, `pnpm -r run lint`, the targeted admin and price_lists tests, and
`pnpm --filter '!backend' run test` for the packages. Commit regenerated artefacts if
`composer:generate` / `manifests:generate` report drift (none expected).
