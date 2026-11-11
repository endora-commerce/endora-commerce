# Contract — admin panel behaviour, and the custom-field writes check

## 1. `CustomFieldValuesPanel` (`@endora-commerce/admin-kit`)

File: `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx`.
Props unchanged (`entityType`, `values`, `save?`, `onChange?`, `fieldErrors?`, `language?`).

| `adminAccess` | Rendered | In the bag passed to `save` / `onChange` |
| --- | --- | --- |
| `edit` | input, as today | yes |
| `read` | label + formatted value (or "—"), no input, `aria-readonly` text | **no** |
| `hidden` | nothing | **no** |

- The draft is still initialised from `values`, but the outgoing bag is **projected to `edit` keys**
  (FR-038). The server merge keeps absent keys, so `read`/`hidden` values are never overwritten from
  the panel — including a value an integration wrote after the page loaded.
- A refusal entry for a non-`edit` key is shown at the top of the panel: "<label> (<access level>):
  <message> — change it on the Custom fields screen", using the definitions already loaded.
- If every definition is `hidden`, the panel renders nothing (as for "no definitions").
- Bump `@endora-commerce/admin-kit`: **minor** (observable behaviour change of a published
  component: the bag handed to `save` no longer contains non-`edit` keys). Every in-tree caller sends
  that bag as a patch to a merging endpoint, so none changes.

## 2. Definition editor and list (`custom_fields` admin)

- *Collect from the buyer at registration* — a checkbox per surface in
  `entityTypeInfo.customerInputSurfaces`; hidden when the list is empty; disabled with a reason while
  `audience = internal` or `valueType = page_builder` (FR-035).
- *Admin access* — a three-option select on every definition (catalog attributes included, through the
  catalog attribute editor's use of the same apply seam), with the help sentence "Read-only and hidden
  only change this admin panel. They do not restrict the API, filters, exports or the audit log."
  (FR-036); `read`/`hidden` disabled with a reason while `required` is ticked, and vice versa (SD-2).
- Definitions list: badges "Registration" and "Read-only" / "Hidden"; every definition listed.
- All strings en + pl in `packages/modules/custom_fields/i18n/{en,pl}.json` (FR-047).

## 3. Host create screens (FR-039)

`CustomFieldValuesPanel` in **embedded mode** (`onChange`, no `save`) on:

| Screen | Host |
| --- | --- |
| category create and edit (`packages/modules/catalog/src/admin/pages/CategoriesTree.tsx` / `CategoryContentPage.tsx` — the plan's WP-5 picks the form) | `catalog` |
| `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx` | `orders` |
| `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx` | `quote_requests` |
| the "New organization" form and the member direct-create dialog | `organizations` |

The host sends the embedded bag as `customFieldValues` in its own create request and maps 422 entries
to `fieldErrors`.

## 4. `check:custom-field-writes`

Rule `packages/cli/src/rules/custom-field-writes.ts`; repository host
`backend/scripts/check-custom-field-writes.ts`; script `check:custom-field-writes` in
`backend/package.json`; `quality:static` job; estate verdict `package`.

**Population.** `supportedEntityTypeSchema.options` (from built contracts) and the manifest index's
modules; each module's `src/manifest.ts` export `customFieldWrites` read as literal AST (a computed
value is a finding, not a skip).

**Findings** (one red proof each, entering at source text / fixture tree):

| Kind | Fires when |
| --- | --- |
| `entity-type-undeclared` | a supported type lacks a `create` declaration or exemption, or lacks an `update`/`values` declaration or exemption |
| `create-without-values` | a `create` body has no `customFieldValues` |
| `update-without-values` | an `update` body has none and no `values` declaration exists for the type |
| `declared-route-missing` | method + path not registered in the declaring module, or registered with a different `schema.body` identifier |
| `undeclared-write-route` | a `POST` at a declared `create` path, or a `PATCH`/`PUT` at `<create path>/:id`, that no declaration names |
| `exemption-without-reason` | `exempt` empty or whitespace |
| `surface-without-contract` | a registry surface for a type has no `buyer-input` declaration, or its body lacks the field at `at` |
| `surface-without-test` | the declared `test` file is missing or does not mention both the surface name and `not_open_for_input` |
| `computed-declaration` | `customFieldWrites` is not a literal array of literal objects |

**Exit codes.** 0 clean, 1 findings, 2 nothing read / short read / contracts not built / no manifest
index. **Read line** via `backend/scripts/lib/read-size.ts`:
`[custom-field-writes] read: files=<opened> sites=<declarations> sources=entity-types:<n>/<n>,manifest-index:<m>/<m>`.
It prints every exemption it honoured with its reason.

**Obligations** (`specs/conventions/check-estate.md`): entry in
`backend/test/unit/scripts/check-inventory.test.ts`, row in `specs/conventions/check-inventory.md`,
companion test `backend/test/unit/scripts/check-custom-field-writes.test.ts`, estate manifest entry in
`packages/cli/src/check/estate.ts`, recorded read size in `backend/test/helpers/check-read-sizes.ts`
measured from a fresh worktree, `moved-module-tree` residue guard as the inventory requires for a
module walk.
