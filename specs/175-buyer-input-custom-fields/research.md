# Research — feature 175: custom-field writes (admin parity, admin access, buyer input)

Every decision below is stated as **decision → rationale → alternatives rejected**. The spec has no
open `[NEEDS CLARIFICATION]` (Q1 → OD-7, Q2 → OD-9), so this document resolves design unknowns
only. Measured on `origin/master` at `fe8b10ccb`.

## R-1 Where the two definition attributes are stored

**Decision.** Two new columns on `custom_field_definitions`, in one migration owned by
`custom_fields`:

- `customer_input jsonb not null default '[]'::jsonb` — the list of surface names the definition
  is open on (FR-001);
- `admin_access varchar(16) not null default 'edit'` — `edit` | `read` | `hidden` (FR-005).

**Rationale.** It follows the three precedents on the same table exactly: `audience varchar(16)`
(`20261010T090000_custom_fields_definition_audience.ts`), `list_filter boolean`
(`20261019T103522_…`) and `carry_to jsonb default '[]'` (`20261020T110920_…`). A list rather than a
boolean because the spec models surfaces as a set (OD-3) and the next surface must be a data change,
not a migration. Defaults make every existing row read `[]` / `edit` with no backfill (FR-001,
FR-005). No check constraint: none of the three precedents has one, and the value set is enforced by
the Zod contract and the definition service, which is also where the readable refusal comes from.

**Alternatives rejected.**
- *A boolean `customer_input_registration`* — one column per surface turns every future surface into
  DDL, which is what Principle XIV's "runtime extension is data" warns against at the meta level.
- *Packing both into `config` (the opaque host JSON)* — `config` is the host's, which the core
  "stores but never reads for meaning" (Principle XIV); both attributes are read by the core.
- *A side table `custom_field_input_surfaces`* — a join for a list that is always read with its
  definition and is at most a handful of strings.

## R-2 The surface name and where a surface is declared

**Decision.** The surface vocabulary is a Zod enum in `@endora-commerce/contracts`
(`customFieldInputSurfaceSchema = z.enum(['organization.register'])`), and each entity type's entry
in `SUPPORTED_ENTITIES` (`custom-field-registry.ts`) gains an optional
`customerInputSurfaces?: readonly CustomFieldInputSurface[]` marker. `organization` and `customer`
carry `['organization.register']`; no other entry carries one. A helper
`customerInputSurfacesOf(entityType)` mirrors `carryTargetsOf` / `offersListFilter`.

**Rationale.** API-first (Principle II): the name crosses three wires — the definition contract, the
public read and the registration — so it is a contract type. The registry marker is the established
shape for "an entity type offers this option" (`listFilter`, `carryTargets`, `pageBuilderValues`),
and the core only compares names (spec Assumptions), which keeps `no-entity-capability-logic.test.ts`
meaningful.

**Alternatives rejected.** *Free-text surface names* (OD-3 forbids); *surfaces declared by the
surface-owning module at runtime* (a contribution sink) — it would make the definition validator
depend on composition order and on whether `organizations` is composed, for a list that changes only
with a release.

## R-3 The buyer-input validator

**Decision.** A new method on the published value port (`CustomFieldValuePort`,
`packages/contracts/src/custom-fields.ts:639`) and on `CustomFieldValueService`:

```ts
validateForCustomerInput(
  entityType: SupportedEntityType,
  values: Record<string, unknown> | undefined,
  surface: CustomFieldInputSurface,
): Promise<Record<string, unknown>>; // the bag to store on a NEW record
```

Order of work: (1) more than 50 keys → refuse `too_many_keys` before reading definitions; (2) read
definitions from the per-entity cache; (3) every key must be a live definition whose
`customerInput` contains `surface` (and therefore, by the definition invariant, `audience =
customer`, not `page_builder`) — otherwise `not_open_for_input`; (4) for each **open** definition:
trim text, whitespace-only ⇒ empty, empty + required ⇒ `missing_required`, text over 1 000 ⇒
`out_of_range`, otherwise the shared `coerce` (`custom-field-value.service.ts:176`); (5) collect all
errors and throw `CustomFieldValidationError`. There is no "current bag": the surface creates a
record (OD-5), so the method returns a fresh bag.

The error code enum (`CustomFieldValidationErrorDto['code']`) gains `not_open_for_input` and
`too_many_keys`; the HTTP envelope stays the existing 422 `CUSTOM_FIELD_VALUE_INVALID` (FR-014).

**Rationale.** `validateAndMerge` cannot be reused (spec Context: it drops unknown keys and enforces
`required` across every definition). A separate method keeps the administrator's semantics untouched
(the spec's Out of scope forbids changing them) and makes the anonymous path impossible to reach by
passing a flag wrong. Reusing `coerce` keeps the type rules identical (FR-013).

**Alternatives rejected.**
- *A `mode` parameter on `validateAndMerge`* — one boolean away from an anonymous caller getting
  admin semantics.
- *Filtering the patch to open keys before `validateAndMerge`* — that is "drop", which OD-4 forbids,
  and it still enforces closed required fields.
- *Validating inside each host's write* — the registration surface spans two hosts, and FR-024
  requires both groups validated before the first write (R-5).

## R-4 Definition invariants and their refusals

**Decision.** `CustomFieldDefinitionService` create and update (and the `apply*` seam for
host-managed types) enforce, on the *resulting* definition:

| Reason (`CustomFieldDefinitionError`) | Rule | FR |
| --- | --- | --- |
| `customer_input_unsupported` | a named surface is not in the entity type's `customerInputSurfaces` | FR-002 |
| `customer_input_audience` | `customerInput` non-empty and `audience ≠ customer` (raised by either side of the change) | FR-003 |
| `customer_input_value_type` | `customerInput` non-empty and `valueType = page_builder` | FR-004 |
| `admin_access_required` | `required = true` and `adminAccess ∈ {read, hidden}` | FR-006 / SD-2 |

They answer the existing 422 `CUSTOM_FIELD_DEFINITION_INVALID` with `details.reason`, and each reason
gets an en + pl sentence in `custom_fields`' bundle (the `check:error-translations` shape the module's
manifest already documents for `CUSTOM_FIELD_CARRY_INCOMPATIBLE`: declare the tokens the details
carry, or `tokens: []`).

**Rationale.** Checking the resulting state, not the patch, catches both directions of FR-003 (turning
input on with an internal audience, and turning the audience internal under an open field) with one
predicate — the same approach `assertListFilterSupported` takes.

**Alternatives rejected.** *Silently clearing `customerInput` when the audience goes internal* — a
side effect the administrator did not ask for, and an anonymous form changing under them.

## R-5 Registration: validate both groups, then write

**Decision.** In `RegistrationService.registerOrganization`, immediately after the existing
pre-checks and the registry-ticket read and **before** `em.create(Organization, …)`
(`registration-service.ts:173`):

1. `orgValues = await values.validateForCustomerInput('organization', req.organization.customFieldValues, 'organization.register')`;
2. `personValues = await values.validateForCustomerInput('customer', req.firstUser.customFieldValues, 'organization.register')`;
3. both refusals are merged into **one** 422 whose entries are prefixed by group
   (`organization.<key>`, `firstUser.<key>`) so the storefront can place each beside its field;
4. `em.create(Organization, { …, customFieldValues: orgValues })`;
5. `accounts.write.create({ …, customFieldValues: personValues })` — `CustomerAccountCreateInput`
   (`packages/contracts/src/customer-accounts.ts:273`) gains an optional, already-validated
   `customFieldValues`; `customer_accounts` stores it verbatim (it is the host row's owner, the
   validation is `custom_fields`' and was run by the surface owner).

When the port is not composed (`customFieldValues` undefined in the deps,
`organizations/src/backend/plugin.ts:173`) and either group is non-empty, the route answers 422
`not_open_for_input` for every key (FR-027); empty groups pass.

The audit entry `organization.register` gains `customFieldKeys: { organization: string[], customer:
string[] }` and no values (FR-028).

**Rationale.** FR-024 — the pre-existing non-atomic write (Organization flushed before the account)
must not get a new trigger; validating first makes every refusal of this feature land before the
first `INSERT`. The account owner does not re-validate because the definitions it would read are the
same cached ones, and a second validation inside `customer_accounts` would run *after* the
Organization flush — exactly the window FR-024 closes.

**Alternatives rejected.**
- *`customer_accounts` validates in `create`* — runs after the Organization exists (the known defect).
- *A follow-up `setCustomFieldValues` after create* — OD-5 / FR-025.
- *Fixing the non-atomic registration here* — explicitly out of scope; recorded in the spec.

## R-6 Contract placement of the registration values

**Decision.** `registerOrganizationRequestSchema.organization` gains
`customFieldValues: customFieldValuesSchema.optional()` and `firstUser` gains the same. Because
`AdminOrganizationCreateBodySchema` derives from the `organization` member
(`organizations.ts:977`), the admin create inherits the field — which OD-7 now *requires* (FR-018).
The two routes keep different validators (FR-023): the public route calls
`validateForCustomerInput`, the admin route calls `validateAndMerge('organization', {}, values)`.

**Rationale.** One field name everywhere (`customFieldValues`, the name every host already uses —
spec Context table), and the derivation that feature 173 had to route around is now exactly right.

**Alternatives rejected.** *Top-level `organizationCustomFieldValues`* (the `registryLookupId`
shape) — that shape existed to keep a field *out* of the admin create; OD-7 reverses the need.

## R-7 The public read of open fields

**Decision.** `custom_fields` gains `routes.public.ts` with
`GET /api/v1/custom-fields/input-surfaces/:surface`, `config: { salesChannelAccess: 'open' }`
(registration is reachable on a closed store — feature 154, as `organizations/register` is). It
answers `{ data: { surface, entities: { [entityType]: InputField[] } } }`, labels resolved in
`await request.responseLanguage()` with `labelDefault` fallback, ordered by `sortOrder`; an unknown
surface name or a surface no type declares answers `200` with `entities: {}` (FR-030). The storefront
reads it with `revalidate: 300` and a cache tag, and `custom_fields` revalidates that tag through
`StorefrontRevalidator` (`@endora-commerce/platform/http`) whenever a definition of an entity type
that declares a surface changes — the feature-173 pattern
(`packages/modules/organizations/src/backend/index.ts:1149-1153`,
`storefront/lib/api/registry-lookup.ts:36-41`).

"Port not composed" (FR-030) means `custom_fields` is not composed, so the route does not exist; the
storefront's fail-closed read (FR-033) turns the 404 into "no fields". That is the honest mapping —
`custom_fields` is `nonDeactivatable` and required (`CustomFieldValuesPanel.tsx`'s own note), so the
case is a composition, never an operator state.

**Rationale.** The definitions belong to `custom_fields`, so does the read (Principle I); the
registration form needs no Organization-specific knowledge to render fields. Five-minute ceiling
matches spec US2 scenario 5.

**Alternatives rejected.** *Served by `organizations` as part of `registration-options`* — it would
make `organizations` serialise another module's definitions and couple the next surface's owner to
it. *No cache* — the registration page is hot; the definition cache already makes the backend cheap
but the storefront fetch is a network hop per render.

## R-8 Admin parity — the rule and the five gaps

**Decision.** FR-015 as written, with SD-1. Each gap host extends its create request schema with
`customFieldValues: customFieldValuesSchema.optional()` and, inside the **same Command** that creates
the record, calls `validateAndMerge(<type>, {}, values)` and assigns the result to the new row before
its flush, so the creation audit entry carries the values (FR-021, Principle XIII):

| WP | Host | Schema | Create path |
| --- | --- | --- | --- |
| WP-5 | `catalog` | `createCategoryRequestSchema` (`catalog.ts:1365`) | category create in `category-admin.service.ts` |
| WP-6 | `orders` | `adminCreateOrderRequestSchema` (`orders.ts:732`) | `orderCreationAdminService.create` |
| WP-4 | `organizations` | `AdminOrganizationCreateBodySchema` (derived, R-6) | `POST /api/v1/admin/organizations` |
| WP-4 | `organizations` (entity `customer`) | `adminDirectMemberToRoleRequestSchema` (`organization-roles.ts:177`, `.strict()`) | `POST …/members` → `accounts.write.create({ customFieldValues })` |
| WP-7 | `quote_requests` | `adminCreateQuoteRequestSchema` (`quote-requests.ts:622`) | `rfq-admin-service.createOnBehalf` |

All five hosts already resolve `customFieldValueService` lazily for their update paths, so no new
manifest dependency and no new port edge appears (module-composition items 3–4).

**Rationale.** Validation inside the create Command makes "a refused create creates nothing"
automatic (the Command's transaction rolls back) and puts the values in the audit row the Command
already writes.

**Alternatives rejected.** *A generic "create with custom fields" wrapper in `custom_fields`* —
Principle XIV: the generic layer must not write host rows.

## R-9 Admin access in the admin

**Decision.** Enforced in exactly two places, both admin UI:

1. `CustomFieldValuesPanel` (`packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx`)
   filters definitions: `hidden` not rendered, `read` rendered as text with the value (or a dash) and
   no input; in both modes the value it hands to `save` / `onChange` contains **only `edit`-level
   keys** (FR-038). The server merge keeps absent keys (`custom-field-value.service.ts:50`), so
   `read`/`hidden` values survive any panel save, including a concurrent integration write.
2. The definition editor (`DefinitionForm` / `DefinitionBehaviourFields`) gets the selector and the
   definitions list a badge.

No backend route reads `adminAccess` (FR-007); the definitions DTO carries it (FR-009).

**Rationale.** OD-8 — a convenience, not a control. Filtering the patch fixes a real overwrite race
(Context) at the same time.

**Alternatives rejected.** *Server-side refusal of `read`/`hidden` keys on admin routes* — the admin
API is also the integration API (API keys, instance code), which is precisely who writes system
fields; and it would promise a secrecy the lists, filters and exports do not keep.

The edge case "a stored `read`/`hidden` value that no longer validates" (spec) is handled by the
refusal message only: the 422 entry for a non-`edit` field is rendered by the panel as
"<label> (read-only/hidden field) — <reason>; change it on the Custom fields screen", using the
definitions it already loaded.

## R-10 The storefront form

**Decision.** `storefront/app/(auth)/register/page.tsx` fetches the open fields
(`storefront/lib/api/custom-field-input.ts`, fail-closed like `getRegistrationOptions`) and passes
them to `RegisterForm`, which renders a generic `<CustomFieldInputs>` per section: `text` → input,
`number` → `inputMode="decimal"` input, `date` → `type="date"`, `boolean` → checkbox with a hidden
`false` companion (spec edge case: unticked ⇒ `false`), `select` → `<select>` (radio group when ≤ 4
options), `multiselect` → checkbox group. Field names are `cf.organization.<key>` /
`cf.customer.<key>`; `registerFormAction` (`register/actions.ts:62`) parses them back into the two
groups and sends them; the `useActionState` state that feature 173 returns on a refusal — `{ values,
lookup, error }`, everything typed but the password (research R-10 of
`specs/173-registration-registry-lookup/`) — gains the two groups and a per-field error map, so a
refusal round-trips them without the URL (FR-032). Error entries prefixed `organization.` / `firstUser.` (R-5) map to fields.

**Rationale.** No new component library, Server Component + server action as the page already is
(Principle VII), and the reference tree is what new instances copy (OD-9).

**Alternatives rejected.** *A package-published component* — OD-9.

## R-11 The parity check and the buyer-surface check

**Decision.** One rule, two hosts, following the `action-route-permissions` precedent
(`backend/scripts/check-action-route-permissions.ts`: the analysis lives in
`@endora-commerce/cli/rules/…`, the repository host resolves roots, floors and ledgers):

- Rule: `packages/cli/src/rules/custom-field-writes.ts`; repository host:
  `backend/scripts/check-custom-field-writes.ts`, `check:custom-field-writes` in
  `backend/package.json`; an `endora check` estate verdict of `package` (a module package can be
  judged on its own declarations).
- **Declarations** are a named export beside each host's manifest —
  `export const customFieldWrites = [...] satisfies CustomFieldWriteDeclaration[]` in
  `src/manifest.ts`, read as **literal AST nodes** and refused when computed (the `packageLicense`
  precedent in `module-migrations.md`). The type is published by `@endora-commerce/contracts`.
  Entries: `{ entityType, kind: 'create' | 'update' | 'values', method, path, body }`,
  `{ entityType, kind, exempt: '<reason>' }`, and for a buyer surface
  `{ entityType, kind: 'buyer-input', surface, method, path, body, at: 'organization.customFieldValues', test: '<path>' }`.
- **Finding kinds** (one red proof each, check-estate obligations):
  `entity-type-undeclared` (a supported type with no `create` or no `update`/`values` declaration or
  exemption), `create-without-values`, `update-without-values`, `declared-route-missing` (method +
  path not registered by the declaring module, or registered with another body schema),
  `undeclared-write-route` (a `POST` at a declared create's path or a `PATCH`/`PUT` at
  `<that path>/:id` in the declaring module that no declaration names), `exemption-without-reason`,
  `surface-without-contract`, `surface-without-test` (the named test file must exist and mention the
  surface name and `not_open_for_input`).
- **Contract introspection**: the host imports the built `@endora-commerce/contracts` (a precondition
  of every run, AGENTS.md) and unwraps `ZodEffects`/`ZodOptional`/`ZodDefault`/`ZodObject` to find a
  `customFieldValues` key (at the dotted `at` path for buyer input); a `values` endpoint's body must be
  the record schema itself.
- **Population and read size**: population = `supportedEntityTypeSchema.options` (independent
  source) × the manifest index's modules; read line
  `files=<manifests+route files opened> sites=<declarations> sources=entity-types:9/9,manifest-index:N/N`;
  exit 2 on an empty or short walk.
- Initial exemptions: `product` create and update (host-managed; values are catalog attribute values),
  `customer` invitation (`POST …/members/invite` creates no account).

**Rationale.** A declaration owned by the host keeps the generic core free of host routes
(Principle XIV) and travels with the module when it is a package. Reading the body schema from the
route and the shape from the built contract avoids re-implementing Zod's `.extend()/.partial()`
derivations in AST.

**Known limit — accepted by the owner (ruling 2026-11-06), narrowing spec US4 scenario 7.** The check discovers an *undeclared* write route only at a
declared collection path or its `/:id` child (US4 scenario 7). A create endpoint at an entirely new
path is invisible until declared; the convention document (FR-046) makes declaring it the author's
obligation. Discovering every admin write route that creates a host row would need a data-flow
analysis from route to `em.create(<Entity>)`, which no check in the estate does.

**Alternatives rejected.** *Declarations in the `custom_fields` registry* — host routes in the generic
core. *A new `ModuleManifest` field* — widens `defineModuleManifest` for a CI-only fact. *A test per
host instead of a check* — nine tests that each must remember to exist; the check fails on the one
nobody wrote.

## R-12 Personal data

**Decision.** `CustomerAccountLifecycleWritePort.anonymize`
(`customer-account-lifecycle-ports.ts:463-480`) sets `account.customFieldValues = {}` with the other
scrubs. The audit `before` stays `{ email }` and the event stays ids-only — neither gains a value
(FR-042). The registration audit records keys only (R-5).

**Alternatives rejected.** *Clearing only buyer-input keys* — spec Assumptions: the whole bag.

## R-13 Dependencies

**Decision.** No new runtime, dev or workspace dependency (Principle IV). Everything above uses Zod,
MikroORM, Fastify, React and the existing `StorefrontRevalidator`, `CustomFieldValuesPanel` and
check-estate libraries.
