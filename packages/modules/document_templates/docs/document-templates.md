---
title: Document templates
description: Design the PDF documents the platform produces — the product comparison, the invoice and the quote request — in the Page Builder, per document type, language and sales channel
---

# Document templates

Document templates let an operator design the layout of the PDF documents the
platform produces, in the same Page Builder as CMS pages and e-mails. Three
kinds of document — **document types** — use them in this release:

| Document type | Provided by | Produced when |
| --- | --- | --- |
| **Product comparison** | Compare Products | a buyer clicks **PDF** on the storefront comparison page |
| **Invoice** | Invoices | an invoice PDF is downloaded by an administrator or a customer, regenerated, or attached to the invoice e-mail |
| **Quote request** | Quote requests | a sales representative exports a quote request to PDF or sends it to the customer; the representative chooses the template per quote |

A document type is contributed by the module that owns the document's data, so
it is listed only while that module is switched on. The module also decides
which blocks its documents may use.

## Where to find it

**Content → Document templates** in the sidebar, or press **⌘K** / **Ctrl+K**
and type *pdf*, *document template*, *invoice template*, *szablon faktury*,
*quote pdf*, *offer template* or *szablon oferty*. **Manage PDF templates** in a
quote request's export dialog opens the quote request card.
The **PDF template** button on the **Comparisons** screen opens the product
comparison card, and the **Templates** tab of **Invoices** opens the invoice
card.

## Built-in layout, templates and the default

Each document type has a **built-in layout**: the layout the platform ships. It
is used whenever no template applies, and it is where every new template starts.

A document type can hold any number of **templates**. Each template applies to
**all sales channels** or to **one sales channel** — its scope, chosen when it
is created and fixed afterwards. In each scope **at most one template is the
default**. A document is produced with:

1. for a quote request, the template a representative chose for that quote
   (global or of the quote's channel; a deleted one is replaced by the default
   and the representative is told), else
2. the default template of the document's sales channel, else
3. the default template for all sales channels, else
4. the built-in layout.

A template whose layout places nothing printable counts as absent, and the
next one in that order is used.

Creating a template changes no document: a new template is not the default
unless **Set as default** is ticked. The safe way to change what customers
receive is *duplicate → edit → set as default*. Setting a template as default
replaces the previous default of its scope in the same step; deleting a default
asks for confirmation and says what applies instead.

## Editing a template

The editor offers **only the blocks of the template's document type**:

| Document type | Blocks |
| --- | --- |
| Product comparison | Comparison header, Comparison table, Share link, and the general blocks: Heading, Text, Image (from the assets library), Spacer, Divider, Page break |
| Invoice | Header, Parties, Line items, VAT summary, Totals, Notes, Spacer, Divider, Logo, Footer, and blocks other installed modules contribute to invoices (for example a KSeF section) |
| Quote request | Quote header, Buyer and contact, Quote notes, Quote details, **Line items table**, and the general blocks |

The canvas shows each block filled with a **sample document**; **Preview PDF**
produces the real PDF of the canvas — saved or not — with the same sample, and
saves nothing.

**Page settings** (the root of the tree) set the page size (A4 or Letter),
orientation (automatic — landscape from three compared products — portrait or
landscape), margins, base font size, an optional repeating header and footer
text, and page numbers.

**Merge fields** are placeholders typed into a text, such as `{{date}}` or
`{{customerName}}`, replaced when the PDF is produced. The editor lists the
merge fields of the document type; `{{page}}` and `{{pages}}` work in the
header, footer and page-number format only. A merge field without a value prints
empty; a misspelled one prints as typed.

**Languages.** A template holds one layout per language. The product comparison
may hold every active content language: a buyer gets the layout in the language
the storefront is shown in, else one with the same base language, else English,
else the first the template has; product and attribute names, dates and prices
are printed in that language. Choosing a language the template does not hold
offers to start it from the language being edited. Invoices are printed in
Polish only, so the invoice editor offers no language choice. An invoice
block's label left empty is printed in Polish, and so is the footer when its
text is empty; the built-in layout leaves all of them empty. A label you type is
printed exactly as typed, in whatever language you typed it.

**Saving** is refused when someone else saved the template after you opened it;
reload to see their changes. A block whose module is switched off is kept in the
template, shown as a placeholder and left out of the PDF.

## Line items table

The **Line items table** (category *Data*) prints a document's lines as a
table whose columns the template defines. It is offered to a document type
that declares lines — the quote request in this release.

- **Columns** — 1 to 16, in an order you set (the move up / move down buttons
  work from the keyboard). *Add column* opens the list of the document's
  fields, grouped (*Line*, *Pricing*, *Product attributes*) and searchable.
  Per column: the **header** (empty prints the field's name in the layout's
  language), the **width** (automatic, fill the rest, or fixed in points —
  fixed widths wider than the page are scaled down), the **alignment**
  (automatic: numbers and amounts right), the **format** (decimal places; for
  amounts the currency as a symbol, a code or not at all; for dates short,
  medium or long), the text printed when a line has **no value**, and when it
  is **shown**: *Always*, *Only if any line has a value*, or *Never* (the
  column is kept but not printed). A hidden column's width goes to the others.
- Fields marked **Internal** — for a quote: list price and the discounts —
  are values customers do not otherwise see. They may be printed; the badge is
  the warning.
- A field that no longer exists (a deleted product attribute) is flagged
  *Unknown field*; its column prints its empty text and the document still
  renders.
- **Detail row** — optional, under each line: up to 8 entries printed as
  "label: value", joined by a separator; an entry is printed *Only if it has a
  value* by default, and no row is printed for a line where no entry has one.
- **Totals** — up to 10 of the document's totals, each with a label, a rule
  (*Only if it has a value* by default) and *Emphasise*, printed right-aligned
  under the table.
- **Grouping** — one of three modes (see *Grouping* below): **Document's
  groups** (the default), **By field** or **No grouping**.
- Style: header background, border and stripe colours, striped rows, font size,
  space below, and the text printed instead of the table when there are no
  lines.

The table repeats its header row on every page and never splits a line's row
across pages. A row is kept whole, but not with its neighbour: a line's detail
row, or a group's heading row, can be printed at the foot of a page with the
next row at the top of the following one. The canvas draws the table over the
sample with the same formatting as the PDF; a column hidden by its rule on the
sample is drawn faded.

### Grouping

- **Document's groups** — prints the groups an operator arranged on the
  document itself (for a quote request: the line groups of its *Modify* tab).
  Each group that holds a line gets a **heading row** with its name and, with
  *Show item count* on (the default), its number of lines (*3 items* /
  *3 pozycje*); then its lines; then **one subtotal row for each of the table's
  totals**, with the same label and rule, computed over the group's lines and
  printed right-aligned without emphasis (none when the table has no totals).
  The lines without a group follow under the **Other items heading** — empty
  prints *Other items* / *Pozostałe pozycje* in the layout's language; it may
  hold merge fields. Positions run 1…n across the groups, and the document's
  totals follow as usual. A document with no group — or a document type that
  has none, for which the editor says *This document type has no groups.* —
  prints the table flat, exactly as before.
- **By field** — lines are grouped in the order the values of one field first
  appear, each group under a heading (lines without a value under the name you
  give), optionally followed by a subtotal of one numeric or amount field.
- **No grouping** — the table is always flat.

**Document's groups is what an unconfigured table means.** A table saved
before this setting existed — its grouping stored empty — is read as
*Document's groups*, so the built-in layout and existing templates print a
grouped quote's groups without being edited; set *No grouping* to keep a
template flat. A table grouped by a field keeps doing so. The canvas shows the
sample's groups (the quote request sample holds two groups and one line
without a group).

Placeholders of the form `{{item.…}}` are reserved for a future block that
repeats blocks once per line; until then they print as typed.

## Permissions

| Permission | Allows |
| --- | --- |
| `document_templates:read` | the list, the editor (read-only) and **Preview PDF** |
| `document_templates:write` | creating, renaming, saving, setting and clearing the default, duplicating and deleting |

When invoice templates moved here, every role allowed to view invoices was given
`document_templates:read`, and every role allowed to edit invoices also
`document_templates:write` — once; a permission removed afterwards is not given
back. Every template change is recorded in the audit log.

## Switching modules off

- **Document templates off** — the screens, the sidebar entry, the palette entry
  and the comparison's **PDF template** button disappear and the API answers
  `MODULE_DISABLED`; the comparison PDF keeps working with its fixed layout. It
  cannot be switched off while **Invoices** is on, because every invoice PDF is
  produced from it. Templates are kept and return unchanged when it is switched
  back on.
- **Compare Products, Invoices or Quote requests off** — that document type,
  its blocks and its templates leave the screens and the API; nothing is
  deleted. With **Document templates** off, quote requests cannot be exported
  or sent as PDF; the template each quote remembers is kept.

## Limits

A template holds up to 10 languages, 200 blocks and 20 images per language, and
512 KiB of content; a text holds up to 5 000 characters. The comparison table
prints 1 to 8 products per table and continues in the next table. A line items
table holds 1 to 16 columns, 8 detail entries and 10 totals.

## API

`/api/v1/admin/document-templates` — the document types (`/types`,
`/types/:code`, `/types/:code/builder-config`), the templates (list, read,
create or duplicate, rename, save one language, set and clear the default,
delete) and `POST /preview`. A document type's detail lists its line
collections — their fields in the asked language, sample lines and totals —
for the editor, and `sampleSections` — the sample's groups, empty for a type
that declares none. Error codes: `DOCUMENT_TEMPLATE_NOT_FOUND`,
`DOCUMENT_TYPE_NOT_AVAILABLE`, `DOCUMENT_TEMPLATE_INVALID`,
`DOCUMENT_TEMPLATE_IS_DEFAULT`, `DOCUMENT_TEMPLATE_NOT_SELECTABLE`,
`DOCUMENT_RENDER_FAILED`.

A module adds a document type by pushing a registration — its blocks, whether it
opts into the general blocks, merge fields, sample data, built-in layout,
languages, page defaults, whether one template may be chosen per document and
its **line collections** — into the `documentTypeRegistry`, and produces
documents through the `documentRenderPort` with its own data. A type that
declares a line collection (its fields, its lines' values and its totals) gets
the Line items table without writing a renderer or an editor; a collection
that also declares its **sections** — each group's name, its lines and its
totals, plus the lines without a group — gets *Document's groups* (a section
list the table cannot use is logged once and the table prints flat, never
failing the document); a type with
per-document selection asks the port's `listChoices` for the templates a
person may pick for one document.
