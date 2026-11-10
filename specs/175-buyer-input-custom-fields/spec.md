# Feature Specification: Custom-field writes — admin parity, admin access levels and buyer input at registration

**Feature Branch**: `feat/175-buyer-input-custom-fields`
**Created**: 2026-11-06
**Status**: Draft
**Input**: Owner request (2026-11-06, translated): a deployment scaffolded with
`npx create-endora-commerce`, which cannot edit core, needs extra data captured when a business
registers on the storefront — for example *how did you hear about us* on the Organization and a
*phone number* on the registering person. An administrator should be able to define such fields
and put them on the registration form without anyone writing code in the instance.
Widened the same day by two owner decisions (see *Clarifications*, OD-7 and OD-8): every admin
create and update endpoint of every custom-field host accepts the values, and a definition can be
marked read-only or hidden in the admin panel.

**Related**: `specs/055-custom-fields-layer/` (runtime custom fields, Principle XIV) —
pre-migration, cited for provenance; it reaches this tree as `packages/modules/custom_fields/`.
`specs/173-registration-registry-lookup/` (the registration form's no-JavaScript round trip,
FR-013 / FR-017, and the `registryLookupId` precedent for keeping a registration-only member out of
the admin create body). `specs/162-custom-fields-value-carry/` and `specs/157-custom-fields-list-filters/`
(per-entity registry markers that a definition may only use where its entity type offers them).
`specs/conventions/check-estate.md` (obligations of a new static check and its escape hatch).

## Context

Measured on `origin/master` at `fe8b10ccb`:

- **Custom fields are written by administrators only.** Every write path calls
  `CustomFieldValueService.validateAndMerge`
  (`packages/modules/custom_fields/src/backend/services/custom-field-value.service.ts:44`) from an
  admin route. The merge starts from the stored bag, so a key absent from a patch keeps its stored
  value (`:50`), but it re-validates every definition, including ones the patch did not touch
  (`:53-73`).
- **A definition's `audience` governs reads, not writes.** `customer` means the value is part of
  what a non-administrator *reads* (`packages/contracts/src/custom-fields.ts:57-70`,
  `projectForCustomer` at `custom-field-value.service.ts:106`). Nothing lets a buyer write.
- **The admin validator cannot be reused for an anonymous writer.** It ignores keys that have no
  definition (`custom-field-value.service.ts:41`), so a value would be silently dropped, and it
  enforces `required` across *every* definition of the entity type (`:59`), so one required
  internal field would make every registration fail. Text is capped at 10 000 characters
  (`:24`), which is an administrator's limit, not an anonymous form's.
- **The supported entity types** are `category`, `order`, `organization`, `customer`,
  `quote_request`, `product`, `opportunity`, `project` and `task`
  (`packages/contracts/src/custom-fields.ts:15-34`). `product` is host-managed: its definitions are
  catalog attributes, edited only on `/catalog/attributes`, and its values live in
  `products.attribute_values` (`packages/modules/custom_fields/src/backend/services/custom-field-registry.ts:96-107`,
  `host-storage-binding.ts`). The `customer` entity type is the **customer account**
  (`customer_accounts.custom_field_values`).
- **Admin write endpoints today** — every host that takes values names the field
  `customFieldValues`:

  | Entity type | Admin create | Values on create | Admin update | Values on update |
  | --- | --- | --- | --- | --- |
  | `category` | `POST /api/v1/admin/catalog/categories` (`packages/modules/catalog/src/backend/routes.admin.ts:1213`) | **no** (`createCategoryRequestSchema`, `packages/contracts/src/catalog.ts:1365`) | `PATCH …/categories/:id` (`:1227`) | yes (`catalog.ts:1404`) |
  | `order` | `POST /api/v1/admin/orders` (`packages/modules/orders/src/backend/routes.ts:857`) | **no** (`adminCreateOrderRequestSchema`, `packages/contracts/src/orders.ts:732`) | no general update; `PATCH …/orders/:id/custom-fields` (`routes.ts:261`) | yes, dedicated endpoint |
  | `organization` | `POST /api/v1/admin/organizations` (`packages/modules/organizations/src/backend/routes.admin.ts:531`) | **no** (`AdminOrganizationCreateBodySchema`, `packages/contracts/src/organizations.ts:977`) | `PATCH …/organizations/:id` (`routes.admin.ts:357`) | yes (`organizations.ts:333`) |
  | `customer` | `POST /api/v1/admin/organizations/:id/members` (`organizations/src/backend/routes.admin.ts:787`) | **no** (`adminDirectMemberToRoleRequestSchema`, `packages/contracts/src/organization-roles.ts:177`) | `PATCH …/members/:customerAccountId` (`routes.admin.ts:918`) has none; `PATCH /api/v1/admin/customers/:id/custom-fields` (`packages/modules/customers/src/backend/routes.admin.ts:182`) | yes, dedicated endpoint |
  | `quote_request` | `POST /api/v1/admin/quote-requests` (`packages/modules/quote_requests/src/backend/routes.admin.ts:129`) | **no** (`adminCreateQuoteRequestSchema`, `packages/contracts/src/quote-requests.ts:622`) | `PATCH …/quote-requests/:id` (`:145`) | yes (`quote-requests.ts:718`) |
  | `opportunity` | `POST /api/v1/admin/crm/opportunities` (`packages/modules/crm/src/backend/routes/routes.opportunities.ts:78`) | yes (`packages/contracts/src/crm.ts:396`) | `PATCH …/opportunities/:id` (`:99`) | yes (`crm.ts:404`, derived) |
  | `project` | `POST /api/v1/admin/projects` (`packages/modules/projects/src/backend/routes/routes.projects.ts:64`) | yes (`packages/contracts/src/projects.ts:268`) | `PATCH …/projects/:id` (`:80`) | yes (`projects.ts:285`) |
  | `task` | `POST /api/v1/admin/tasks` (`packages/modules/tasks/src/backend/routes/routes.tasks.ts:132`) | yes (`packages/contracts/src/tasks.ts:400`) | `PATCH …/tasks/:id` (`:146`) | yes (`tasks.ts:423`) |
  | `product` | host-managed — values are catalog attribute values on `catalog`'s own product surfaces | — | — | — |

  Five creates take no values; every update does, two of them through a dedicated endpoint.
- **Admin screens.** The shared panel
  `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx` is on the
  detail screens of Organizations, customers, orders, quote requests, opportunities, projects and
  tasks, and on the create screens of opportunities, projects and tasks. It is on no category
  screen and on none of the order, quote-request, Organization or member create screens
  (`packages/modules/orders/src/admin/pages/OrderCreatePage.tsx`,
  `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx`). It initialises its draft
  from the whole stored bag (`CustomFieldValuesPanel.tsx:106`) and saves the whole draft (`:143`),
  so a save writes back every key it loaded, including values it never displayed as changed.
- **The public registration endpoint** is `POST /api/v1/organizations/register`
  (`packages/modules/organizations/src/backend/routes.public.ts:99`), body
  `registerOrganizationRequestSchema` (`packages/contracts/src/organizations.ts:187`), from whose
  `organization` member `AdminOrganizationCreateBodySchema` is derived.
- **Registration is not atomic.** `RegistrationService.registerOrganization` flushes the
  Organization (`packages/modules/organizations/src/backend/services/registration-service.ts:186`)
  before it asks the account owner to create the account (`:213`, through
  `CustomerAccountCreateInput`, `packages/contracts/src/customer-accounts.ts:273`). A refusal at the
  second step leaves an Organization without a member. This feature does not fix that (see
  *Out of scope*), but it must not add a new way to trigger it.
- **Anonymisation does not touch custom-field values.** `anonymize`
  (`packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts:463-480`)
  scrubs e-mail, names, password and second factor, and leaves `customFieldValues` as it was. A
  phone number stored there would survive the scrub.
- **None of the three registration modules can be switched off.** `custom_fields`
  (`packages/modules/custom_fields/src/manifest.ts:154-155`), `organizations`
  (`packages/modules/organizations/src/manifest.ts:366-367`) and `customer_accounts`
  (`packages/modules/customer_accounts/src/manifest.ts:114-115`) all declare
  `nonDeactivatable`. The value port is nevertheless optional in `organizations`' composition
  (`packages/modules/organizations/src/backend/plugin.ts:173`). The hosts `crm`, `projects`,
  `tasks` and `quote_requests` can be switched off, and their entity types follow them
  (`custom-field-registry.ts:151-154`).
- **The instance's storefront is a copy the deployment owns.** `endora new storefront` copies the
  reference tree and tells the operator *"this storefront is yours now. There is no kit to
  upgrade"* (`packages/cli/src/new-storefront/index.ts:527`). The registration page is
  `storefront/app/(auth)/register/page.tsx`.

## Clarifications

### Decisions taken with the owner (binding — not reopened here)

- **OD-1 Audience stays a read rule.** A definition's `audience` keeps its meaning. Whether a buyer
  may **write** a field is a separate, per-definition, opt-in attribute ("buyer input"), whose
  value names the input surfaces the field is open on; the default is none.
- **OD-2 Buyer input implies buyer visibility.** A definition open on any surface MUST have the
  `customer` audience: a buyer is never asked to supply a value they may not read back.
- **OD-3 Surfaces are declared, not free text.** An entity type offers buyer input only on the
  surfaces its registry entry declares, as it already offers list filters or carry targets. In this
  feature `organization` and `customer` declare one surface, *organization registration*.
- **OD-4 Refuse, never drop.** A value the buyer may not write on that surface is refused with the
  field named; it is never silently ignored.
- **OD-5 One write with the host row.** Values are written as part of creating the record, not in
  a later update — at registration and on every admin create.
- **OD-6 Zero code in the instance.** An administrator defines the fields and opens them on the
  registration surface; the reference storefront renders whatever is open, generically.
- **OD-7 (was Q1) Admin parity, everywhere.** Every admin create and every admin update endpoint
  of every supported entity type accepts custom-field values, validated with the administrator's
  rules; the admin "New organization" create is one of them. A static check keeps it so, with a
  reasoned exemption mechanism.
- **OD-8 Admin access levels (variant A).** A definition carries an admin access level — `edit`
  (default), `read` or `hidden` — for "system" fields that integrations or instance code maintain
  and an administrator should not change by accident. It is a **convenience of the admin panel,
  not an access control**: the API accepts the values whatever the level.
- **OD-9 (was Q2) Existing storefronts adopt through the documented API.** An instance scaffolded
  before this feature owns its storefront copy and does not receive the generic rendering by
  upgrading. That is accepted: the backend half works for it unchanged, and this feature delivers
  documentation of the API such a storefront needs to add the fields itself — not a component
  published by a package.

### Decisions taken in this spec (owner may overturn at review)

- **SD-1 What counts as "accepts" on update.** A dedicated values endpoint of the host (orders,
  customers today) satisfies the update half of OD-7: it is the host's own audited write with its
  own concurrency rule, and duplicating it into a general update would create two paths for one
  write. It does **not** satisfy the create half: values arriving in a second request after the
  create are a second write and a second audit entry, and a window in which a required field is
  missing — exactly what OD-5 rules out.
- **SD-2 `required` needs an editable field.** A definition whose admin access is `read` or
  `hidden` MUST NOT be `required`. The administrator's validation re-checks every required field on
  every save (Context), so a required field the panel does not let an administrator fill would make
  every record lacking a value unsaveable from the panel. Rejected alternative: enforce `required`
  only where the field is editable — that would change what `required` means for API callers, who
  cannot be told apart from the panel.
- **SD-3 Buyer input and `hidden` are compatible.** A field the buyer supplies at registration may
  be `read` or `hidden` in the admin panel ("buyer-provided, the administrator does not need to
  see it on the form"), subject to SD-2. Nothing else conflicts: buyer input is governed by the
  surface and the audience, admin access by the panel.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A business registers and supplies the deployment's extra data (Priority: P1) — MVP

The deployment's administrator has opened two fields on the registration form: *How did you hear
about us?* (a choice, stored on the company) and *Phone* (text, stored on the person). A buyer
opening the registration page sees both fields in their language, in the order the administrator
set, with the required one marked. They fill them in and register. The administrator later opens
the new Organization and its first member and finds both values where they belong.

**Why this priority**: it is the request; without it the deployment has to edit core or collect
the data by hand after registration.

**Independent Test**: with one `organization` choice field and one `customer` text field open on
registration, register through the storefront with and without JavaScript; the Organization and
the account each carry exactly their own value, and the admin shows both.

**Acceptance Scenarios**:

1. **Given** a choice field on Organizations open on registration, **When** a buyer registers and
   picks an option, **Then** the new Organization stores that option and the administrator sees it
   on the Organization's page.
2. **Given** a text field on customer accounts open on registration, **When** a buyer registers and
   types a value, **Then** the new account stores it and the administrator sees it on the
   customer's page.
3. **Given** the storefront is shown in Polish, **When** the form renders, **Then** each field's
   label and each option's label is the Polish one, falling back to the default label where a
   Polish one is missing.
4. **Given** a field open on registration is required, **When** the buyer leaves it empty, **Then**
   registration is refused with a message beside that field, everything typed except the password
   is kept, and no Organization and no account are created.
5. **Given** a field open on registration is optional, **When** the buyer leaves it empty, **Then**
   registration succeeds and the field has no value.
6. **Given** the buyer's browser runs no JavaScript, **When** registration is refused for any
   reason, **Then** the page comes back with the extra fields' values kept, and nothing typed
   appears in the address bar.
7. **Given** no field is open on registration, **When** a buyer opens the registration page,
   **Then** the form is exactly today's form, and registering works exactly as today.

---

### User Story 2 — An administrator opens a field for buyer input (Priority: P1)

An administrator editing a custom-field definition of Organizations or customer accounts sees an
option to collect the field from the buyer at registration. Turning it on puts the field on the
registration form; turning it off takes it away. The option is not offered for entity types that
declare no buyer surface.

**Why this priority**: OD-6 — this is the deployment's whole configuration path; without it User
Story 1 needs a developer.

**Independent Test**: on the definition form, turn the option on for an Organization field, load
the registration page, see the field; turn it off, reload, the field is gone — no restart.

**Acceptance Scenarios**:

1. **Given** a definition of `organization` or `customer`, **When** an administrator edits it,
   **Then** the form offers *Collect from the buyer at registration*, off by default, in English
   and Polish.
2. **Given** a definition of any other entity type, **When** an administrator edits it, **Then**
   the option is not shown, and a request setting it is refused.
3. **Given** a definition with the `internal` audience, **When** the administrator turns the option
   on, **Then** the save is refused with a message saying the field must first be visible to
   customers; **and given** an open definition, **When** the administrator changes its audience to
   `internal`, **Then** that save is refused the same way.
4. **Given** a definition of the Page Builder value type, **When** the administrator tries to turn
   the option on, **Then** it is refused.
5. **Given** the option was changed, **When** the next buyer opens the registration page, **Then**
   the new set of fields shows (immediately in the common case, within five minutes at worst).
6. **Given** the option was changed, **When** an administrator looks at the audit log, **Then** the
   change is recorded as a change of the definition, with who made it.
7. **Given** the definitions list, **When** an administrator scans it, **Then** fields collected at
   registration are recognisable without opening each one.

---

### User Story 3 — The platform refuses what a buyer may not write (Priority: P1)

Registration is anonymous. Whatever a client sends, it can write only the values of fields open
on registration, of the right type and size, and nothing else.

**Why this priority**: an anonymous writer reaching internal fields — a credit flag, a sales note,
a price tier — would be a security defect; it ships with the capability or not at all.

**Independent Test**: call the registration endpoint directly with an internal field's key, a key
with no definition, a field open only on another entity type, an oversize text and an unknown
option; each is refused with the field named and nothing is created.

**Acceptance Scenarios**:

1. **Given** a field that exists but is not open on registration, **When** a registration carries a
   value for it, **Then** registration is refused, naming the field, and nothing is created.
2. **Given** a key that no definition of that entity type has, **When** a registration carries it,
   **Then** registration is refused, naming the key.
3. **Given** an Organization field open on registration, **When** its value is sent under the
   person's values instead (or the other way round), **Then** registration is refused.
4. **Given** a text value longer than the buyer-input limit, a number that is not a number, or an
   option that is not one of the field's options, **When** a registration carries it, **Then**
   registration is refused, naming the field and the reason.
5. **Given** a required field that is **not** open on registration, **When** a buyer registers,
   **Then** registration is not refused because of it.
6. **Given** a registration whose extra values are refused, **When** it is answered, **Then** no
   Organization, no account and no channel binding exist afterwards.
7. **Given** a field whose admin access is `hidden`, **When** it is not open on registration and a
   registration carries a value for it, **Then** it is refused like any other closed field —
   admin access never opens a field to buyers.

---

### User Story 4 — An administrator sets custom-field values wherever they create or edit a record (Priority: P1)

An administrator creating an Organization, a member, an order on a customer's behalf, a quote
request on a customer's behalf or a category fills in its custom fields on the same form, and the
record is created with them. Editing any record with custom fields offers them too. An
integration calling the admin API does the same in one request.

**Why this priority**: OD-7. Today five creates drop the possibility entirely, so a required field
cannot be satisfied at creation and every such record starts incomplete.

**Independent Test**: for each supported entity type except `product`, define one required and
one optional field, create a record through the admin API and through the admin create screen
with both values, then update the optional one; each record carries the values from its first
write, and each create without the required value is refused.

**Acceptance Scenarios**:

1. **Given** custom fields on an entity type, **When** an administrator creates a record of it
   through its admin create endpoint with values, **Then** the record is created with them in the
   same write and its creation audit entry includes them.
2. **Given** a required field, **When** an administrator creates a record without it, **Then** the
   create is refused with the field named and nothing is created.
3. **Given** a value of the wrong type or an unknown option, **When** an admin create or update
   carries it, **Then** it is refused per field, exactly as an update is refused today.
4. **Given** an entity type whose owning module is switched off (`crm`, `projects`, `tasks`,
   `quote_requests`), **When** that module is off, **Then** its endpoints are absent as today and
   no other host's create or update is affected.
5. **Given** a product, **When** an administrator creates or edits it, **Then** attribute values
   are handled by the catalog's own attribute surfaces exactly as today.
6. **Given** a host's admin create screen, **When** custom fields are defined for its entity type,
   **Then** the screen shows them and sends them with the create; **and given** a category's edit
   screen, **Then** it shows and saves them as other hosts' detail screens do.
7. **Given** a new admin create or update endpoint added to a host without custom-field values and
   without a reasoned exemption, **When** the static checks run, **Then** they fail naming the
   endpoint. *Scope (owner ruling 2026-11-06):* the check discovers an undeclared endpoint only at a
   declared collection path or its `/:id` child; an endpoint under a wholly new path is not detected
   until it is declared, which the convention document (FR-046) makes the author's obligation.

---

### User Story 5 — An administrator keeps system fields out of the way (Priority: P2)

An integration maintains `erp_customer_code` on Organizations and the instance's code maintains
`sync_checksum`. The administrator marks the first *read-only* and the second *hidden*: the
Organization's page shows the ERP code without an input, and does not show the checksum at all.
Both still appear on the custom-fields definitions screen, where either can be switched back.

**Why this priority**: OD-8; useful, but every other story works without it.

**Independent Test**: mark one field `read` and one `hidden`, open a record's admin page, edit and
save another field; the `read` field shows its value without an input, the `hidden` one is absent,
both stored values are unchanged after the save, and an API-key update of both still succeeds.

**Acceptance Scenarios**:

1. **Given** a definition, **When** an administrator edits it, **Then** the form offers *Admin
   access*: editable (default), read-only, hidden — in English and Polish, with a sentence saying
   it is a convenience for the panel and not a permission.
2. **Given** a `read` field, **When** a record's admin page or create screen renders its custom
   fields, **Then** the field shows its value (or that there is none) without an input.
3. **Given** a `hidden` field, **When** a record's admin page or create screen renders its custom
   fields, **Then** the field is not shown.
4. **Given** a record whose `read` and `hidden` fields hold values, **When** an administrator saves
   other custom fields from the panel, **Then** the save does not send the `read` and `hidden`
   fields and their stored values stay as they were, including a value an integration wrote after
   the page was loaded.
5. **Given** a `read` or `hidden` field, **When** an API caller (an integration, an API key or
   instance code) writes it through any admin endpoint, **Then** the write is accepted and
   validated as for an `edit` field.
6. **Given** the definitions screen, **When** an administrator lists the definitions of an entity
   type, **Then** `read` and `hidden` ones are listed with their access level and can be edited.
7. **Given** a definition marked `required`, **When** an administrator sets its access to `read` or
   `hidden` (or marks a `read` or `hidden` one required), **Then** the save is refused with a
   message explaining why (SD-2).
8. **Given** a `hidden` field, **When** an administrator uses list filters, list columns, export or
   the audit log, **Then** those behave exactly as for any other field.

---

### User Story 6 — The personal data a buyer supplied is erased with the person (Priority: P2)

A phone number a buyer gave at registration is personal data. When the account is anonymised, the
values stored on the account go with the e-mail and the names.

**Why this priority**: required before the feature is used for personal data, but registration
works without it.

**Independent Test**: register with a phone value, run the account anonymisation, read the account;
its custom-field values are empty, and neither the audit trail nor the anonymisation event carries
the phone.

**Acceptance Scenarios**:

1. **Given** an account with values written at registration, **When** it is anonymised, **Then**
   its custom-field values are cleared.
2. **Given** a registration that wrote extra values, **When** an administrator reads its audit
   entry, **Then** the entry says which fields were supplied and does not hold their values.

---

### Edge Cases

- **A field closed while a buyer is filling the form** — the submission carries a value for a field
  no longer open; registration is refused naming it, the form comes back with the current set of
  fields and everything else kept, and a second submit succeeds.
- **A required field opened while a buyer is filling the form** — refused as missing; the form
  comes back showing the new field.
- **A definition deleted after a buyer loaded the form** — its key has no definition; refused as in
  User Story 3 scenario 2, then as above.
- **Required, not open, and later edited by an administrator** — an Organization created by
  registration has no value for a required internal field; that is today's situation for any
  required field added after a record exists, and the admin edit asks for it then.
- **A stored `read` or `hidden` value that no longer validates** (an option was removed) — the
  administrator's validation re-checks every stored value on save (Context), so a panel save is
  refused naming a field the panel does not let them fix. The refusal message MUST name the field
  and its access level so the administrator knows to look on the definitions screen; changing the
  re-check is out of scope.
- **Admin create with a `hidden` required field** — cannot arise (SD-2).
- **Multiselect with no option chosen** — treated as empty (absent), as the admin path does.
- **Boolean field not ticked** — submitted as an explicit `false` when the field is open, so an
  unticked optional checkbox is stored as `false`, not absent; an unticked required checkbox is a
  valid answer.
- **A value with leading or trailing spaces only** — on a buyer surface, empty after trimming, so
  absent; required fields refuse it.
- **More keys than the limit** — refused before any definition is read.
- **The value port is not composed** (none of the three registration modules can be switched off,
  so this is a composition without `custom_fields`, not an operator state) — the public list of
  open fields is empty, a registration without extra values succeeds, and one with extra values is
  refused rather than written or dropped. The same holds for every admin create and update.
- **The registry lookup of feature 173 and extra fields together** — independent; neither affects
  the other.
- **An admin invitation** (`POST /api/v1/admin/organizations/:id/members/invite`) — creates no
  account; the account is created when the invited person accepts, which is a buyer action and not
  a surface in this feature. It is an exemption of the parity check, with that reason.
- **B2C registration** (`storefront/app/(auth)/register-customer/`) — not a surface in this
  feature; nothing changes there.

## Requirements *(mandatory)*

### Functional Requirements

The groups below are cut so that each can be a work package owned by one module (the owner is
named in each heading).

**A. Definition attributes (`custom_fields`)**

- **FR-001**: A custom-field definition MUST carry a *buyer input* attribute naming the input
  surfaces on which a buyer may supply its value; the default MUST be none, and every existing
  definition MUST read as none after the change.
- **FR-002**: Each entity type MUST declare the buyer input surfaces it offers; a definition MUST
  NOT name a surface its entity type does not declare. In this feature `organization` and
  `customer` declare *organization registration* and no other entity type declares any.
- **FR-003**: A definition open on any surface MUST have the `customer` audience; creating or
  updating a definition into any other combination MUST be refused with a reason that names the
  conflict.
- **FR-004**: A definition of the Page Builder value type MUST NOT be opened on any surface.
- **FR-005**: A custom-field definition MUST carry an *admin access* level — `edit`, `read` or
  `hidden` — defaulting to `edit`, and every existing definition MUST read as `edit` after the
  change.
- **FR-006**: A definition MUST NOT be both `required` and of admin access `read` or `hidden`
  (SD-2); a save producing that combination MUST be refused with a reason that names it. Buyer
  input and any admin access level MAY be combined otherwise (SD-3).
- **FR-007**: Admin access MUST NOT change what any API endpoint accepts, answers, filters,
  exports or audits; it is read only by admin screens (OD-8).
- **FR-008**: Changing either attribute MUST be an audited definition change, like any other
  (Principle XIII), and MUST take effect without a restart (definition caches are invalidated
  across processes as for every definition change).
- **FR-009**: The definitions read by admin screens MUST include both attributes.

**B. Validation of buyer input (`custom_fields`)**

- **FR-010**: The platform MUST offer a validation of buyer-supplied values that takes the entity
  type, the values and the surface, and answers the values to store or a per-field refusal.
- **FR-011**: That validation MUST refuse — never ignore — any key that is not the key of a live
  definition of that entity type open on that surface, naming the key.
- **FR-012**: That validation MUST enforce `required` only among the definitions open on that
  surface; a required definition not open on the surface MUST NOT cause a refusal.
- **FR-013**: That validation MUST apply each field's type rules exactly as the administrator's
  path does (type, options, dates, numbers), and in addition: a text value MUST be at most 1 000
  characters after trimming surrounding whitespace, a whitespace-only text MUST count as empty,
  and a request MUST carry at most 50 keys per entity type, refused before any definition is
  read.
- **FR-014**: A refusal MUST answer as the platform's existing custom-field validation failure
  (HTTP 422, one entry per field with a reason code), with a distinct reason for "not open on this
  surface".

**C. Admin parity (one requirement per host module)**

- **FR-015** *(rule)*: Every admin endpoint that creates a record of a supported entity type MUST
  accept that record's custom-field values in the create request, under the field name
  `customFieldValues`, validate them with the administrator's rules and store them in the write
  that creates the record (OD-5, SD-1). Every admin endpoint that updates such a record MUST accept
  them likewise, **or** the host MUST offer a dedicated values endpoint for that record (SD-1). A
  refusal MUST be the existing per-field 422, and a create refused for its values MUST create
  nothing.
- **FR-016** *(`catalog`)*: The admin category create MUST accept values (FR-015). `product` is
  exempt from FR-015 as host-managed: its values are catalog attribute values written by the
  catalog's own surfaces.
- **FR-017** *(`orders`)*: The admin order create MUST accept values; the existing dedicated values
  endpoint satisfies the update half.
- **FR-018** *(`organizations`)*: The admin Organization create MUST accept values; the admin
  member create (an account in an Organization) MUST accept values for the `customer` entity type.
- **FR-019** *(`quote_requests`)*: The admin quote-request create (on a customer's behalf) MUST
  accept values.
- **FR-020** *(`crm`, `projects`, `tasks`)*: Their create and update endpoints already satisfy
  FR-015; they MUST be declared to the check of FR-043 and MUST keep satisfying it.
- **FR-021** *(audit)*: An admin create carrying values MUST name them in its creation audit
  entry — their keys, sorted, as `changedCustomFields` — as an admin update already does for its
  changes (Principle XIII). For a tenant-scoped record (Order, Organization, account, quote
  request) the entry MUST NOT record the values (D-288, `specs/conventions/audit-state.md`); a
  platform-global record (category) may (§5 there).

**D. Registration (`organizations`, `customer_accounts`, `@endora-commerce/contracts`)**

- **FR-022**: The registration request MUST accept optional values for the Organization and
  optional values for the registering person, as two separate groups; each group MUST be
  validated against its own entity type and the *organization registration* surface with the
  buyer-input validation (group B), never with the administrator's.
- **FR-023**: Where the registration request and the admin create share a request shape (the
  admin Organization create derives from the registration's Organization member), the two routes
  MUST still apply different validations: the admin's rules on the admin route, the buyer-input
  rules on registration.
- **FR-024**: Both groups MUST be validated **before** anything is written; a refusal of either
  MUST leave no Organization, no account, no channel binding, no validation row and no
  verification token behind.
- **FR-025**: Accepted Organization values MUST be stored in the same write that creates the
  Organization, and accepted person values in the same write that creates the account; no
  follow-up update.
- **FR-026**: A registration carrying no extra values MUST behave exactly as before this feature,
  including when no field is open and when the value port is not composed.
- **FR-027**: When the value port is not composed, a registration carrying extra values MUST be
  refused (FR-011's rule, with every key unknown), not written and not dropped; the same holds for
  an admin create or update carrying values.
- **FR-028**: The registration's audit entry MUST record which extra fields were supplied (their
  keys, prefixed by request group, `organization.` / `firstUser.`, sorted, as
  `changedCustomFields`) and MUST NOT record their values.

**E. Public list of open fields and storefront (`custom_fields`, reference storefront)**

- **FR-029**: The platform MUST offer an anonymous, channel-independent read answering, for a
  surface, the fields open on it per entity type: key, value type, required, label and option
  labels in the request's language with the default as fallback, and display order. It MUST NOT
  answer any field not open on that surface, any stored value, nor the admin access level.
- **FR-030**: That read MUST answer an empty list for a surface no entity type declares, and when
  the value port is not composed.
- **FR-031**: The reference storefront's registration form MUST render the open fields generically
  from FR-029 — text, number, date, boolean, select and multiselect — with Organization fields in
  the company section and person fields in the personal section, required ones marked, each with
  an accessible label.
- **FR-032**: A refusal of an extra value MUST be shown beside that field, and a refused
  registration MUST keep every typed value except the password, extra values included, without
  putting any of them in the URL (as `specs/173-registration-registry-lookup/` FR-013 / FR-017).
- **FR-033**: A failure to read the open fields MUST render the form without extra fields rather
  than fail the page.
- **FR-034**: An instance scaffolded before this feature MUST be able to adopt FR-031 – FR-033 from
  documentation alone (OD-9): the storefront integration documentation, in English and Polish,
  MUST describe the FR-029 read (request, response, empty answers per FR-030), the extra values in
  the registration request, and the shape of a refusal naming the field (FR-032). No component is
  published by a package for this.

**F. Admin screens (`@endora-commerce/admin-kit`, `custom_fields`, each host's admin)**

- **FR-035**: The definition editor MUST offer the buyer input option only for entity types that
  declare a surface, MUST disable it with an explanation while the audience is `internal` or the
  value type is Page Builder, and MUST show on the definitions list which fields are collected at
  registration.
- **FR-036**: The definition editor MUST offer the admin access selector for every entity type
  (product attributes included, on the catalog's attribute screen), with a one-sentence
  explanation that it is a convenience for the panel and not a permission; the definitions list
  MUST show every definition whatever its access level, with the level visible.
- **FR-037**: The shared custom-field values panel MUST render `read` fields without an input and
  omit `hidden` fields, in both its saving and its embedded (create-form) mode.
- **FR-038**: A save from the panel MUST send only the fields it rendered as editable; `read` and
  `hidden` values MUST be left to the server's merge, which keeps a key absent from the patch, so
  a panel save never overwrites them.
- **FR-039**: Every admin create screen of a host listed in group C, and the category edit screen,
  MUST show the entity type's custom fields through the shared panel and send them with its own
  request.
- **FR-040**: The new options MUST be governed by the permission that already governs editing
  definitions; no new permission code and no new command-palette action are needed, because no new
  admin screen is added (the existing custom-fields screen stays reachable from the palette).

**G. Personal data (`customer_accounts`)**

- **FR-041**: Anonymising a customer account MUST clear its custom-field values.
- **FR-042**: Neither the anonymisation audit entry nor the anonymisation event MUST carry a
  custom-field value.

**H. Governance, checks, language and documentation**

- **FR-043**: Each host module MUST declare, for every supported entity type it owns, its admin
  create and update endpoints. A static check MUST fail when: a supported entity type has neither a
  declaration nor an exemption; a declared create endpoint's request contract does not carry the
  values; a declared update endpoint's request contract does not carry them and no dedicated values
  endpoint is declared for the type; or an exemption carries no reason. Exemptions MUST be declared
  beside the declaration they exempt, each with a written reason, and the check MUST print every
  exemption it honoured. `product` (host-managed) and the admin invitation (creates no account)
  are the exemptions this feature starts with.
- **FR-044**: A static check MUST fail when an entity type declares a buyer input surface for which
  no request contract carries that entity type's values, or for which no test exercises the
  surface's refusal of a key that is not open.
- **FR-045**: Both checks MUST meet the obligations of `specs/conventions/check-estate.md` (inventory
  entry, estate verdict, one red proof per finding kind, exit 2 on an empty or short read, a printed
  read size).
- **FR-046**: A convention document under `specs/conventions/` MUST be the one home of the rules for
  writing custom-field values — admin parity (FR-015, SD-1, the exemption mechanism), admin access
  (OD-8, FR-007, SD-2) and buyer input (OD-1 – OD-4, FR-011 – FR-014) — and `AGENTS.md`' routing
  table MUST point to it.
- **FR-047**: Every new admin and storefront string MUST ship in English and Polish.
- **FR-048**: The `custom_fields` documentation MUST describe buyer input, its surfaces, the
  audience rule and the limits, and admin access — stating plainly that `read` and `hidden` are a
  convenience of the panel and **not access control**: the values remain readable and writable
  through the API, list filters, export and audit. The `organizations` documentation MUST describe
  the extra registration fields. Both in English and Polish.

### Key Entities

- **Custom-field definition (extended)** — gains the buyer input attribute (the set of input
  surfaces on which a buyer may supply the value; empty by default; non-empty only with the
  `customer` audience and a non-Page-Builder value type) and the admin access level (`edit`,
  `read`, `hidden`; `edit` by default; not `required` unless `edit`).
- **Supported entity type (extended)** — the registry entry of an entity type gains the input
  surfaces it offers. `organization` and `customer` offer *organization registration*.
- **Input surface** — a named public write path through which a buyer supplies values. One exists
  in this feature: *organization registration*.
- **Admin write declaration** — per supported entity type, owned by its host module: the admin
  create endpoint, the admin update endpoint or dedicated values endpoint, and any exemption with
  its reason.
- **Registration request (extended)** — gains optional values for the new Organization and optional
  values for the registering person.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deployment can collect a new piece of data at business registration with zero lines
  of code or configuration files changed in the instance — only definition changes in the admin
  (demonstrated end to end on a freshly scaffolded instance).
- **SC-002**: 100 % of the refusal cases in User Story 3 leave zero Organizations, zero accounts and
  zero channel bindings behind (asserted by counting rows per case).
- **SC-003**: No value of a field not open on registration can be written by an anonymous request,
  across every value type and both entity types (asserted per type and entity type).
- **SC-004**: For 8 of the 9 supported entity types (all but the host-managed `product`), a record
  can be created with its custom-field values in one admin request, and 0 admin create or update
  endpoints of those types lack the values without a written exemption (the check of FR-043 is
  green and lists exactly the exemptions this spec names).
- **SC-005**: After a panel save, 100 % of `read` and `hidden` values are unchanged, including
  values written by another caller between page load and save (asserted per host screen).
- **SC-006**: A registration with no field open takes no longer at the 95th percentile than before
  this feature, within measurement noise; with five fields open, at most 50 ms longer.
- **SC-007**: A buyer without JavaScript completes a refused-then-corrected registration without
  retyping any value other than the password.
- **SC-008**: After anonymisation, no custom-field value written at registration is readable
  anywhere — the account, its audit trail or the anonymisation event.

## Assumptions

- **Only one buyer surface ships.** Checkout, the buyer's account profile, quote requests, invitation
  acceptance and B2C registration are not surfaces in this feature; the attribute and the registry
  declaration are shaped so that adding one is a declaration plus that surface's contract and test
  (FR-044).
- **Admin parity is the API and the shared panel, not a redesign of every screen.** FR-039 adds the
  existing panel to the screens that lack it; it does not add custom fields to lists, boards or
  documents that do not already show them.
- **Anonymisation clears the whole bag.** FR-041 clears every custom-field value of the account,
  not only the buyer-input ones: values stored on a person are presumed personal, and nothing
  remains to use them for after the account is anonymised. Organization values are company data;
  a B2B Organization is not anonymised today and this feature does not change that. A personal
  Organization's cascade (`anonymizeIfOrphaned`) is unaffected because personal Organizations are
  not created by this surface.
- **Values a buyer supplied are ordinary values afterwards.** An administrator may edit or clear
  them through the admin paths (subject to the field's admin access in the panel), and the buyer
  reads them back wherever `customer`-audience values are already answered.
- **The 1 000-character and 50-key limits** are defaults sized for a registration form; the
  administrator's own path keeps its 10 000-character limit.
- **Labels come from the definition.** No placeholder, help text or per-field validation pattern
  (e.g. a phone format) is added; a deployment that needs a format check uses a select or accepts
  free text.
- **No constitution amendment is needed.** Principle XIV already requires per-write validation and
  host-owned writes. A PATCH-level clarifying sentence — *"a definition's audience governs reads;
  buyer writes are a separate per-definition opt-in, scoped to declared input surfaces"* — is
  recorded as a proposal only: the owner ruled on 2026-11-06 not to adopt it in this feature, and it
  is left for a later owner decision.
- **The registry declaration is an opaque surface name.** The generic core stores which surfaces an
  entity type offers and compares names; it does not interpret what a surface does, which keeps
  the core entity-agnostic (Principle XIV, `backend/test/unit/custom_fields/no-entity-capability-logic.test.ts`).
  The admin write declarations of FR-043 are owned by the host modules for the same reason.

## Out of scope

- Other buyer input surfaces (checkout, account profile edit, quote request, invitation acceptance,
  B2C registration).
- Admin access as a security control: per-role or per-permission visibility of custom fields, or an
  API that refuses `read` / `hidden` keys.
- Changing the administrator's validation so that it no longer re-checks stored values the patch
  did not touch.
- An `extensions` namespace on requests, contributor ports, or Command Bus hooks for overlay code
  to add registration logic.
- A native phone column on the customer account.
- **The non-atomic registration** (the Organization flushed at `registration-service.ts:186` before
  the account is created at `:213`). It is a known separate defect and is not fixed here; FR-024
  only guarantees that this feature's own refusals happen before the first write, so they cannot
  trigger it.
