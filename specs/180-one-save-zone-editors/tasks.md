# Tasks: One Save for every admin editor with zone panels

**Input**: `specs/180-one-save-zone-editors/` — spec.md, plan.md, research.md, data-model.md, contracts/
**Prerequisites**: OQ-1…OQ-11 ruled (2026-11-14); PR #1217 merged. Nothing is blocked on the owner.

**Tests are mandatory** (Principle III): each test task comes before the task it covers and must be
seen failing first. Format: `[ID] [P?] [Story] Description` — `[P]` = parallel-safe.

## Phase 1: Setup

- [x] T001 Branch from `origin/master`; `bash scripts/setup-worktree.sh`; `pnpm run build:packages`

## Phase 2: Foundational — WP-1 API, WP-5 controls (block every editor)

- [x] T010 [P] [US6] Type-level test `packages/admin-kit/src/save-session/save-session.types.test-d.ts`: `saveSession` required on `ProductEditorZoneProps`, `ProductEditorFieldZoneProps`, `CategoryEditorZoneProps`, `OrganizationDetailZoneProps`, `CustomerDetailZoneProps`, `SalesChannelEditorZoneProps`; absent on `ProductEditorSeoZoneProps` and every non-adopting zone (`@ts-expect-error`) — written as `packages/contracts/src/admin-contributions.save-session.test.ts` (`expectTypeOf` + `@ts-expect-error`): admin-kit has no test runner, and contracts already holds its zone type tests there
- [x] T011 [US6] `EditorSaveSessionHandle` and the six `saveSession` props in `packages/contracts/src/admin-contributions.ts`; correct the `category.editor.after` comment (FR-052); rebuild contracts
- [x] T012 [P] [US6] Failing tests `packages/admin-kit/src/save-session/run-save.test.ts`: refusal calls no `save`; all validations run; blocking failure → `not-attempted`; non-blocking failure continues; retry writes only what is left — written as `admin/test/kit/save-session-run.test.ts`, where every admin-kit test lives
- [x] T013 [US6] `packages/admin-kit/src/save-session/run-save.ts`
- [x] T014 [P] [US6] Failing tests `admin/test/kit/save-session.test.tsx`: zone registration; host-owned registration under `hostModule` (and refusal without one); draft survives unmount; clean unmounted entry removed; `loaded` does not overwrite a dirty draft; `writable:false` never dirty; module no longer visible → dropped + notice; boundary crash → dropped + notice; `resetKey` clears; `discardAll`
- [x] T015 [US6] Zone contribution context in `packages/admin-kit/src/zones/AdminZone.tsx`
- [x] T016 [US6] `SaveSessionProvider`, `useSaveSession`, `useSaveParticipant` in `packages/admin-kit/src/save-session/`; explicit exports in `packages/admin-kit/src/lib/index.ts` — plus `INERT_SAVE_SESSION`, which the five hosts pass until their own WP adopts the session
- [x] T017 [P] [US6] Failing tests `admin/test/kit/save-session-controls.test.tsx`: `SaveSessionActions` count / inert / note; `SaveSessionSummary` per outcome, "Show" callback, `role="alert"`, axe clean
- [x] T018 [US6] `packages/admin-kit/src/components/save-session/` (WP-5); exports in `packages/admin-kit/src/components/index.ts`
- [x] T019 [P] [US9] Failing test `admin/test/kit/custom-field-values-participant.test.tsx`: with `saveSession` it registers and renders no Save; without it, unchanged (FR-062)
- [x] T020 [US9] `saveSession` option in `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx`
- [x] T021 [P] `core` strings `saveSession.*` in `packages/modules/_i18n/i18n/{en,pl}.json` — WP-1 shipped the notices and `saveSession.error.moduleOff`; WP-5 the `saveSession.action.*` and `saveSession.summary.*` keys
- [x] T022 Changesets: contracts minor, admin-kit minor

## Phase 3: Product editor — WP-2 + WP-3 (US1–US5, P1)

- [x] T030 [P] [US1] Failing contract test `backend/test/contract/price_lists/base-prices-dry-run.test.ts` (200 nothing stored, 422 as real write, 403, 404, no audit entry)
- [x] T031 [US1] `basePricesDryRunResponseSchema` in `packages/contracts/src/price-books.ts`; `dryRun` in `PriceBookService.setBasePrices` and the route
- [x] T032 [P] [US1] Failing tests `admin/test/modules/catalog/product-editor-one-save.test.tsx` with a test-only participant in `product.editor.pricing.before`: count sums; tab switch keeps draft without prompt; host then participant; participant-only Save sends no scoped-values request
- [x] T033 [US1] `ProductEditor.tsx`: provider keyed by scope; `saveSession` on every product-editor mount and probe; `stagedCount` total into `ProductEditorSaveAction`; `save()` → `session.run(hostPart)`; prompt on the total
- [x] T034 [P] [US2] Failing tests: refusal anywhere → zero writing requests, all errors, summary, "Show" switches tab and focuses
- [x] T035 [US2] `SaveSessionSummary` in the editor's form-error area; `productEditor.save.hostPartLabel` (en, pl)
- [x] T036 [P] [US3] Failing tests: host ok + participant fails → partial, retry sends participant only; host `409` / gate / takeover → participant not written; reload discards all — the 409 case is tested; the gate and takeover refusals take the same blocking path
- [x] T037 [US3] Apply outcomes in the host; `409` reload → `discardAll`
- [x] T038 [P] [US4] Failing tests: participant-only change → Back, scope switch, scope-map link, browser Back open the guard; *Discard* clears participants; `beforeunload` — Back, scope switch, Save-in-guard and `beforeunload` are tested; browser Back and the scope-map link go through the same `hasUnsaved` check
- [x] T039 [US4] Guard conditions on the total
- [x] T040 [P] [US1] Rewrite `admin/test/modules/price_lists/product-base-prices.save.test.tsx` and `product-base-prices.untouched.test.tsx`: no *Save prices*; participates; dry run in validate; not-writable never dirty; "not orderable" stays — rewritten through a page-Save harness (`admin/test/helpers/price-book-screen.tsx`) that renders the panel via the real zone
- [x] T041 [US1] `ProductBasePrices.tsx` → `useSaveParticipant`; remove *Save prices*, status line, own prompt; `basePrices.partLabel` (en, pl); remove unused keys
- [x] T042 [US1] Drop `immediate` from the Pricing heading; assert one Save button on every tab (SC-001) — one Save on every tab except Inventory, whose own Save buttons go in WP-4
- [x] T043 [P] [US5] Failing off-state test `admin/test/modules/price_lists/product-base-prices-off.test.tsx` (off → no panel, no request; switched off while dirty → notice; `503` → part "switched off"; back on → takes part)
- [x] T044 [US6] Failing then passing: operator with base-price write and no `catalog:write` sees Save, which writes base prices only (FR-035)
- [x] T045 Changesets: mod-catalog minor, mod-price-lists minor

## Phase 4: Product Inventory tab — WP-4 (US7)

- [ ] T050 [P] [US7] Failing test `admin/test/modules/catalog/product-editor-inventory-save.test.tsx`: the five settings stage and save with Save; no Save buttons for them; mode no longer auto-saves; per-warehouse rows stay immediate with the badge
- [ ] T051 [US7] Decide the carrier (scoped-values request vs a second blocking host write, `product-editor-save-ui.md` §5) and record it in `research.md`
- [ ] T052 [US7] `ProductInventoryTab.tsx` and the host write; catalog i18n

## Phase 5: Category editor — WP-6 (US8)

- [x] T060 [P] [US8] Failing tests `admin/test/modules/catalog/categories-tree-one-save.test.tsx`: rename + display mode → host then participant; display mode alone → guard on selecting another category; Cancel discards; slug refusal → display mode not written; zone above the Save row — plus partial failure (category saved, mode retried alone) and the browser leave prompt
- [x] T061 [US8] `CategoriesTree.tsx`: provider keyed by category id, zone mount moved, guard, `session.run` on submit, `SaveSessionSummary`; `categories.save.hostPartLabel` (en, pl) — the edit form's fields moved up to the tree so the guard on another row's **Edit** can count them; guard strings `categories.guard.*` (en, pl)
- [x] T062 [P] [US8] Failing tests `admin/test/modules/price_lists/display-mode-row.participant.test.tsx`: no write on change; participates; `saved` suffix gone
- [x] T063 [US8] `DisplayModeOverrideRow.tsx` → participant (`display-mode`, `displayModeRow.partLabel`) — through an optional `saveSession`; without one (organization detail until WP-7) it still saves on change
- [x] T064 [P] [US5] Off-state test: `price_lists` off → category editor shows no row and sends no `pricing` request — in `categories-tree-one-save.test.tsx`; `price_lists` is `nonDeactivatable`, so "off" is the module not installed
- [x] T065 `pnpm run check:admin-zones`; changesets mod-catalog, mod-price-lists (and contracts patch for the corrected zone comment)

## Phase 6: Sales-channel editor — WP-9 (US10, OQ-10 = A)

- [ ] T070 [P] [US10] Failing test `admin/test/modules/sales_channels/sales-channel-editor-one-save.test.tsx`: test-only participant joins the identity Save; leave guard; `ChannelWarehouses` immediate with badge
- [ ] T071 [US10] `SalesChannelEditPage.tsx` provider + submit through `session.run`; badge in `packages/modules/inventory/src/admin/zones/ChannelWarehouses.tsx`; `channelEditor.save.hostPartLabel`
- [ ] T072 Changesets: mod-sales-channels, mod-inventory

## Phase 7: Organization detail — WP-7 (US9, OQ-9 = A, OQ-11 = A)

- [ ] T080 [P] [US9] Failing tests `admin/test/modules/organizations/organization-detail-one-save.test.tsx`: one Save; host part gathers status, VAT status, e-mails, fulfilment strategy, restrictions, custom fields into one `PATCH` with `expectedUpdatedAt`; `VERSION_CONFLICT` writes no panel; panels in zone order; immediate sections keep working with badges; no other Save, no save-on-change / on-blur
- [ ] T081 [US9] `OrganizationDetail.tsx` and `panels/FulfilmentStrategyPanel.tsx`, `panels/RestrictionsPanel.tsx`: drafts into the host part; `SaveSessionActions`, `SaveSessionSummary`; badges; `organizations.detail.save.hostPartLabel`
- [ ] T082 [P] [US9] Failing tests `admin/test/modules/quick_order/default-preferences.participant.test.tsx`, `admin/test/modules/quote_requests/negotiation.participant.test.tsx`
- [ ] T083 [US9] `DefaultPreferencesPanel.tsx` (Save button removed) and `negotiation-panel.tsx` (on-change write removed) as participants; part labels (en, pl)
- [ ] T084 [P] [US5] Off-state tests for `quick_order`, `quote_requests`, `price_lists` on the organization screen
- [ ] T085 Changesets: mod-organizations, mod-quick-order, mod-quote-requests

## Phase 8: Customer detail — WP-8 (US9, OQ-9 = A)

- [ ] T086 [P] [US9] Failing tests `admin/test/modules/customers/customer-detail-one-save.test.tsx`: one Save; custom-fields host part; two participants; immediate actions unchanged with badges
- [ ] T087 [US9] `CustomerDetail.tsx`: provider, `SaveSessionActions`, `SaveSessionSummary`, `CustomFieldValuesPanel saveSession`; `detail.save.hostPartLabel`
- [ ] T088 Changeset: mod-customers

## Phase 9: Docs and records — WP-10

- [ ] T090 Write the approved amendment pointers into `specs/161-price-book-editor/spec.md` FR-020 and `specs/174-product-editor-scope-switcher/spec.md` FR-070 / FR-072 and `contracts/editor-ui.md` §3
- [ ] T091 [P] FR-083 rule in `specs/conventions/module-admin-surfaces.md`
- [ ] T092 [P] Docs EN + PL (and translation pins): `packages/modules/catalog/docs/catalog/editing-a-product-at-a-scope.md` and the categories page, `packages/modules/price_lists/docs/price_lists.md` and `price_lists/price-book-editor.md`, `packages/modules/organizations/docs/organizations.md`, `packages/modules/customers/docs/customers.md`, `packages/modules/quick_order/docs/quick_order.md`, `packages/modules/quote_requests/docs/quote_requests.md`, `packages/modules/sales_channels/docs/sales_channels/`; `check:docs-translations`, `check:module-docs`
- [ ] T093 Verify: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, targeted tests, `pnpm --filter '!backend' run test`, `check:naming`, `check:language`, `check:admin-zones`, `i18n:hardcoded`

## Dependencies

Phase 2 → Phase 3 → Phase 4. Phase 5 after Phase 2 (independent of 3–4). Phase 6 after Phase 2. Phase 7
after Phases 2 and 5 (shares `DisplayModeOverrideRow`); Phase 8 after Phase 7. Phase 9 closes. T030–T031 (backend) may start in parallel with Phase 2.
