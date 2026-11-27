---
title: Writing categories from server code
---

# Writing categories from server code

Another module, an overlay module or an integration worker (a PIM or ERP
connector) writes a category through **`catalogCategoryCommandPort`**, the
Category aggregate's write port, declared as `CatalogCategoryCommandPort` in
`@endora-commerce/contracts`. It never writes the `categories` table itself.
Resolve it per use with
`lazyPort<CatalogCategoryCommandPort>(ctx, 'catalogCategoryCommandPort')`, with
`catalog` in the calling module's manifest `dependencies`.

| Method | Audit action | What the admin does the same way |
| --- | --- | --- |
| `create(input, options?)` | `category.create` | `POST /api/v1/admin/catalog/categories` |
| `update(id, input, options?)` | `category.update` | `PATCH /api/v1/admin/catalog/categories/:id` |
| `move(id, { parentId, position? }, options?)` | `category.update` | the same `PATCH`, with the parent and the sort order |
| `delete(id, options?)` | `category.delete` | `DELETE /api/v1/admin/catalog/categories/:id` |
| `setCustomFieldValues(id, merge, options?)` | `category.update` | the same `PATCH`, with custom-field values only |
| `setInventoryThresholds(id, { high?, medium?, low? }, options?)` | `category.inventory_thresholds.set` | the category rows of `PATCH /api/v1/admin/inventory/thresholds` |

To read categories — the tree, one category, its ancestors — use
`catalogCategoryReadPort`.

## One write path

Each method runs the same Command the admin endpoint runs, built by the same
code, so the two cannot write differently: one audit entry with the same state,
and the same event. When a category is updated or moved, or its custom-field
values change, the storefront's category navigation is refreshed and the
products in the category's subtree are re-indexed for search, exactly as after
an edit in the admin. A created category joins the default sales channel when
it belongs to none, as from the admin.

Inputs are the endpoints' request bodies and are checked with the same rules;
refusals are the endpoints' errors with their codes:

- `422 VALIDATION_FAILED` — an input outside the endpoint's rules, for example
  a slug that is not lower-case words joined by hyphens;
- `404 NOT_FOUND` — an unknown or deleted category or parent;
- `409 CATEGORY_SLUG_TAKEN` — the slug is already used under that parent;
- `409 CATEGORY_MOVE_CYCLE` — the new parent is the category itself or one of
  its descendants;
- `409 CATEGORY_HAS_CHILDREN` — `delete` of a category that still has
  subcategories;
- `422 CUSTOM_FIELD_VALUE_INVALID` — a custom-field value that the field's
  definition refuses, on `create` and `update`.

## Who wrote it

The actor is the ambient one, never a parameter: an administrator inside an
admin request, or under `withSystemScopeActingFor`; the **system** actor under
`withSystemScope` in a worker, which records no administrator. With no tenant
context at all the write is refused before anything is stored. The port checks
no permission — the caller is the gate — so never resolve it for a
customer-facing route.

## Options

The last parameter of every method:

- `source` — a lower-case code naming the integration (`pim`, `pim.categories`,
  at most 64 characters), recorded as `source` in the audit entry beside the
  actor. It is what tells two integrations apart when both write as the system.
  Any other value is refused with `422 VALIDATION_FAILED` before anything is
  read or written.
- `expectedVersion` — ignored: a category has no version.
- `extensions` — input for command hooks. No category action accepts hooks
  yet, so any key is refused with `422 COMMAND_EXTENSION_UNCLAIMED` before
  anything is written.

## Moving, custom fields and thresholds

**Moving.** `move` sets the parent — `null` makes the category a root — and,
when you pass `position`, the sort order the tree is ordered by among its
siblings. It is the admin's edit of the same two fields, so it is recorded as
`category.update`.

**Custom fields.** `setCustomFieldValues` loads the category, calls your
`merge` with a copy of its current values and stores what `merge` returns, in
one write. It does not check the values: call
`CustomFieldValuePort.validateAndMerge` inside `merge`, and an error it throws
reaches you unchanged with nothing written. It is recorded as
`category.update`, like the admin edit, so a command hook on that action sees
both.

**Inventory thresholds.** `setInventoryThresholds` sets the category's three
stock display-band thresholds. A key you leave out is left as it is, and
`null` clears the category's own value. A call that changes nothing records
nothing. The Inventory module's threshold screen writes the category rows
through this method, and its own `low_stock_threshold.update` entry records
only the global and per-product thresholds.

## Not offered

The category's page content (its own screen), category import (the bulk
import), assigning products to a category (a product edit) and a category's
sales channels beyond the default one given on creation.

## The earlier port

`catalogCategoryWritePort` is **deprecated since 0.113.0** and will be removed
in a later release. Every method still works and writes the same entries:

| Old call | New call |
| --- | --- |
| `catalogCategoryWritePort.listAll()` | `catalogCategoryReadPort.listAll({ liveOnly: true })` |
| `catalogCategoryWritePort.create(input)` | `catalogCategoryCommandPort.create(input, options?)` |
| `catalogCategoryWritePort.update(id, input)` | `catalogCategoryCommandPort.update(id, input, options?)` |
| `catalogCategoryWritePort.setInventoryThresholds(id, patch)` | `catalogCategoryCommandPort.setInventoryThresholds(id, patch, options?)` |

Two differences when you move: the new `create` and `update` check their input
against the admin endpoint's rules, which the old methods did not; and since
0.113.0 a threshold change is recorded as `category.inventory_thresholds.set`,
through either port.
