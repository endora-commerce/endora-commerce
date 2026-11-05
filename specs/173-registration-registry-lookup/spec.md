# Feature Specification: Company registry lookup at storefront registration

**Feature Branch**: `feat/173-registration-registry-lookup`
**Created**: 2026-11-05
**Status**: Draft
**Input**: Owner request (2026-11-05, translated): a B2B customer registering on the storefront
types their NIP / VAT ID and country; the platform immediately fetches the company's data from the
public registry (legal name, address, VAT status) and pre-fills the registration form. Today that
data is only available in the admin panel, for an Organization that already exists. Use GUS (the
Polish REGON registry, BIR1.1 API) and VIES. The operator must be able to switch the option off
from the admin panel.

**Related**: feature 026 US7 (the admin "Validate now" flow, `VatValidator` port, VIES and
Ministerstwo Finansów clients) — pre-migration, cited for provenance only; it reaches this tree as
the code under `packages/modules/organizations/src/backend/integrations/` and
`services/organization-tax-id-validation-service.ts`. `specs/154-sales-channel-access/`
(registration stays reachable on a closed store), `specs/170-forms-module/` research R-10 (no-JS
round trip without form data in the URL), `specs/170-organization-roles/` (owner ruling on PR #715:
a refused form keeps what was typed and no form state travels in a URL),
`specs/151-page-builder-translate/` (a module consuming a `credential_ref` while `credentials`
stays deactivatable).

## Context

Measured on `fix/685-blog-public-asset-url` at `d9e734f75` (one commit ahead of `origin/master`
`efaee6163`, touching `blog` only):

- **Registry data exists only after the fact.** `OrganizationTaxIdValidationService.trigger`
  (`packages/modules/organizations/src/backend/services/organization-tax-id-validation-service.ts`)
  validates the tax ID of an Organization that already exists, on an administrator's click, against
  VIES or the Ministerstwo Finansów White List, and stores one `OrganizationTaxIdValidation` row per
  attempt. Nothing on the storefront reaches it.
- **The registry answer is unstructured.** `VatValidationResult.address` (in
  `packages/contracts/src/organizations.ts`) carries one `line1` string; both clients put the
  registry's whole address in it. The registration form needs street, postal code and city
  separately.
- **No VAT status from GUS, no structure from MF.** The White List answers name, VAT status and an
  address as one string; GUS BIR1.1 answers name, REGON and a structured address but no VAT status.
- **The registration form is a Server Component with a server action**
  (`storefront/app/(auth)/register/page.tsx`); it works without JavaScript, and a refused
  registration redirects with `?error=<message>` and loses everything typed.
- **The public register endpoint** is `POST /api/v1/organizations/register`
  (`packages/modules/organizations/src/backend/routes.public.ts`), body
  `registerOrganizationRequestSchema`, `salesChannelAccess: 'open'`.

## Clarifications

### Owner decisions, 2026-11-05 (binding — not reopened here)

- **OD-1 Provider routing.** Polish NIP → GUS BIR1.1 (structured address). GUS key not configured,
  or GUS fails or times out → the existing Ministerstwo Finansów White List client (name, VAT
  status, one-string address parsed best-effort). The GUS key is a new credential type in the
  `credentials` module (secret, write-only, encrypted). Other EU VAT IDs → VIES (existing client).
  VAT status for PL: decided in research R-3 (GUS for data, White List for VAT status).
- **OD-2 Toggle.** A new `organizations` setting, editable on the admin Settings screen. The
  VIES / MF clients stay in `organizations`; no separate module. When off, the public lookup
  endpoint behaves as absent and the storefront renders the plain manual form.
- **OD-3 Informational only.** "Not found", "not an active VAT payer" and a registry outage show a
  message; the customer enters data manually; registration still succeeds. The lookup result is
  persisted as an `OrganizationTaxIdValidation` row for the new Organization at registration, so
  the administrator sees it during moderation.
- **OD-4 Editable fields, divergence tracked.** Prefilled fields stay editable. What the registry
  returned is persisted, and the divergence between it and what the customer submitted is shown
  to the administrator in moderation.

### Owner decision, 2026-11-05 (later the same day; binding)

- **OD-5 Polish sources are an operator choice.** OD-1's parallel GUS + White List design stays the
  default, and a new `organizations` setting `organizations.registration.registry_lookup_pl_sources`
  (one of `gus_mf` | `gus` | `mf`, default `gus_mf`) selects the sources for Polish NIPs:
  - `gus_mf` — exactly OD-1 / research R-3: GUS and the White List in parallel; GUS supplies name,
    REGON and the structured address; the White List supplies the VAT status and the data when GUS
    is not configured, fails or is over budget.
  - `gus` — GUS only; the registration lookup never calls the White List (its daily quota stays
    for the administrator's "Validate now"). VAT status is `unknown`. GUS not configured, failing or
    over budget → `unavailable` for Polish NIPs, with no White List fallback.
  - `mf` — White List only (no GUS key needed); its one-line address parsed best-effort
    (research R-6); GUS is never called, even when configured.
  Non-Polish EU VAT numbers always go to VIES, whatever the setting.

### Owner decisions, 2026-11-05 (resolving Q1 and Q2; binding)

- **OD-6 (was Q1) — the toggle ships off.** `registry_lookup_enabled` defaults to `false`, so
  that merging changes no deployment's behaviour and no deployment starts sending tax IDs to
  public registries without the operator deciding to (the `credentials` activation precedent,
  feature 074 FR-012).
- **OD-7 (was Q2) — registration does not write the registry's legal name.** When a lookup found
  the company, registration does **not** write the registry's name into the Organization's
  `legalName` field: registration stores what the customer submitted as `name`, the registry
  snapshot on the validation row, and the administrator applies the registry's legal name with
  the existing "Validate + apply legal name" action if they agree (OD-3 "informational only").

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A business customer's registration form is filled from the registry (Priority: P1) — MVP

A buyer opens the registration page, chooses their country, types their NIP (or EU VAT number) and
asks to fetch the company data. The company's legal name, street with building and unit number,
postal code and city appear in the form, with the VAT status shown beside them. The buyer corrects
anything out of date, fills in their own details and creates the account.

**Why this priority**: it is the request. Typing a company address by hand is the slowest and most
error-prone part of the form, and an exact registry address saves the moderator a lookup.

**Independent Test**: with the lookup on and fake registries, fetch a known NIP on the storefront
with JavaScript and without it; the company fields are filled with the registry's values, every
field stays editable, and creating the account succeeds.

**Acceptance Scenarios**:

1. **Given** the lookup is on and GUS is configured, **When** the buyer enters a valid Polish NIP
   with country Poland and fetches, **Then** the legal name, street (with building and unit
   number), postal code and city are filled from GUS, the VAT status from the White List is shown,
   and the source is named. (Polish sources `gus_mf`, the default.)
2. **Given** the lookup is on, sources `gus_mf` and GUS **not** configured, **When** the buyer
   fetches a Polish NIP that is on the White List, **Then** the legal name is filled and the White
   List's one-line address is split into street, postal code and city wherever it can be; whatever
   cannot be split is left for the buyer to complete.
3. **Given** the lookup is on, sources `gus` and GUS configured, **When** the buyer fetches a
   Polish NIP, **Then** name, REGON and the structured address are filled from GUS, the VAT status
   is shown as not checked, and the White List is not contacted.
4. **Given** the lookup is on, sources `mf` and GUS configured, **When** the buyer fetches a Polish
   NIP that is on the White List, **Then** the data and the VAT status come from the White List
   (address split best-effort), and GUS is not contacted.
5. **Given** the lookup is on, **When** the buyer enters an EU VAT number of another member state
   (with its prefix or with that country chosen) and fetches, **Then** VIES is asked and whatever
   name and address it shares are filled, whichever Polish sources are selected.
6. **Given** a filled form, **When** the buyer changes any prefilled field, **Then** the change is
   kept and is what registration stores.
7. **Given** the buyer's browser runs no JavaScript, **When** they fetch, **Then** the page comes
   back with the company fields filled and every other value they had typed kept — except the
   password, which is never sent back — and nothing they typed appears in the address bar.
8. **Given** JavaScript runs, **When** the buyer fetches, **Then** the page does not reload, the
   button shows that the lookup is in progress and cannot be pressed twice, and the outcome is
   announced to assistive technology.

---

### User Story 2 — A failed or negative lookup never stops a registration (Priority: P1)

Whatever the registry says — not found, not an active VAT payer, activity ceased, not answering —
the buyer is told plainly, enters their data by hand and registers.

**Why this priority**: OD-3. A registry outage must not turn into lost registrations.

**Independent Test**: with fake registries answering each negative outcome in turn, fetch and then
register; every registration succeeds and every message is the one for its outcome.

**Acceptance Scenarios**:

1. **Given** a NIP whose checksum is wrong, **When** the buyer fetches, **Then** they are told the
   number does not look valid, and no registry is contacted.
2. **Given** a NIP no registry knows, **When** the buyer fetches, **Then** they are told it was not
   found and the company fields stay as they were.
3. **Given** a company the White List reports as exempt or not registered for VAT, **When** the
   buyer fetches, **Then** the data is filled and they are told the VAT status, which does not
   prevent registering.
4. **Given** every applicable registry fails or times out, **When** the buyer fetches, **Then**
   they are told the registry is not answering and are invited to type the data, within the
   documented time limit.
4a. **Given** sources `gus` and GUS failing, over budget or not configured, **When** the buyer
   fetches a Polish NIP, **Then** they are told the registry is not answering, the White List is
   not contacted, and registration still succeeds.
5. **Given** a country with no supported registry, **When** the buyer fetches, **Then** they are
   told automatic lookup is not available for that country, and no registry is contacted.
6. **Given** the buyer has fetched too often, **When** they fetch again, **Then** they are told to
   wait or enter the data by hand.
7. **Given** a lookup happened and registration is refused (for example the e-mail address is
   already registered), **When** the page comes back, **Then** everything typed except the password
   is kept, the lookup still counts for the registration, and nothing appears in the address bar.

---

### User Story 3 — The operator controls the lookup and its GUS key (Priority: P1)

An administrator switches the lookup on or off on the Settings screen, chooses which registries
answer for Polish NIPs (GUS and the White List, GUS only, or the White List only), and stores the
GUS key as a credential, choosing the production or test environment.

**Why this priority**: OD-2; the platform must not contact registries an operator did not choose.

**Independent Test**: switch the setting off and on; the storefront shows and hides the lookup
without a restart, and the lookup endpoint is absent while off. Remove the GUS credential; with
sources `gus_mf` Polish lookups still work through the White List, with `gus` they answer
"unavailable". Switch the sources; the next Polish lookup contacts only the selected registries.

**Acceptance Scenarios**:

1. **Given** the lookup is off, **When** a buyer opens the registration page, **Then** the plain
   manual form is shown with no lookup control, and a direct call to the lookup endpoint is
   answered exactly as an unknown endpoint is.
2. **Given** the lookup is switched on or off, **When** the next buyer opens the registration page,
   **Then** the new state shows (immediately in the common case, within five minutes at worst).
3. **Given** an administrator creates a GUS credential, **When** they look at it later, **Then** the
   key is masked and is never returned in full; changing the environment asks for the key again.
4. **Given** sources `gus_mf` and no GUS credential is selected, the credential is invalid, or the
   `credentials` module is switched off, **When** a buyer fetches a Polish NIP, **Then** the White
   List answers.
4a. **Given** sources `gus` and no usable GUS credential (any of the three reasons above), **When**
   a buyer fetches a Polish NIP, **Then** the answer is "unavailable" and no registry is contacted;
   the setting's description on the Settings screen warns of exactly this, and the screen shows a
   warning beside the setting while `gus` is chosen with no GUS credential selected.
5. **Given** the lookup is off, **When** a registration arrives carrying a lookup reference,
   **Then** the reference is ignored and the registration succeeds.
6. **Given** the Polish sources are changed, **When** the next buyer fetches a Polish NIP that was
   looked up under the previous choice, **Then** the answer is fetched again from the newly selected
   registries (no answer cached under another choice is served).

---

### User Story 4 — The moderator sees the registry snapshot and how the submission differs (Priority: P2)

An administrator opening a newly registered Organization sees what the registry said at
registration time — the source, legal name, address, REGON, VAT status, activity status and any
registry that failed on the way — beside what the customer submitted, with each differing field
marked.

**Why this priority**: OD-3 and OD-4; it is what makes the lookup useful to moderation, but
registration itself works without it.

**Independent Test**: register through a lookup, change the street before submitting, open the
Organization in the admin; the VAT validation panel shows the registration-time row and marks the
street as different, naming both values.

**Acceptance Scenarios**:

1. **Given** an Organization registered after a lookup, **When** an administrator opens it, **Then**
   the VAT validation history shows a row marked as coming from registration, with the registry's
   data and outcome.
2. **Given** the customer changed a prefilled field, **When** the administrator opens the
   Organization, **Then** that field is listed as different, with the registry's value and the
   submitted value; a difference only in letter case, diacritics, spacing, punctuation or a common
   legal-form abbreviation is not listed.
3. **Given** a pending Organization whose submission differs from the registry, **When** the
   administrator looks at the moderation actions, **Then** a notice says how many fields differ and
   points to the VAT validation panel.
4. **Given** a registration without a lookup, **When** the administrator opens the Organization,
   **Then** no registration-time row exists, and "Validate now" works exactly as before.

---

### Edge Cases

- **NIP typed with prefix, spaces or dashes** (`PL 123-456-32-18`) — normalised before the
  checksum; the chosen country is overridden by an explicit EU prefix, and the form's country
  follows the registry's answer.
- **NIP valid but with a different chosen country** — a bare 10-digit number with country Germany
  is a German VAT number and goes to VIES, not GUS.
- **Sources `gus` with no GUS credential** — every Polish lookup is "unavailable" and contacts
  nothing; the operator was warned on the Settings screen. Non-Polish lookups are unaffected.
- **Sources `mf` with a GUS credential configured** — GUS is never called; the credential is simply
  unused.
- **Sources changed while a ticket is outstanding** — the ticket keeps the answer the buyer was
  shown and the sources it was fetched with; registration persists it as is.
- **An unreadable or unknown sources value** — treated as the default `gus_mf`.
- **Several GUS units for one NIP** — the unit that has not ceased activity is preferred; with
  several, the first (registry order).
- **Company whose activity has ended** — data is filled and the buyer is told; registration is
  allowed (OD-3).
- **VIES valid but shares no name or address** (Germany and others answer `---`) — the buyer is
  told the number is valid but the details must be typed.
- **A lookup reference for a different tax ID than the one submitted** (the buyer fetched, then
  changed the NIP) — the reference is ignored; no registration-time row is written.
- **An expired or unknown lookup reference** — ignored; registration succeeds.
- **Redis unavailable** — the lookup answers "unavailable" (it never runs uncached and unmetered);
  registration is unaffected.
- **GUS key rejected by GUS** — treated as GUS unavailable for that lookup; the White List answers.
- **Registry budget for the window used up** — lookups that would contact a registry answer
  "unavailable"; cached answers are still served.
- **The tax ID already belongs to an Organization** — the lookup still answers (it discloses only
  public registry data, never whether the tax ID is registered here); registration refuses with
  the existing 409 as today.
- **Pressing Enter** — with JavaScript, Enter in the tax ID field fetches and Enter anywhere else
  submits the registration; without JavaScript see research R-10.

## Requirements *(mandatory)*

### Functional Requirements

**Lookup**

- **FR-001**: The platform MUST offer an anonymous company lookup taking a country and a tax ID and
  answering one of: found, not found, unavailable, invalid tax ID, unsupported country.
- **FR-002**: The tax ID MUST be normalised (whitespace, dashes and dots removed, upper-cased, an EU
  country prefix recognised) and, for Poland, the NIP checksum MUST be verified **before** any
  registry is contacted; an invalid or unsupported input MUST contact no registry.
- **FR-003**: A Polish NIP MUST be looked up in the registries the Polish-sources setting selects
  (OD-5, research R-3):
  - `gus_mf` (default) — GUS BIR1.1 when a GUS credential is configured and resolvable, and the
    Ministerstwo Finansów White List in every case; GUS data takes precedence for name and address,
    the White List supplies the VAT status, and the White List supplies name and address when GUS is
    not configured, fails, times out, is over budget or does not know the NIP;
  - `gus` — GUS only; the White List MUST NOT be called; VAT status `unknown`; GUS not configured,
    failing, timing out or over budget MUST answer `unavailable`;
  - `mf` — the White List only; GUS MUST NOT be called.
- **FR-003a**: The Polish-sources setting MUST NOT affect non-Polish lookups, which always go to
  VIES; VIES MUST NOT be used for the VAT status of a Polish NIP in any mode (research R-3).
- **FR-004**: A tax ID of another EU member state MUST be looked up in VIES; a country outside the
  supported set MUST answer "unsupported country".
- **FR-005**: A found answer MUST carry the legal name, the address as street (including building
  and unit number), postal code, city and country, the VAT status (active, exempt, not registered,
  unknown), the activity status (active, ceased, unknown), the REGON when known, and the source
  registry. A field the registry did not supply MUST be empty, not invented.
- **FR-006**: Each lookup that consulted, or tried to consult, a registry MUST be given an
  unguessable lookup reference that the platform keeps for at least two hours, holding the
  registry's answer as the platform received it.
- **FR-007**: The lookup MUST answer within 8 seconds whatever the registries do; a registry that
  has not answered in its time limit counts as unavailable.

**Abuse protection**

- **FR-008**: Lookups MUST be limited per client address (10 per 10 minutes) and the registry calls
  they cause MUST be limited platform-wide per registry and time window (research R-7); over either
  limit the platform MUST contact no registry, and the White List budget MUST leave room for the
  administrator's "Validate now". A registry the Polish-sources setting excludes MUST consume none
  of its budget.
- **FR-009**: Answers MUST be cached per normalised tax ID (found: 6 hours; not found: 30 minutes;
  unavailable: 60 seconds), so repeated lookups of one company contact a registry at most once per
  period; a cached answer MUST NOT consume the budget.
- **FR-010**: The lookup MUST contact only the three fixed registry endpoints, MUST NOT forward any
  caller-supplied value other than the normalised tax ID, and MUST NOT reveal whether the tax ID
  belongs to an Organization on this platform.
- **FR-011**: The GUS key and GUS session id MUST never be logged, returned or persisted outside the
  credential store.

**Storefront**

- **FR-012**: When the lookup is on, the registration form MUST offer "Fetch company data" next to
  the tax ID; when off, it MUST render the manual form with no lookup control.
- **FR-013**: The lookup MUST work without JavaScript: the page comes back with the company fields
  prefilled, every other typed value except the password kept, the outcome message shown, and no
  typed value in the URL.
- **FR-014**: With JavaScript the lookup MUST run without a page reload, disable its button while
  running, show a loading state, announce the outcome in a polite live region, keep focus on the
  control that started it, and fetch on Enter in the tax ID field.
- **FR-015**: Every outcome of FR-001, and "too many lookups", MUST have its own message; none of
  them blocks registration.
- **FR-016**: Every prefilled field MUST stay editable; the submitted values are what registration
  stores.
- **FR-017**: A refused registration MUST keep every typed value except the password, and the
  lookup reference, without putting them in the URL.
- **FR-018**: The storefront MUST learn whether the lookup is on from a public, channel-independent
  endpoint, and MUST treat a failure to read it as "off".

**Registration and moderation**

- **FR-019**: The registration request MUST accept an optional lookup reference; the registry
  snapshot MUST be taken from the platform's own store by that reference and never from data the
  client sends.
- **FR-020**: When the lookup is on and the reference is known, unexpired and was issued for the
  same normalised tax ID and country as the registration, registration MUST persist one
  `OrganizationTaxIdValidation` row for the new Organization, marked as coming from registration,
  holding the registry snapshot, the registry attempts made, and the values the customer
  submitted; and stamp the Organization's last-validation summary. Otherwise it MUST persist
  nothing for the lookup and succeed.
- **FR-021**: A registration MUST NOT fail, slow down or contact a registry because of the lookup.
- **FR-022**: The admin VAT validation history MUST show where each row came from (administrator or
  registration), the VAT and activity status, the REGON and the failed attempts, and, for a
  registration row, each field where the submission differs from the registry with both values;
  differences only in case, diacritics, whitespace, punctuation or common Polish legal-form
  abbreviations MUST NOT count.
- **FR-023**: The moderation actions of a pending Organization MUST show how many fields differ
  from the registry, when any do.
- **FR-024**: The administrator's existing "Validate now" flow MUST behave as before.

**Configuration**

- **FR-025**: An `organizations` setting MUST switch the lookup on and off, platform-wide;
  changing it MUST take effect on the storefront without a restart.
- **FR-026**: The GUS key MUST be stored as a credential of a new type with a write-only, encrypted
  key and a production / test environment choice, selected by an `organizations` setting; with no
  credential selected, an unresolvable one, or `credentials` switched off, Polish lookups MUST use
  the White List alone under `gus_mf` and MUST answer `unavailable` under `gus`.
- **FR-026a**: An `organizations` setting MUST choose the Polish sources (`gus_mf` | `gus` | `mf`,
  default `gus_mf`), read per lookup with no restart; its description MUST state that `gus` without
  a configured GUS credential means no Polish lookup at all, and the Settings screen MUST show a
  warning beside it while `gus` is chosen and no GUS credential is selected.
- **FR-026b**: Answers MUST be cached per Polish-sources choice, so a change of choice never serves
  an answer fetched under another.
- **FR-027**: The settings MUST be reachable from the command palette.

**Language and documentation**

- **FR-028**: Every new storefront and admin string MUST ship in English and Polish.
- **FR-029**: The `organizations` module documentation MUST describe the lookup, its settings, the
  GUS credential, the providers and the abuse limits, in English and Polish.

### Key Entities

- **Registry lookup** — one answer of the lookup: the normalised tax ID and country, the outcome,
  the source registry, the company data, the attempts made against each registry, and when it was
  fetched. Short-lived; identified by its lookup reference.
- **Tax ID validation (extended)** — the existing per-attempt history row of an Organization, which
  now also records where it came from, the registry's extra details (REGON, VAT and activity
  status, attempts, fetch time) and, for a registration row, what the customer submitted.
- **GUS credential** — a credential configuration of a new type: the GUS key (secret) and the
  environment.
- **Polish sources choice** — an operator setting naming which registries answer for Polish NIPs;
  recorded with every lookup it governed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With healthy registries, a lookup not answered from cache completes in under 3
  seconds at the 95th percentile; a cached one in under 200 ms.
- **SC-002**: 100 % of registrations succeed whatever the lookup outcome, including a total
  registry outage (asserted per outcome).
- **SC-003**: An invalid NIP, an unsupported country, a disabled lookup and an exceeded limit cause
  zero registry calls, and a registry excluded by the Polish-sources setting receives zero calls
  (asserted by counting calls on the fakes).
- **SC-004**: Repeated lookups of one tax ID within the cache period cause exactly one registry call
  per registry.
- **SC-005**: A buyer without JavaScript completes fetch-then-register without retyping any value
  other than the password.
- **SC-006**: For every registration made after a lookup, the administrator sees the registry
  snapshot and every field difference on the Organization's page.

## Assumptions

- The lookup is channel-independent and platform-wide (OD-2); registration's existing channel
  binding is unchanged.
- Registration's own acceptance of a tax ID is unchanged: the checksum gates the **lookup** only,
  never the registration (an existing contract test registers `PL1234567890`, which fails it).
- Registration does not gain a VAT-status field; the lookup's VAT status is shown and persisted, not
  submitted.
- The admin "Validate now" flow keeps using the White List and VIES; offering GUS there is a
  follow-up, not this feature.
- Countries outside the EU VIES set have no lookup in this feature.
- The GUS, White List and VIES endpoints, test key, limits and response details recorded in
  research R-4 – R-6 are verified by a throwaway spike before implementation (tasks T001).
