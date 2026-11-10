# Implementation Plan: Custom-field writes — admin parity, admin access levels and buyer input at registration

**Branch**: `feat/175-buyer-input-custom-fields` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/175-buyer-input-custom-fields/spec.md` (OD-1 – OD-9
binding; SD-1 – SD-3 stand unless the owner overturns them).

## Summary

Three capabilities on the runtime custom-field layer, designed together because they share the
definition, the validator and the admin panel:

1. **Buyer input** — a definition opts in to being written by a buyer on a declared input surface;
   the one surface is B2B registration. `custom_fields` gains a dedicated validator
   (`validateForCustomerInput`, research R-3) that refuses rather than drops, a public read of the
   fields open on a surface (R-7), and two definition columns (R-1). `organizations` validates both
   groups before its first write and stores them in the Organization and account creates (R-5); the
   reference storefront renders the fields generically (R-10); existing storefronts adopt from
   documentation (OD-9).
2. **Admin parity** — the five admin creates that drop values today (category, order, Organization,
   member, quote request) accept them inside their create Command (R-8); a new check,
   `check:custom-field-writes`, holds every host to it through host-owned declarations with reasoned
   exemptions (R-11).
3. **Admin access** — `edit` / `read` / `hidden`, honoured only by the admin panel, which also stops
   writing back values it did not render (R-9).

Plus account anonymisation clears the custom-field bag (R-12). No new dependency (R-13).

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, ioredis (definition-cache
pub/sub), React 19 + admin-kit, Next.js 15 (storefront). **No new runtime, dev or workspace dependency.**
**Storage**: PostgreSQL — two columns on `custom_field_definitions` (data-model §1); host bags unchanged
**Testing**: Vitest — co-located `*.test.ts` in module packages (unit), `backend/test/contract/<module>/`
and `backend/test/integration/<module>/` (HTTP + database), `admin/test/` (admin-kit and module admin),
`storefront/test/`, `backend/test/unit/scripts/` (checks)
**Target Platform**: Linux server (backend), browser (admin SPA, storefront SSR)
**Project Type**: pnpm monorepo — module packages, contracts, admin-kit, cli, backend host, admin, storefront
**Performance Goals**: SC-006 — no measurable p95 change for a registration with no open field; ≤ 50 ms
added with five open fields (definitions come from the per-entity cache; the validator is in-memory)
**Constraints**: anonymous writer (size limits FR-013); FR-024 refusals before the first write; no change
to the administrator's validator semantics; Principle XIV (core stays entity-agnostic)
**Scale/Scope**: 9 supported entity types, 9 host modules touched (5 with code, 3 declarations only,
`customers` declaration only), 1 input surface, 1 migration, 1 new check, ~4 admin screens gain the panel

No `NEEDS CLARIFICATION` remains (Q1 → OD-7, Q2 → OD-9).

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 (verdict at the end).*

| Principle | Assessment | Verdict |
| --- | --- | --- |
| **I. Modular (NN)** | Definitions, validator, public read and migration stay in `custom_fields`; each host changes only its own create path and declares its own writes (R-8, R-11). Cross-module calls go through the already-resolved `customFieldValueService` port (`lazyPort`, contract type) — every touched host already resolves it, so no new edge. `customer_accounts` receives a pre-validated bag through its existing write port (`CustomerAccountCreateInput`), never an import. | Pass |
| **II. API-first** | All shapes land in `packages/contracts/src/{custom-fields,organizations,customer-accounts,catalog,orders,quote-requests,organization-roles}.ts` first (WP-0); every change is additive; contracts bump `minor` (0.x). | Pass |
| **III. TDD (NN)** | Every WP starts with failing tests; the FR → test map is in *Test strategy*. The check gets one red proof per finding kind before it is wired. | Pass |
| **IV. YAGNI / deps** | No new dependency. One surface only; no `extensions` namespace, no Command Bus hooks (spec Out of scope). | Pass |
| **V / VI. TS, naming (NN)** | Columns snake_case (`customer_input`, `admin_access`), contract keys camelCase, migration class scoped `Migration…CustomFields…` by the scaffolder, route segments kebab (`input-surfaces`). `check:naming` covers all four. | Pass |
| **VII. SEO/perf** | Registration page stays a Server Component + server action, works without JavaScript; the field read is cached 300 s with tag revalidation. | Pass |
| **VIII. English (NN)** | All artefacts English; pl strings live in bundles only. | Pass |
| **IX. UI reuse** | Reuses `CustomFieldValuesPanel` (embedded mode exists since feature 143) and the definition editor; storefront uses the existing form primitives. | Pass |
| **X. Queues** | Nothing long-running. | N/A |
| **XI. Tenancy (NN)** | No new tenant-scoped table; values stay on host rows. Registration writes run exactly where they run today (the Organization row is created under the existing registration path; the account through its owner's port). The public read touches platform-global definitions only. No "no-organization" path is introduced. | Pass |
| **XII. Channel scoping (NN)** | The public read is channel-independent by design (definitions are platform-global) and declares `salesChannelAccess: 'open'` like the registration it serves; no channel-scoped content is read. | Pass |
| **XIII. Auditing (NN)** | Definition changes keep running through the existing Commands. Admin creates validate and assign values **inside** their create Command so its audit row names them — keys, never values of a tenant-scoped record (FR-021, D-288). Registration keeps its existing pre-auth `recordAuditFromContext` entry and adds keys, not values (FR-028 — PII). | Pass |
| **XIV. Entity-agnostic** | The registry gains an opaque surface marker of the established kind (`listFilter`, `carryTargets`, `pageBuilderValues`); the core compares names and never reads a host route. Host write declarations live in the hosts. `validateAndMerge`'s semantics are untouched; buyer writes are a separate validator. Proposed PATCH clarification of XIV ("audience governs reads; buyer writes are a separate per-definition opt-in, scoped to declared input surfaces") is recorded as a proposal only — **not adopted** in this feature (owner ruling 2026-11-06). | Pass |
| **XV. Overlay** | The deployment need is met by data (definitions), so no overlay is needed — the intent of the feature. | Pass |
| **XVI. Palette** | No new admin screen; the custom-fields screen stays reachable (`open-custom-fields` action). | Pass |
| **XVII. Toggleable (NN)** | `custom_fields`, `organizations`, `customer_accounts` are `nonDeactivatable` (no off-state). `crm`, `projects`, `tasks`, `quote_requests` are switchable: their routes stay gated as today, their declarations are static manifest exports read by a CI check only, and nothing at runtime consults another host's declaration. The `quote_request` admin-create change sits behind the module's existing gating. Off-state tests already cover those routes; WP-7 adds the create-with-values case to the existing quote-requests off-state assertion. | Pass |

**Gate result (pre-Phase 0): PASS — no violation, Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/175-buyer-input-custom-fields/
├── spec.md
├── plan.md                 # this file
├── research.md             # R-1 – R-13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── custom-field-definitions.md
│   ├── input-surface-read.md
│   ├── registration-and-admin-create.md
│   └── admin-panel-and-check.md
├── checklists/requirements.md
└── tasks.md                # /speckit.tasks
```

### Source code touched (repository root)

```text
packages/contracts/src/
├── custom-fields.ts            # surface + adminAccess enums, definition fields, error codes,
│                               #   port method, input-surface read schema, write-declaration type
├── organizations.ts            # registration groups (+ admin create by derivation)
├── organization-roles.ts       # member direct-create values
├── customer-accounts.ts        # CustomerAccountCreateInput.customFieldValues
├── catalog.ts / orders.ts / quote-requests.ts   # admin create values
packages/modules/custom_fields/
├── src/migrations/<stamp>_custom_fields_definition_customer_input_admin_access.ts
├── src/backend/entities/custom-field-definition.entity.ts
├── src/backend/services/{custom-field-registry,custom-field-definition.service,
│     custom-field-definition-apply,custom-field-value.service}.ts   (+ co-located *.test.ts)
├── src/backend/routes.public.ts            # new — GET /api/v1/custom-fields/input-surfaces/:surface
├── src/backend/index.ts                    # route + storefront revalidator wiring
├── src/admin/components/{DefinitionForm,DefinitionBehaviourFields}.tsx, pages/CustomFieldsPage.tsx
├── src/manifest.ts                         # error-code tokens
├── i18n/{en,pl}.json, docs/custom_fields.md
packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx
packages/modules/customer_accounts/src/backend/services/{customer-account-ports,customer-account-lifecycle-ports}.ts
packages/modules/organizations/
├── src/backend/services/registration-service.ts, src/backend/routes.{public,admin}.ts
├── src/admin/… (New organization form, member direct-create dialog)
├── src/manifest.ts (customFieldWrites), i18n, docs/organizations.md
packages/modules/catalog/      # category create values + panel; manifest declarations
packages/modules/orders/       # admin create values + OrderCreatePage panel; declarations
packages/modules/quote_requests/  # admin create values + RfqCreatePage panel; declarations
packages/modules/{crm,projects,tasks,customers}/src/manifest.ts   # declarations only
packages/cli/src/rules/custom-field-writes.ts, packages/cli/src/check/estate.ts
backend/scripts/check-custom-field-writes.ts, backend/package.json
backend/src/db/migrations-registry.generated.ts      # composer:generate
storefront/app/(auth)/register/{page,actions}.ts(x), storefront/components/auth/RegisterForm.tsx,
storefront/components/auth/CustomFieldInputs.tsx (new), storefront/lib/api/custom-field-input.ts (new),
storefront/lib/i18n/messages/…
specs/conventions/custom-field-writes.md (new) + AGENTS.md routing-table row
docs/i18n/pl/… (pl copies of the two module pages)
```

**Structure Decision**: no new module and no new package. `custom_fields` owns the capability (R-1 –
R-4, R-7); each host owns its write and its declaration (R-8, R-11); the check follows the
two-host rule layout of `action-route-permissions`.

## Design decisions (summary — full text in research.md)

| # | Decision | Rejected |
| --- | --- | --- |
| R-1 | `customer_input jsonb '[]'`, `admin_access varchar(16) 'edit'` on `custom_field_definitions` | boolean per surface; inside `config`; side table |
| R-2 | surface = contracts enum; registry marker `customerInputSurfaces` | free text; runtime contribution |
| R-3 | new port method `validateForCustomerInput` | mode flag on `validateAndMerge`; pre-filtering |
| R-4 | four definition invariants on the resulting state, existing 422 + `details.reason` | silently clearing input |
| R-5 | registration validates both groups before the first write; account owner stores a pre-validated bag | validate in `customer_accounts.create` (after the Organization flush) |
| R-6 | `customFieldValues` inside `organization` and `firstUser`; admin create inherits it | top-level field |
| R-7 | `GET /api/v1/custom-fields/input-surfaces/:surface`, cached 300 s + tag revalidation | served by `organizations`; uncached |
| R-8 | values validated inside each create Command | generic create wrapper in `custom_fields` |
| R-9 | admin access enforced only in the panel + editor; panel sends `edit` keys only | API refusal |
| R-10 | generic `CustomFieldInputs` in the reference storefront, through 173's action state | package component (OD-9) |
| R-11 | host-owned `customFieldWrites` manifest export, one rule / two hosts, nine finding kinds | declarations in the registry; manifest field; per-host tests |
| R-12 | anonymise clears the whole bag | buyer-input keys only |

## Migrations

One, owned by `custom_fields` (data-model §1): scaffold with
`pnpm --filter backend run migration:new -- --module custom_fields --name definition_customer_input_admin_access`,
never a hand-picked number; run `composer:generate`, commit `backend/src/db/migrations-registry.generated.ts`.
Same-module table, no FK, no cross-module SQL; `custom_fields` manifest `dependencies` unchanged. No host
migration: every host bag column exists. Ordering needs nothing: the migration is the module's own and is
ordered by its timestamp within `custom_fields`.

## Work packages (dependency order)

Each WP is owned by one module/package so `/speckit.tasks` can emit it as a block. Within a WP: tests
first (red), then implementation, then the WP's i18n/docs.

| WP | Owner | Content | FRs | Depends on |
| --- | --- | --- | --- | --- |
| **WP-0** | `@endora-commerce/contracts` | all schemas and types of `contracts/*.md`; contract unit tests | II for all | — |
| **WP-1** | `custom_fields` | migration + entity; registry marker; invariants R-4; `validateForCustomerInput`; definitions DTO; public read + revalidation; error-code tokens; i18n; docs | FR-001 – FR-014, FR-029, FR-030, FR-048 (cf part) | WP-0 |
| **WP-2** | `@endora-commerce/admin-kit` + `custom_fields` admin | panel `read`/`hidden` + `edit`-only bag; definition editor options + list badges; i18n | FR-035 – FR-038, FR-040, FR-047 | WP-0 (WP-1 for e2e) |
| **WP-3** | `customer_accounts` | `create` stores `customFieldValues`; `anonymize` clears the bag | FR-025 (account half), FR-041, FR-042 | WP-0 |
| **WP-4** | `organizations` | registration (R-5); admin Organization create + member direct-create values; panel on both create screens; `customFieldWrites` incl. buyer-input; docs incl. storefront adoption (FR-034) | FR-018, FR-022 – FR-028, FR-034, FR-039 (part) | WP-1, WP-3 (WP-2 for screens) |
| **WP-5** | `catalog` | category create values; panel on category create/edit; declarations incl. `product` exemption | FR-016, FR-039 (part) | WP-0, WP-1, WP-2 |
| **WP-6** | `orders` | admin order create values; `OrderCreatePage` panel; declarations | FR-017, FR-039 (part) | WP-0, WP-2 |
| **WP-7** | `quote_requests` | admin create-on-behalf values; `RfqCreatePage` panel; declarations; off-state case | FR-019, FR-039 (part) | WP-0, WP-2 |
| **WP-8** | `crm`, `projects`, `tasks`, `customers` | declarations only (`customFieldWrites`) | FR-020 | WP-0 |
| **WP-9** | check estate (`@endora-commerce/cli` rule, `backend/scripts`, inventory, estate, read size) | `check:custom-field-writes` with nine red proofs; wired into `quality:static` | FR-043 – FR-045, FR-021 (via declarations) | WP-0; green only after WP-4 – WP-8 |
| **WP-10** | reference storefront | open-field read; `CustomFieldInputs`; action state round-trip; error placement; i18n | FR-031 – FR-033, FR-047 | WP-1, WP-4 |
| **WP-11** | governance & docs | `specs/conventions/custom-field-writes.md` + `AGENTS.md` routing row; pl doc translations; changesets; XIV PATCH proposal note | FR-046, FR-047, FR-048 | all |

Parallelism: after WP-0, **WP-1, WP-3, WP-8** run in parallel; after WP-1 + WP-2, **WP-5, WP-6, WP-7**
run in parallel; WP-4 needs WP-1 + WP-3; WP-9 can be written red against fixtures from WP-0 onward and
turns green when WP-4 – WP-8 land; WP-10 after WP-4.

**Merge strategy.** One feature branch; WP-0 and WP-1 first as the base. If the change set is split into
several merge requests, WP-9 lands **last** (or with its declarations), so `quality:static` is never red
on `master`.

## Test strategy (TDD; where each test lives)

Tests sit beside their subjects in module packages (`*.test.ts`, normative per
`specs/106-module-owned-tests/contracts/module-test-ownership.md` §2, a pre-migration record cited by `AGENTS.md`); HTTP + database tests in
`backend/test/contract/<module>/` and `backend/test/integration/<module>/`; admin in `admin/test/`;
storefront in `storefront/test/`; checks in `backend/test/unit/scripts/`.

| FR group | Unit (co-located, no services) | Contract / integration (`backend/test/…`) | UI |
| --- | --- | --- | --- |
| **A** definition attributes | `custom-field-registry.test.ts` (surfaces of each type); `custom-field-definition.service` invariants — one test per reason of R-4, both change directions of FR-003 | `contract/custom_fields/definition-customer-input.contract.test.ts` (create/update round-trip, 422 reasons, defaults on old rows); migration applies on `db:fresh` | — |
| **B** buyer validator | `value-customer-input.test.ts` beside `custom-field-value.service.ts`: closed key, unknown key, other entity's key, required-only-open, trim/empty, 1 000 chars, 50 keys before definition read (stub asserts no call), every value type, `page_builder` never open | — | — |
| **C** admin parity | each host's create service with a stub port (refusal ⇒ nothing persisted) | per host `contract/<module>/admin-create-custom-fields.contract.test.ts` for category, order, Organization, member, quote request: values stored, required refused, audit row names the keys and carries no sentinel value (D-288); quote-requests off-state create answers as absent | — |
| **D** registration | `registration-service` unit with stub ports: validation before any `em.create` (spy order), merged prefixed errors, keys-only audit, port absent ⇒ `not_open_for_input` | `contract/organizations/register-custom-fields.contract.test.ts` (US1, US3 scenarios 1–7, row counts for SC-002 / SC-003 per value type), declared in `customFieldWrites.test`; existing `register.test.ts` unchanged and green (FR-026) | — |
| **E** public read + storefront | route unit (language fallback, empty surface, no internal / value leak) | `contract/custom_fields/input-surface-read.contract.test.ts` (closed store reachable, cache revalidation on definition change) | `storefront/test/register-custom-fields.test.tsx`: each value type renders, required marker, fail-closed read, refused state round-trip without URL data, error placement |
| **F** admin screens | — | — | `admin/test/kit/kit-custom-field-values.test.tsx` (`read`/`hidden` rendering, bag contains only `edit` keys, refusal message for non-`edit` key); definition editor tests in `admin/test/modules/custom_fields/`; each host create screen sends `customFieldValues` |
| **G** personal data | `customer-account-lifecycle-ports` unit: bag cleared, audit `before` and event carry no value | `integration/customer_accounts/anonymize-custom-fields.test.ts` | — |
| **H** checks | rule unit tests over fixture source text, one per finding kind | `backend/test/unit/scripts/check-custom-field-writes.test.ts` (spawned; exit 0 / 1 / 2, read line), inventory and read-size entries | — |

Verification per WP before hand-off: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`,
targeted `vitest run <path>`, and `pnpm --filter '!backend' run test` for the touched packages (AGENTS.md
working agreement). The complete backend suite (`pnpm --filter backend run test`) once before the merge
request, since contract/integration do not run pre-merge (D-198).

## Cross-cutting checklist

- **Permissions**: none new; definition options under `custom_fields:write`, host creates under their
  existing codes (module-admin-surfaces §1).
- **Command palette**: unchanged (`open-custom-fields`).
- **i18n**: `custom_fields` bundle (form options, help sentence, badges, four definition refusals, two value
  codes), host bundles (create-screen labels if any), storefront `messages/` namespace for the field
  section and the two value codes; en + pl; `i18n:hardcoded` stays at baseline.
- **Settings**: none — the capability is configured per definition, not by a setting.
- **Cache invalidation**: existing `b2b:custom_fields:definitions-changed` pub/sub for backend caches;
  storefront tag revalidation through `StorefrontRevalidator` (R-7).
- **Generated artefacts**: `composer:generate` (migration registry, docs copies), `manifests:generate`
  + `pnpm install --lockfile-only` if a module package's imports change (the new manifest export imports
  a contracts *type* only — verify the rendered peers do not move).
- **Read sizes**: record the new check's size from a fresh worktree; leave whole-repo walk drift alone
  unless the band refuses (check-estate § *When a read size is re-recorded*).
- **Docs** (module-documentation): `custom_fields.md` and `organizations.md` in the modules' own `docs/`,
  pl copies under `docs/i18n/pl/` and `check:docs-translations`; no links to sibling module pages or the
  site tree; the convention document routed from `AGENTS.md`'s table (one home, one pointer — the
  `agents-router.test.ts` ceiling applies).

## Changesets (release-intent)

One file per meaning; all `minor` or `patch` (0.x — `major` is refused):

| Package | Bump | Meaning |
| --- | --- | --- |
| `@endora-commerce/contracts` | minor | buyer-input vocabulary, definition fields, value codes, port method, read schema, request fields, declaration type |
| `@endora-commerce/mod-custom-fields` | minor | buyer input, admin access, public read, migration |
| `@endora-commerce/admin-kit` | minor | panel honours admin access; bag carries `edit` keys only |
| `@endora-commerce/mod-organizations` | minor | registration values; admin Organization and member create accept values |
| `@endora-commerce/mod-customer-accounts` | minor | create stores values; anonymisation clears them |
| `@endora-commerce/mod-catalog` | minor | category create accepts values |
| `@endora-commerce/mod-orders` | minor | admin order create accepts values |
| `@endora-commerce/mod-quote-requests` | minor | admin create-on-behalf accepts values |
| `@endora-commerce/mod-crm`, `-projects`, `-tasks`, `-customers` | patch | `customFieldWrites` declaration exported from the manifest |
| `@endora-commerce/cli` | minor | new rule `custom-field-writes` in `endora check` |

`backend`, `admin`, `storefront`, `docs` are ignored applications.

## Risks

1. **Panel bag change** (R-9) alters what every host's custom-fields save sends. Mitigation: all hosts
   merge server-side (verified for organizations, customers, orders, quote requests); WP-2 tests each
   host screen's save once.
2. **Check discovery is bounded** (R-11): an admin create at a brand-new path is invisible until declared.
   Accepted and written into the convention; the owner may ask for more (see below).
3. **Stored `read`/`hidden` value no longer valid** blocks a panel save of other fields (admin validator
   re-checks untouched values). Mitigated by the message only; changing the validator is out of scope.
4. **Non-atomic registration** remains; FR-024 keeps this feature from adding a trigger, and the admin
   member direct-create path validates before `accounts.write.create` for the same reason.
5. **Storefront drift** for instances scaffolded earlier (OD-9) — documented API only.
6. **Shared schema** between registration and admin Organization create (R-6): a test asserts each route
   uses its own validator (FR-023).

## Owner rulings (2026-11-06, after the plan was first written)

- **Check discovery scope — ACCEPTED as designed.** `check:custom-field-writes` discovers an
  undeclared admin write route only at a declared collection path or its `/:id` child; an endpoint
  under a wholly new path is invisible until it is declared. This narrows spec US4 scenario 7, and the
  narrowing is recorded there; the convention document makes declaring a new endpoint the author's
  obligation.
- **Principle XIV PATCH clarification — NOT adopted in this feature.** No constitution change; the
  sentence stays a recorded proposal (*Constitution Check / XIV*) for a later owner decision.
- **`AGENTS.md` "Last updated" line** changed by `update-agent-context.sh` — kept.
- SD-1 – SD-3 stand.

## Complexity Tracking

No constitution violation and no new dependency — nothing to justify.

## Constitution Check — post-design re-evaluation

Re-checked against research R-1 – R-13, data-model and contracts: no design element adds a module,
a dependency, a cross-module import, a tenant-scoped table, a channel-scoped read or an unaudited admin
write. **Verdict: PASS.**

## Hand-off to `endora-commerce-dev`

Start with WP-0 (contracts, tests first), then WP-1 and WP-3 in parallel; follow the WP table. Do not
pick a migration number — scaffold it. Regenerate and commit `composer:generate` output in the same
change. Land WP-9 last or together with all declarations. Report verification output per WP.
