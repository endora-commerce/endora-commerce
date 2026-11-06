---
title: Global search
description: Global search in the admin — find organizations, customers, orders, quote requests, sales opportunities, products and categories from the command palette, with configurable searchable fields
---

# Global search (`admin_search`)

Global search lets an administrator find a record without first deciding which
list holds it. Press **⌘K** (macOS) or **Ctrl+K**, or click the search field at
the top of the sidebar, and type part of an order number, an e-mail address, a
tax ID, a SKU or a name: below the screens and actions the command palette
already lists, matching records appear grouped by type. Arrow keys and **Enter**
open the chosen record's own screen.

The module owns no table. Each record type is contributed by the module that
owns the records, which decides which fields it can be searched by and applies
the same visibility rules as its own admin list. This module holds the
configuration, the search itself and two screens.

## What is searched

Records are searched live, so a change is findable as soon as it is saved. The
record types, in the order their groups appear:

| Record type | Fields offered (searched by default in **bold**) | Opens |
| --- | --- | --- |
| Orders | **Order number**, **Organization name**, **Customer name or e-mail**, Billing company name, Billing tax ID | the order |
| Quote requests | **Quote Request number**, **Organization name**, **Customer name or e-mail**, Customer's note | the quote request |
| Sales opportunities | **Opportunity number**, **Title**, **Organization name**, Description | the opportunity |
| Organizations | **Name**, **Tax ID**, Legal name | the organization |
| Customers | **E-mail**, **Name** | the customer |
| Products | **SKU**, **Name**, URL key (slug), Quick-search attributes | the product |
| Categories | **Name**, **URL key (slug)** | the category tree, with the category highlighted |

A record type takes part only while its module is switched on: switch the CRM
off on **/platform/modules** and sales opportunities disappear from the results
and from the configuration screen; switch it back on and they return with the
configuration they had.

How text is matched:

- Matching ignores letter case and finds the text anywhere in a field. Wildcard
  characters such as `%` and `_` are matched as typed.
- An exact match of a record's number, tax ID, SKU, slug or e-mail is listed
  first in its group, then values that start with the text, then the rest by
  most recent change.
- Organization names are matched without regard to Polish diacritics — `lodz`
  finds *Łódź*. Other fields are matched as stored.
- Pasting a record's internal identifier (as shown in an address) finds that
  record whatever fields are configured.
- Drafts, inactive and blocked records, and cancelled orders are found and show
  their status. Deleted records, anonymized customers and personal (B2C)
  organizations are not; the people behind personal organizations are found as
  Customers.
- Product and category names match in every language and are shown in the
  administrator's language.

Search text is not stored or recorded anywhere beyond the platform's standard
request log.

## Who sees what

Global search never shows a record its type's own admin list would hide from the
same administrator:

- A record type appears only for a role holding the permission its own list
  requires — `orders:read` for Orders, `rfqs:handle` for quote requests,
  `crm:read` for sales opportunities, `customers:read` (or `customers:manage`)
  for Organizations, `customers:read` for Customers, and `catalog:read` for
  Products and Categories.
- A sales representative sees only the orders, quote requests, opportunities
  and customers of the organizations assigned to them.
- Organizations follow the Organizations list exactly: a sales representative
  sees every organization that list shows them, with the organizations assigned
  to them listed first.

## The command palette

Record search starts once the text reaches the minimum search length (3
characters unless changed). Each record type shows up to five results by
default; when more match, its heading says so and the last row, **See all
results**, opens the full results page. A record type that could not be
searched in time is shown as unavailable while the other types' results are
still listed.

## The results page

**/global-search** lists up to 20 results per record type for the text in its
search field. The type buttons narrow the results to one record type. The
address carries the text and the chosen type, so it can be bookmarked or sent
to a colleague — who sees only what they themselves may see.

## Configuring searchable fields

Holders of the `admin_search:configure` permission open **System → Global
search** (or *Configure global search* in the command palette). Each record
type has a card with its offered fields, the defaults marked:

- tick or untick fields to choose what the type is searched by;
- untick **Include in global search** to leave the type out entirely;
- **Restore defaults** returns the type to its shipped fields.

A type that takes part needs at least one field, so **Save** waits until one is
ticked or the type is left out. The configuration applies to every
administrator from their next search. If someone else saved the configuration
after you opened it, saving offers to reload it instead of overwriting their
change. Every save is recorded in the audit log with the value before and after.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `admin_search.enabled` | on | The module's switch, on **/platform/modules**. |
| `admin_search.minimum_query_length` | 3 | Characters typed before records are searched (2–10). |
| `admin_search.results_per_entity` | 5 | Results per record type in the command palette (1–10). |

The searchable-fields configuration is stored as a setting too
(`admin_search.entity_fields`) but is edited only on its own screen.

## Permissions

| Code | Grants |
| --- | --- |
| `admin_search:configure` | Viewing and changing the searchable-fields configuration. |

Searching itself needs no permission of its own: each record type is filtered
by the permission its own list requires.

## Switching it off

Switching **Global search** off on **/platform/modules** leaves the command
palette finding screens and actions only. The results page, the configuration
screen and their palette entries disappear, the settings cannot be edited and
the API answers as if the module were absent. Nothing is deleted: switched back
on, global search works with the configuration it had.

## Performance

Records are read live from each module's own tables, with the number of rows
asked for kept small. At the reference volume — 100 000 orders, 50 000
customers and products, 20 000 quote requests and opportunities, 10 000
organizations and 2 000 categories — a search across all seven types answers
within a few hundred milliseconds. Should an installation outgrow that, the
remedy is a search index on the slow module's columns, added by that module.
