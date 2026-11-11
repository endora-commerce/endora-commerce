---
title: Custom fields
description: Typed fields an operator adds to orders, quote requests, opportunities and other records without a code change, edited on one screen, offered as filters on the admin lists and carried from one record to the record created from it.
---

# Custom fields (`custom_fields`)

Custom fields let an operator add their own typed fields to the platform's records — a purchase
order reference on an order, a region on a quote request, a lead source on a sales opportunity —
as data, with no code change and no migration. A field is defined once, on **Custom fields**
(`/custom-fields`), and from then on it is filled in, shown and, where the list offers it,
filtered on wherever records of that kind are handled.

## The records that take custom fields

| Records | Offered | Can be a list filter |
| --- | --- | --- |
| Orders | always | yes — the Orders list |
| Quote requests | while the `quote_requests` module is on | yes — the Quote requests list |
| Sales opportunities | while the `crm` module is on | yes — the Opportunities list |
| Organizations | always | no |
| Customers | always | no |
| Categories | always | no |
| Products | managed on **Catalog → Attributes**, read-only here | no |

**A type that follows a module disappears with it.** While `quote_requests` is switched off, quote
request fields are not listed, cannot be created or edited, and are not offered by the definitions
API — exactly as opportunity fields are while `crm` is off. Nothing is deleted: the fields, their
options and every stored value come back unchanged when the module is switched on again.

## Creating a field

Choose the record type on **Custom fields**, then press **New field** above the table (or **Add a
field** when the type has none yet). The field is defined completely in one dialog — the same form
that later edits it, with the same sections in the same order:

1. **Definition**
   - **Record type** — preset to the type the page shows; any type this screen manages can be
     chosen.
   - **Type** — *Text*, *Number*, *Yes / No*, *Date*, *Single choice* or *Multiple choice*.
   - **Key** — the field's identifier: lower-case letters, digits and underscores, starting with a
     letter, at most 64 characters (`po_number`). It never changes once the field exists.
2. **Labels** — the **default label** (required) and one label per admin language, today English and
   Polish. A record shows the label in the reader's language and falls back to the default label.
3. **Options**, for *Single choice* and *Multiple choice* — **Add option** adds a row with:
   - its **stored value**, what records hold — unique within the field;
   - its **default label** (required) and a label per admin language;
   - **Default**, the option a new record starts with. A *Single choice* field can have one default
     option at most; a *Multiple choice* field can have several. Neither needs one;
   - **Move up** / **Move down**, the order the options are offered in, and **Remove**.
   The options are saved together with the field, so nothing is written until **Add field**.
4. **Rules**
   - **Required** — a record cannot be saved without a value.
   - **Who can see the value** — *Internal* (administrators only, the default) or *Customer* (also
     returned to the customer in the storefront and to integrations using the external API).
   - **Admin access** — *Editable* (the default), *Read-only* or *Hidden*: how the field appears in
     the admin panels where records are edited. See [Admin access](#admin-access).
   - **Collect from the buyer at registration** — offered for Organization and Customer fields
     only. See [Collecting a field from the buyer](#collecting-a-field-from-the-buyer).
5. **Behaviour**
   - **Use as list filter** — offered only for orders, quote requests and opportunities. See
     [List filters](#list-filters).
   - **Carry value to …** — one checkbox per record type the value can follow, each with its own
     help line, offered only for quote requests, orders and opportunities. See
     [Carrying values between quote requests, orders and opportunities](#carrying-values-between-quote-requests-orders-and-opportunities).

**Add field** creates the field with everything above in one step. Before anything is sent the
dialog checks the key's format, the default label, that every option has a stored value used by no
other option and a default label, and the number of default options; each problem is said next to
the field it concerns, and focus moves to the first one. A refusal from the server is shown the same
way — a key already used on the record type at the key, for example — and the dialog keeps
everything you entered.

**Delete** (the bin) asks in place before a field is deleted. Creating, editing and deleting fields
needs the `custom_fields:write` permission; an administrator with `custom_fields:read` only sees the
table, without any control that changes it.

## Editing a field

Each row of the table has an **Edit** button (the pencil). It opens the same form as **New field**.
The record type, the key and the type are shown as fixed text; the rest can be changed:

- **Labels** — the default label (required) and the label per admin language.
- **Options** of a choice field — each option is changed on its own, at once, without pressing
  **Save**:
  - its default label and its label per language, saved when you leave the field or press Enter;
  - **Default**, the option preselected for a new record — on a *Single choice* field, clear the
    current default before marking another;
  - **Move up** / **Move down**, which changes the order the option is offered in;
  - **Remove**, after a confirmation inside the dialog. An option that any record still holds
    cannot be removed: the dialog says so at the option, naming it by its label, and asks you to
    change those records' value first;
  - **Add option**, with its stored value — not one another option already uses — and labels.
  An option's **stored value** never changes — it is what records hold — so relabelling an option
  keeps every record and every filter on it working.
- **Required** — switching it on explains what follows: records that already exist keep their
  values, and a record without a value for this field is asked for one the next time its custom
  fields are edited. Nothing is filled in for you.
- **Who can see the value** — the same choice the table's *Visible to* column offers. A change that
  would stop a carry from working asks first, as it does from the table.
- **Admin access** and **Collect from the buyer at registration**, with the same rules as when the
  field is created.
- **Use as list filter**, where the record type offers it.
- **Carry value to …**, where the record type offers it — one checkbox per target, each with its
  own help line.

Option changes are saved as soon as you make them, so once one is made the dialog's **Cancel**
reads **Close**. **Save** sends only what you changed, and nothing at all when nothing changed. If the change is
refused, the dialog stays open with the reason. Every change is recorded in the audit log as a
change to the field.

**What cannot change.** The key, the record type and the type are fixed once the field exists. To change
them, create a new field. An option still in use cannot be removed. No edit ever changes a value a
record already holds.

## Admin access

Some fields are maintained by an integration or by the instance's own code — a sync checksum, an
external customer number — and an administrator should not change them by accident. **Admin
access** says how such a field appears in the admin panels where records are edited (an order,
an organization, a customer, a category, a quote request):

| Admin access | In the admin panel |
| --- | --- |
| *Editable* (the default) | an input, as for every field |
| *Read-only* | the label and the stored value (a dash when there is none), without an input |
| *Hidden* | not shown |

Saving a panel sends only the editable fields, so a read-only or hidden value is never overwritten
from the panel — also one an integration wrote after the page was opened. If a save is refused
because of a read-only or hidden field (its stored value no longer fits the field, for example),
the panel says which field and that it is changed on **Custom Fields**.

**Admin access is a convenience of the admin panel, not access control.** Read-only and hidden
fields stay readable and writable through the API, can still be list filters, and are exported and
recorded in the audit log exactly like editable ones. Whoever may edit a record through the API may
change these values; to keep a value away from someone, use permissions, not admin access.

**A required field must stay editable.** A field cannot be both required and read-only or hidden:
every save of a record checks every required field, so a required field nobody can fill in the
panel would make every record without a value impossible to save there. The form makes *Read-only*
and *Hidden* unavailable while **Required** is ticked, and **Required** unavailable while the field
is not editable, each with the reason. The definitions table shows every field whatever its admin
access, with a *Read-only* or *Hidden* badge.

Product attributes have the same setting, on **Catalog → Attributes**.

## Collecting a field from the buyer

A field can be filled in by the buyer on the storefront's registration form, so that information
you need about a new business customer — how they heard about you, their industry, a phone number
— arrives with the registration rather than in a later e-mail. Tick **Collect from the buyer at
registration** on the field:

- **Organization** fields appear in the company section of the B2B registration form and are stored
  on the new Organization; **Customer** fields appear in the personal section and are stored on the
  account of the person registering.
- The storefront shows the fields that are ticked, each with its label in the shop's language,
  required ones marked, without a code change; a change on **Custom Fields** reaches the form within
  minutes.
- **Only fields visible to customers can be collected.** The option is unavailable, with the reason,
  while *Who can see the value* is *Internal* — a buyer is never asked for a value they could not
  read back — and for a Page Builder field. Changing a collected field to *Internal* is refused
  until the option is unticked.
- A collected field may be read-only or hidden in the admin panel, unless it is required.
- The definitions table marks collected fields with a *Registration* badge.

**What the buyer may send, and what is refused.** The registration accepts values only for fields
ticked for it — any other key, an internal field, a field of the other record type or one that
does not exist is **refused, never ignored**, and the registration is not made. A required
collected field must be filled in; a required field that is not collected is not asked for at
registration. Every value is checked like a value an administrator types (type, options, dates,
numbers), plus three limits for an anonymous writer: text is at most 1 000 characters after
surrounding spaces are removed, text of spaces only counts as empty, and at most 50 fields per
record type may be sent at once. Each refusal is said beside its field, in the buyer's language; a
refused registration creates nothing.

A collected value is personal data like the rest of the account: anonymising a customer clears
their custom-field values, and the registration's audit entry records which fields were filled in,
never their values.

Collecting from the buyer is offered on one form today, the B2B registration. A storefront
scaffolded before this option existed needs a small change to show the fields; the `organizations`
module documentation describes it.

## List filters

**Use as list filter** offers the field as a filter on the admin list of its records: the Orders
list for an order field, the Quote requests list for a quote request field, the Opportunities list
for an opportunity field. The table on **Custom fields** shows which fields are list filters in its
*List filter* column. Turning the option on or off changes no stored value.

The filter is labelled with the field's label in the administrator's language, falling back to the
default label, and works by type:

| Type | Filter | A record matches when |
| --- | --- | --- |
| Text | the text it contains | its value contains the text, letter case ignored |
| Number | a lowest and a highest value, either optional | its value is within the range, both ends included |
| Date | from a day, to a day, either optional | its date is within the range, both days included |
| Yes / No | *Any*, *Yes* or *No* | *Yes* matches yes, *No* matches no |
| Single choice | one or more options | it holds any of them |
| Multiple choice | one or more options | it holds any of them |

**A record without a value never matches** a custom-field filter — not even *No* on a yes/no field.
Several values of one field match any of them; filters on different fields, and the list's own
filters, must all match. The filter narrows the whole list — its total and every page — not only
the rows on screen, and it stays within what the administrator may see.

On every list the filters are in the page address, so a filtered list can be bookmarked or sent to
a colleague, and changing a filter returns the list to its first page. On the Orders and Quote
Requests lists they are also shown as removable chips beside the other active filters and are kept
in saved views.

**A filter that is no longer available.** If a field's option has been switched off, or the field
deleted, since an address was written, the list refuses the request and says so by the field's
name, with **Remove this filter**. A saved view is checked when it is loaded instead: a filter it
holds that is no longer available is dropped, with a notice naming it, before the list is asked
for, and the rest of the view loads. An option removed from a field since is dropped from the
filter quietly — no record can hold it.

**Opportunities: the list and the board are separate.** The board's filters follow what its cards
show; the Opportunities list's custom-field filters follow this option. A field can be one without
being the other. A board card field that is not a list filter cannot be used to filter the
Opportunities list — a link that filtered the list by it is refused until the option is turned on
— and the board, its *Show more* included, is unchanged.

There is no custom-field filter on the storefront or on any API-key endpoint. Filtering on an
*internal* field is an administrator's tool and reveals nothing the list did not already show.

## Carrying values between quote requests, orders and opportunities

When one record is created from another — an order placed from a quote request, a sales opportunity
opened for an order — a field can hand its value on to the field **with the same key** on the new
record. A quote request field `order_source` holding *Trade fair* then gives the order placed from
that request an `order_source` of *Trade fair*, without anybody typing it again.

### The pairs

The option sits on the field the value comes **from**. Five pairs are offered:

| A field on | can carry its value to | when |
| --- | --- | --- |
| Quote requests | Orders | the customer places the order from the accepted quote request (see *Orders*) |
| Quote requests | Opportunities | the CRM opens an opportunity for the request |
| Orders | Opportunities | the CRM opens an opportunity for the order, or the order joins the opportunity of the quote request it was placed from |
| Opportunities | Quote requests | an administrator creates the quote request from the opportunity |
| Opportunities | Orders | an administrator creates the order from the opportunity |

No other record type offers the option: a Category, Product, Customer or Organization field shows
no **Carry value to …** checkbox. An order field is not offered *Quote request* — an order cloned
into a quote request by the customer receives no carried value. Fields that follow a module follow
it here too: while `crm` is switched off no checkbox names opportunities and opportunity fields are
not listed, while `quote_requests` is off the same holds for quote requests, and nothing is carried
into or out of those records. The options are kept, and work again once the module is back;
records created in the meantime are not filled in afterwards.

### What is carried, and when

- **Once, when the records are joined.** A value is carried when the new record is created or
  joined to its source, and only then. Editing either record later changes nothing on the other.
  Turning the option on or off changes no stored value and fills in no record created earlier.
- **Only into an empty field.** If the new record already holds a value for the key — typed in, or
  carried from an earlier document — that value is kept. When two orders join one opportunity with
  different values, the first fills the opportunity's field and the second leaves it alone.
- **Only a value.** An empty source field carries nothing and never clears the target. A value left
  on a record by a field that has since been deleted is not carried.
- **Only within one organization.** Both records always belong to the same organization; a pair of
  records of different organizations carries nothing.
- **Never in the way.** Carrying never makes a checkout, an order or quote request created by an
  administrator, or an opportunity fail. Another required field left empty on the new record does
  not stop a value from being carried, and carrying adds no new reason for a record to be refused.
- **A manual link carries nothing.** Linking an existing order or quote request to an opportunity on
  the opportunity's *Links* tab, or from the *Linked opportunity* panel of the document, carries no
  value in either direction and records nothing.

### When the option can be turned on

**Carry value to …** is accepted only when the target record type has a field with the same key
that can hold the value. Otherwise saving is refused, the dialog stays open, and the
message names the reason:

| Refusal | Means |
| --- | --- |
| No field with the key on the target | Create the field on the target record type first. |
| Different type | The two fields must have the same type. Nothing is widened: *Single choice* does not carry into *Multiple choice*, and no type carries into *Text*. The message names both types. |
| Missing options | For a choice field, every option's stored value on this field must exist on the target. The labels may differ and the target may have more options. The message lists the missing values. |
| Visible to customers | This field is *Internal* and the target field is *Customer*. An internal value would become visible to customers, so this is refused — change one of the two fields' audience first. *Customer* to *Internal*, and two fields of the same audience, are accepted. |
| Switched off | The target record type's module is switched off. |

Carrying changes no field's audience: whoever may read the **target** field reads the value carried
into it. Turning the option on or off is a change to the field like any other, recorded in the
audit log.

**An opportunity field's audience is about the document it carries into.** Opportunities are seen
by administrators only, so *Who can see the value* changes nothing on the opportunity itself. What
it decides is where the value may go: an opportunity field set to *Customer* may carry into an
order or quote request field that is visible to customers, and the customer then sees the value
on that order or request. Leave an opportunity field at *Internal*, the default, unless its value
is meant for the customer.

### Changing a field that carries, or receives

A field that is part of a carry can still be changed or deleted. Before a change that would stop
values from carrying, the screen warns you and lists every field on the other side, as
*record type · key*:

| You are about to | The warning appears when | The button that goes ahead |
| --- | --- | --- |
| remove an option (**Remove** in the dialog) | a field carrying into this one has that option | **Remove option anyway** |
| add an option (**Add option**) | this field carries to a field that lacks it | **Add option anyway** |
| change *Who can see the value* in the table | this field would become *Customer* while a field carrying into it is *Internal*, or *Internal* while it carries to a *Customer* field | **Change audience anyway** |
| delete the field (the bin) | it carries to, or receives from, any field | **Delete field anyway** |

The removal and deletion buttons are red, like every destructive action. **Cancel** changes
nothing. A change that breaks no carry asks nothing more than it did before — and where the warning
appears, it replaces the usual confirmation for that removal or deletion rather than adding a
second one. The type of a field cannot be changed on this screen, so there is no warning for it.

Going ahead keeps the **Carry value to …** option as it was. The table's **Carries to** column
lists the record types each field carries to; a carry that no longer works is marked
**Incompatible**, with the reason — the missing field, the two types, the missing options or the
audience — written under the mark. The mark clears as soon as the fields match again or the option
is turned off.

### A value that is not carried

The mark is a warning, not a switch: a carry marked *Incompatible* still runs, and each value is
judged against the target field **as it is when the record is created**. A choice value whose
option the target has since gained is carried; a carry the table showed as fine is skipped if the
target no longer fits by then.

A value that cannot be carried is skipped, the record is created all the same, and the new record
says what was left out — **one** entry per conversion, naming every skipped field once with its
reason:

| Target | Where the entry is |
| --- | --- |
| Order | an internal note by *System* in the order's comments — never shown to the customer and sending no notification |
| Quote request | an entry by *System* in the request's History — in the Admin UI only, never in the customer's view of the request |
| Opportunity | the entry of its creation, or of the order joining it, in its *Change history* |

The reasons are: the target has no field with the key, the target field's type differs, the target
field is visible to customers while the source field is internal, or the value does not fit the
target field — for example a choice whose option the target lacks. A conversion
that skips nothing records nothing.

Each entry names a field by **the label of the field the value came from, as it read when the value
was skipped**, in the reader's language, so anybody who may see the record can read which field it was — `custom_fields:read` is
not needed for that, and renaming or deleting the field later does not change the entry. The entry
holds only the field's name and the reason, never a value; custom-field values themselves stay
visible only with `custom_fields:read`, as before. An entry recorded before field names were kept
with it names the field by its key — the field's current definition is not looked up.

## For integrators

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/custom-fields/entity-types` | `custom_fields:read` | The entity types offered now, each with `listFilter`: whether its fields may be list filters, `carryTargets`: the types its fields may carry to, leaving out a type whose module is switched off, and `customerInputSurfaces`: the buyer input surfaces its fields may be opened on (`organization.register` for `organization` and `customer`, `[]` otherwise). |
| `GET /api/v1/admin/custom-fields/definitions?entityType=…` | `custom_fields:read` | The fields of a type, each with `listFilter` and `carryTo`, the types it carries to (a type whose module is switched off is left out). |
| `POST /api/v1/admin/custom-fields/definitions` | `custom_fields:write` | Create a field; `listFilter` is optional and refused with `422` for a type that does not offer it; `carryTo` is optional (default `[]`); `customerInput` (the surfaces the field is open on, default `[]`) and `adminAccess` (`edit`, `read` or `hidden`, default `edit`) are optional. |
| `PATCH /api/v1/admin/custom-fields/definitions/:id` | `custom_fields:write` | Change `labelDefault`, `label`, `required`, `audience`, `listFilter`, `carryTo` (the whole new list), `customerInput` (the whole new list) or `adminAccess`; absent members are left as they are. Only a **newly added** `carryTo` entry is judged, so re-sending a carry that has since become incompatible is accepted, and an entry naming a switched-off module is kept whatever the list sent. |
| `POST`, `PATCH`, `DELETE …/definitions/:id/options[/:optionId]` | `custom_fields:write` | Add, change (labels, `isDefault`, `sortOrder` — never `value`) or remove an option. `409` for an option in use. |
| `GET /api/v1/custom-fields/input-surfaces/:surface` | none — anonymous, also on a store closed to anonymous visitors | The fields open on a buyer input surface, per entity type in their order: `key`, `valueType`, `required`, `label` and option `label`s in the request's language (falling back to the default label), `options` and `sortOrder`. Never a stored value, the audience, the admin access or an internal field. An unknown surface answers `200` with `entities: {}`. |

Every definition answers `customerInput` and `adminAccess`. `adminAccess` is read by the admin
panels only: no endpoint accepts, answers, filters, exports or audits a value differently because of
it.

The definition and option routes refuse with these codes:

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `409` | `CUSTOM_FIELD_OPTION_IN_USE` | removing an option that a record still holds | `value`, `label` — the option's stored value and default label |
| `409` | `CUSTOM_FIELD_VALUE_TYPE_LOCKED` | changing the value type of a field while records hold values | `key` |
| `409` | `CUSTOM_FIELD_STORED_VALUES_EXIST` | creating a *Customer*-visible field under a key whose values a deleted field left on records — create it as internal first | `key` |
| `422` | `CUSTOM_FIELD_DEFINITION_INVALID` | an invalid definition, among them `listFilter` on a record type that does not offer it (`list_filter_unsupported`), and four about buyer input and admin access: `customer_input_unsupported` (a surface the record type does not offer), `customer_input_audience` (open on a surface while *Internal*), `customer_input_value_type` (a Page Builder field opened on a surface) and `admin_access_required` (required while read-only or hidden) | `code` and `reason` for those four, and `key` |
| `422` | `CUSTOM_FIELD_CARRY_INCOMPATIBLE` | turning on a `carryTo` entry the target cannot take | `code` — `target_missing`, `value_type_mismatch`, `options_missing`, `audience_mismatch`, `pair_unsupported` (a pair that is not offered, the field's own type included) or `target_unavailable` (the target's module is switched off); `targetEntityType`, `key`; `sourceValueType` and `targetValueType` for a type mismatch; `missingOptionValues` (a comma-separated string) and `missingOptionValueList` (an array) for missing options |

The three lists take the filters as a request parameter:

- `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/export` and
  `GET /api/v1/admin/quote-requests` take `customFieldFilters`, a URL-encoded JSON object keyed by
  field key: `{"region":{"in":["north"]},"weight":{"min":"1.5"}}`.
- `GET /api/v1/admin/crm/opportunities` takes the same filters as `custom:<key>` references in
  `fieldFilters`.
- Each list answers its offered fields at `…/custom-field-filters` — `GET
  /api/v1/admin/orders/custom-field-filters`, `…/quote-requests/custom-field-filters` and
  `…/crm/opportunities/custom-field-filters`.

The operators are `contains`, `in`, `is`, `min` / `max` (decimal strings) and `from` / `to`
(`YYYY-MM-DD`). At most 10 fields and 100 `in` values in all per request. A field that is not a list
filter of that list answers `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE`, with the refused key in
`details.key`. An inverted range — `min` above `max`, `from` after `to` — and an operator that does
not apply to the field's type (`contains` on a number, say) answer `400` `VALIDATION_FAILED`
naming the field and operator: neither is ignored.

A value a buyer sends on an input surface is refused with the platform's custom-field refusal,
`422` `CUSTOM_FIELD_VALUE_INVALID`, one `details` entry per field with its `code` and a `message`
worded for the buyer in the request's language — which never names the key or repeats the value. Two
codes exist only there: `not_open_for_input` (the field is not open on the surface, or does not
exist) and `too_many_keys` (more than 50 fields of one record type). The others — `missing_required`,
`wrong_type`, `out_of_range`, `unknown_option`, `duplicate_option` — are the ones an administrator's
values are refused with. Which route carries the values, and how it names each field in `details`,
is the host's: for registration, the `organizations` module documentation.
