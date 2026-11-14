# Tasks: One Save for every panel on the product edit page

**Input**: `specs/180-product-editor-one-save/` — spec.md, plan.md, research.md, data-model.md, contracts/
**Prerequisites**: PR #1217 merged; owner answers to OQ-1…OQ-8 recorded in spec.md *Clarifications*.
Tasks are written to the recommendations; a different answer changes the tasks marked with its OQ.

**Tests are mandatory** (Principle III): each test task comes before the task it covers and must
be seen failing first.

Format: `[ID] [P?] [Story] Description` — `[P]` = parallel-safe (different files, no dependency).

## Phase 1: Setup

- [ ] T001 Branch from `origin/master` after #1217 merged; `bash scripts/setup-worktree.sh`; `pnpm run build:packages`
- [ ] T002 Record the owner's OQ answers in `specs/180-product-editor-one-save/spec.md` *Clarifications* and adjust FR-013/014/022/025/033/035/043 if any answer differs from the recommendation

## Phase 2: Foundational — WP-1 (blocks every story)

- [ ] T010 [P] [US6] Type-level test `packages/admin-kit/src/save-session/save-session.types.test-d.ts`: `saveSession` required on `ProductEditorZoneProps` / `ProductEditorFieldZoneProps`, absent on `ProductEditorSeoZoneProps` and on non-product zones (`@ts-expect-error`)
- [ ] T011 [US6] Add `EditorSaveSessionHandle` and the `saveSession` prop in `packages/contracts/src/admin-contributions.ts` (contracts/save-participation.md §1); rebuild contracts
- [ ] T012 [P] [US6] Failing tests `packages/admin-kit/src/save-session/run-save.test.ts`: refusal calls no `save`; all validations run; blocking failure stops with `not-attempted`; non-blocking failure continues; `stopOnFailure`; outcome kinds
- [ ] T013 [US6] Implement `packages/admin-kit/src/save-session/run-save.ts`
- [ ] T014 [P] [US6] Failing tests `admin/test/kit/save-session.test.tsx`: register via `useSaveParticipant` inside `AdminZone`; draft survives unmount/remount; clean unmounted entry removed; `loaded` does not overwrite a dirty draft; `writable:false` never dirty; module no longer visible → entry dropped + notice; boundary crash → dropped + notice; `resetKey` change clears; `discardAll`; outside `AdminZone` throws
- [ ] T015 [US6] Zone contribution context (module id) in `packages/admin-kit/src/zones/AdminZone.tsx`
- [ ] T016 [US6] Implement `SaveSessionProvider`, `useSaveSession`, `useSaveParticipant` in `packages/admin-kit/src/save-session/`; explicit exports in `packages/admin-kit/src/lib/index.ts`
- [ ] T017 [P] [US6] `core` strings `saveSession.*` in `packages/modules/_i18n/i18n/en.json` and `pl.json`
- [ ] T018 [US6] Changesets: contracts minor, admin-kit minor

## Phase 3: US1 + US2 + US3 — one Save, validate first, per-part failure (P1) — WP-2 + WP-3

- [ ] T020 [P] [US1] Failing contract test `backend/test/contract/price_lists/base-prices-dry-run.test.ts`: `200 {valid:true}` and nothing stored; `422` same as real write; `403` for a non-`all` scope; `404`; no audit entry
- [ ] T021 [US1] `basePricesDryRunResponseSchema` in `packages/contracts/src/price-books.ts`; `dryRun` in `PriceBookService.setBasePrices` and the route (`packages/modules/price_lists/src/backend/`)
- [ ] T022 [P] [US1] Failing tests `admin/test/modules/catalog/product-editor-one-save.test.tsx` with a test-only participant in `product.editor.pricing.before`: count sums; tab switch keeps draft without prompt; Save writes host then participant; participant-only Save sends no scoped-values request (SC-006: no catalog change needed beyond WP-2)
- [ ] T023 [US1] `ProductEditor.tsx`: `SaveSessionProvider` keyed by scope; `saveSession` on every product-editor mount and probe; `stagedCount` total; `save()` → `session.run(hostPart)`; `useUnsavedChangesPrompt` on the total (contracts/editor-save-ui.md §1)
- [ ] T024 [P] [US2] Failing tests in `product-editor-one-save.test.tsx`: a refusing participant and a required-empty host field → no writing request, both errors, summary lists parts, "Show" switches tab and focuses (SC-003)
- [ ] T025 [US2] Summary rendering in `ProductEditor.tsx` (contracts/editor-save-ui.md §2) with `catalog` key `productEditor.save.hostPartLabel` (en, pl)
- [ ] T026 [P] [US3] Failing tests: host ok + participant fails → partial summary, host staged cleared, participant kept, next Save sends only participant (SC-004); host `409` / gate / takeover → participant not written
- [ ] T027 [US3] Apply outcomes in the host (clear staged on host success, keep on failure); `409` reload calls `discardAll`
- [ ] T028 [P] [US1] Rewrite `admin/test/modules/price_lists/product-base-prices.save.test.tsx` and `product-base-prices.untouched.test.tsx`: no *Save prices*; participates; validate calls dry run; read-only (not writable) never dirty; "not orderable" text stays
- [ ] T029 [US1] `ProductBasePrices.tsx` → `useSaveParticipant` (contracts/editor-save-ui.md §4); remove *Save prices*, its status line and own prompt; `basePrices.partLabel` in `packages/modules/price_lists/i18n/{en,pl}.json`; remove now-unused keys
- [ ] T030 [US1] Drop `immediate` from the Pricing `SectionHeading` (FR-024); assert in `product-editor-one-save.test.tsx` that the page renders exactly one Save button on every tab (SC-001)
- [ ] T031 [US1] Changesets: mod-catalog minor, mod-price-lists minor

## Phase 4: US4 — one guard (P2)

- [ ] T040 [P] [US4] Failing tests: participant-only change → Back, scope switch, scope-map link, browser Back each open *Save / Discard / Stay*; *Save* navigates only on `saved`; *Discard* clears participants; `beforeunload` registered
- [ ] T041 [US4] Guard conditions on the total in `ProductEditor.tsx`; *Discard* → `discardAll()`

## Phase 5: US5 — off modules (P2)

- [ ] T050 [P] [US5] Failing off-state test `admin/test/modules/price_lists/product-base-prices-off.test.tsx`: `price_lists` off → no panel, no `price-books` request, count excludes it; switched off while dirty → notice, count drops; write `503 MODULE_DISABLED` → part not saved with "switched off"; switched back on → takes part again (SC-005)
- [ ] T051 [US5] Fix whatever T050 shows (expected: nothing beyond T016's presence re-check and the `MODULE_DISABLED` mapping)

## Phase 6: US6 permissions (P2)

- [ ] T060 [P] [US6] Failing test: operator without `catalog:write` but with base-price write sees Save, which writes base prices only; without either, no Save (OQ-6)
- [ ] T061 [US6] Save visibility `canWrite || session.hasWritableParticipant` in `ProductEditor.tsx`

## Phase 7: US7 — Inventory product-row settings (P3, only if OQ-7 = B)

- [ ] T070 [P] [US7] Failing test `admin/test/modules/catalog/product-editor-inventory-save.test.tsx`: the five product-row settings stage and save with Save; no Save buttons for them; mode change no longer auto-saves; stock levels and warehouse thresholds keep their immediate actions with the badge
- [ ] T071 [US7] Carry the settings in the host's own write (scoped-values request at Global, or a host-owned participant if the scoped-values contract cannot take them without a version bump — decide in the merge request and record in research.md)
- [ ] T072 [US7] Update `ProductInventoryTab.tsx` and the catalog i18n

## Phase 8: Polish — WP-4

- [ ] T080 [P] Extend `admin/test/modules/catalog/product-editor-a11y.test.tsx` (axe) with the summary states
- [ ] T081 [P] Docs: `packages/modules/catalog/docs/catalog/editing-a-product-at-a-scope.md`, `packages/modules/price_lists/docs/price_lists/price-book-editor.md`, `packages/modules/price_lists/docs/price_lists.md` and their PL pages; refresh translation pins; `check:docs-translations`, `check:module-docs`
- [ ] T082 Amend `specs/161-price-book-editor/spec.md` FR-020 and `specs/174-product-editor-scope-switcher/spec.md` FR-070 / FR-072 and `contracts/editor-ui.md` §3 with pointers to this feature (spec.md *Amendments*)
- [ ] T083 Verify: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, targeted admin and price_lists tests, `pnpm --filter '!backend' run test`, `check:naming`, `check:language`, `i18n:hardcoded`

## Dependencies

T001 → T002 → Phase 2 → Phases 3–6 (Phase 3 first; 4–6 in any order after T023) → Phase 7 (optional) → Phase 8.
T020–T021 (backend) may start in parallel with Phase 2.
