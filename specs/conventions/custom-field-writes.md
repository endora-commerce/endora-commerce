# Custom-field writes — admin parity, admin access and buyer input

**Open this before adding or changing a path that writes custom-field values** — an admin create
or update of a record whose type takes custom fields, a dedicated values endpoint, a buyer input
surface, or anything that reads a definition's admin access. One of the bodies `AGENTS.md` routes
to; it is the single home for these rules, so never restate them in `AGENTS.md` or in a
tool-specific pointer file. The design they come from is `specs/175-buyer-input-custom-fields/`
(spec, research R-1 – R-13); the published, end-user description is the `custom_fields` and
`organizations` module documentation.

The values live in each host's own row (`custom_field_values`, `attribute_values` for products);
`custom_fields` owns the definitions and the validation, never the write. So every rule below is a
rule for the **host**: which writes carry values, through which validator, declared where.

## Admin parity

**Every admin endpoint that creates a record of a supported entity type accepts the record's
values in the create request**, under `customFieldValues`, validates them with the administrator's
rules (`CustomFieldValuePort.validateAndMerge`) and stores them **in the write that creates the
record** — inside the same Command where the create runs through one, before anything is written
otherwise. A create refused for its values creates nothing and answers the existing
`422 CUSTOM_FIELD_VALUE_INVALID`; the creation audit entry carries the stored values, as an admin
update already does for its changes (Principle XIII).

**Every admin endpoint that updates such a record accepts them likewise, or the host offers a
dedicated values endpoint for the record** (SD-1). A values endpoint (`PATCH …/:id/custom-fields`,
as `orders` and `customers` have) is the host's own audited write with its own concurrency rule,
so duplicating it into the general update would be two paths for one write. It satisfies the
update half only: values sent in a second request after a create are a second write, a second
audit entry and a window in which a required field is missing.

**`required` is enforced on every admin create**, also when the request sends no values. A
deployment with a required field of a type must supply it on every admin create of that type.

### Declaring the writes

Each host module exports, beside its manifest in `src/manifest.ts`:

```ts
export const customFieldWrites = [ … ] satisfies CustomFieldWriteDeclaration[];
```

The type is `@endora-commerce/contracts`'. Three shapes:

- a route — `{ entityType, kind: 'create' | 'update' | 'values', method, path, body }`, where
  `body` is the name of the contracts export the route validates with (`schema: { body: … }`);
- an exemption — `{ entityType, kind: 'create' | 'update', exempt: '<reason>' }`;
- a buyer surface — see *Buyer input* below.

**Every admin create and update of a custom-field host is declared**, including an update that
carries no values because a values endpoint covers it (`organizations`' member profile update is
the example). **An exemption says why the write carries no values**, in a sentence a reviewer can
check: `product` create and update are host-managed (a product's values are catalog attribute
values, written by the catalog's attribute surfaces), and the admin invitation creates no account.
An exemption with no reason is not an exemption.

**The export is literal source** — an array literal of object literals with string literals, no
spread, no constant, no call. It is read as text, never imported, so it cannot answer about a
previous build (D-164); a computed declaration is a finding, not a skip.

### What the check holds, and what it does not see

`check:custom-field-writes` (its row is in `check-inventory.md`) holds every declaration to the
route the declaring module registers and to the built contract that route validates with, every
supported entity type to a create and an update-or-values declaration, and every exemption to a
reason. Run it with `pnpm --filter backend run check:custom-field-writes` after
`pnpm run build:packages`.

**Its discovery is bounded, and the bound is accepted** (owner ruling of 2026-11-06): an
undeclared write is found only as a `POST` at a declared create's path or a `PATCH`/`PUT` at that
path's `/:id` child. An admin write under a wholly new path is invisible to it until it is
declared. **Declaring a new admin create or update of a custom-field host is therefore the
author's obligation**, in the merge request that adds the route — not something the check will
remind you of.

## Server-side writes

**Code with no admin request to ride on — a subscriber, an overlay module, an integration worker —
writes a host's values through the owner's published write port, never a native `UPDATE` of the
host's `custom_field_values`** (Principle I; the column is the host's, whatever module knows the
value). Today the two hosts that publish one are:

- `customer_accounts` — `customerAccountLifecycleWritePort.setCustomFieldValues(customerAccountId, merge)`;
- `organizations` — `organizationCustomFieldWritePort.setCustomFieldValues(organizationId, merge)`.

Both have the same shape, and a host that adds one copies it: **the merge is the caller's**, a
callback over the current bag that the owner runs between its own load and its own write, as one
Command with one audit row; **the owner does not validate**, so the caller calls
`CustomFieldValuePort.validateAndMerge` inside `merge` (the administrator's rules: an `internal`
field is accepted), and a refusal propagates unchanged and writes nothing; the actor is the
ambient one, never a parameter. The full statement is each contract's JSDoc.

**The ports are not `customFieldWrites` declarations, and `check:custom-field-writes` does not
know them.** Its subject is an HTTP write: a route it can hold to the module's registration and to
a request contract. A port has neither, and it adds no input surface a buyer reaches — the caller
validates with the administrator's rules, which the check has no way to observe at a call site.
Widening the check to ports would buy a declaration nothing can verify; the contract's JSDoc and
this section are the obligation instead.

## Admin access

A definition carries an admin access level — `edit` (the default), `read` or `hidden` — for
"system" fields that integrations or instance code maintain and an administrator should not change
by accident (OD-8). **It is a convenience of the admin panel, not access control** (FR-007):

- it changes nothing any API endpoint accepts, answers, filters, exports or audits — an API
  caller writes a `read` or `hidden` field exactly as an `edit` one, and no backend code may read
  the level to decide a request;
- `CustomFieldValuesPanel` (`@endora-commerce/admin-kit`) renders a `read` field without an input,
  omits a `hidden` one, and sends only `edit` keys in the bag it hands to `save` or `onChange`.
  **A host endpoint that receives that bag merges it** — an absent key is kept, never cleared — or
  it would erase the values the panel did not show;
- a host create screen reads a `422` refusal into the panel's `fieldErrors` through the kit's
  `customFieldErrorsOf`, never a copy of it.

**A `required` definition is `edit`** (SD-2): the administrator's validation re-checks every
required field on every save, so a required field the panel does not let anybody fill would make
every record lacking it unsaveable from the panel. The definition service refuses the combination
(`admin_access_required`). Enforcing `required` only where the field is editable was rejected: it
would change what `required` means for an API caller, who cannot be told apart from the panel.

## Buyer input

**Audience stays a read rule** (OD-1). Whether a buyer may *write* a field is a separate,
per-definition opt-in, `customerInput`: the input surfaces the field is open on, none by default.

- **Buyer input implies buyer visibility** (OD-2): a definition open on any surface has the
  `customer` audience, and a Page Builder definition is never open. Changing the audience to
  `internal` while the field is open is refused, both ways.
- **Surfaces are declared, not free text** (OD-3): a type offers buyer input only on the surfaces
  its entry in `custom_fields`' registry (`customerInputSurfaces`) names, and the surface names are
  `customFieldInputSurfaceSchema`'s. Today `organization` and `customer` offer
  `organization.register`.
- **Refuse, never drop** (OD-4, FR-011): a buyer-facing route validates through
  `CustomFieldValuePort.validateForCustomerInput(entityType, values, surface, language)` — **never**
  `validateAndMerge`, which drops unknown keys and enforces `required` across every definition. Any
  key that is not a live definition of that type open on that surface is refused
  `not_open_for_input`, naming the field.
- **`required` only among the open definitions** (FR-012); the administrator's type rules apply
  exactly (FR-013), plus the buyer limits: text at most 1 000 characters after trimming, a
  whitespace-only text is empty, at most 50 keys per entity type, refused `too_many_keys` before any
  definition is read.
- **A refusal is the existing `422 CUSTOM_FIELD_VALUE_INVALID`** (FR-014), one entry per field
  with its code. The backend words each entry for the buyer in the request's language and keeps
  the code beside it (`module-i18n.md`, case 1): pass `request.responseLanguage()` as `language`.
  No entry's sentence names the definition key or echoes the typed value, and a consumer renders
  the sentence it was given rather than keeping its own catalogue of the codes.
- **Values are written with the record** (OD-5), validated before the first write, so a refused
  request leaves nothing behind. The audit entry of an anonymous write records the **keys** it
  stored, never the values: a value may be personal data.

### Adding a surface

1. Add its name to `customFieldInputSurfaceSchema` in `@endora-commerce/contracts`.
2. Name it in the `customerInputSurfaces` of each entity type that offers it, in `custom_fields`'
   registry, and give it a label in `custom_fields`' bundles
   (`customFields.customerInput.surface.<name>`, `en` and `pl`).
3. In the host that owns the form's route: carry each type's values in the request contract,
   validate them through `validateForCustomerInput` before any write, and declare one
   `{ entityType, kind: 'buyer-input', surface, method, path, body, at, test }` per type — `at` is
   the dotted path of the values inside `body`, `test` a contract test that names the surface and
   asserts a `not_open_for_input` refusal.
4. The public read `GET /api/v1/custom-fields/input-surfaces/:surface` answers the open fields with
   no code change; a storefront renders them from it.

`check:custom-field-writes` refuses a surface the registry opens with no buyer-input declaration,
a declaration the registry does not open, a body with nothing at `at`, and a `test` that is missing
or names neither the surface nor the refusal.
