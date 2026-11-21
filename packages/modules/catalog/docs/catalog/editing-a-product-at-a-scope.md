---
title: Editing a product at a scope
description: How to use the scope switcher in the product editor to set Global, Channel and Channel × language values, and what the editor tells you while you do.
---

# Editing a product at a scope

The product editor edits **one scope at a time**. The scope switcher in the editor header chooses which one, and
every tab then shows and saves the values at that scope. For what the three levels mean and how a value is resolved,
see [Product scopes — Global, Channel and Channel × language](./per-channel-per-language-overrides.md).

## The scope switcher

The switcher offers three levels, narrowest last:

1. **Global** — the value for every sales channel and every language;
2. **Channel** — pick a sales channel (the language stays "All languages") to edit the value for that channel;
3. **Channel × language** — pick a sales channel, then one of its languages.

Only scopes that are valid for the product are offered: the product must be in the channel, and the channel must
offer the language. A product that is in no sales channel can only be edited at Global. If the address you open names
a channel or language that is no longer valid, the editor opens at the nearest valid scope and says why ("Opened at
…"). A banner reading "Changes apply only to *scope*" is shown whenever you are not at Global. Next to the language
select is the **Scope map** link, which opens the Scope map in a panel on the right.

Saving applies to the current scope only. A save never changes a value at any other scope. The **Save** button sits
in the scope bar, next to the scope it saves, and shows how many changes are waiting ("Save 2 changes"). On a wide
screen the scope bar stays at the top of the window while you scroll, so Save is always in reach; on a narrow screen
Save is in the bar fixed to the bottom of the screen.

## What Save covers

Save writes everything you have staged on the product, wherever on the page you staged it:

- the product's fields on every tab, at the current scope, the SEO fields included;
- the product's stock settings on the **Inventory** tab — **Track stock**, backorders, the low-stock threshold and
  its mode, and the fulfilment strategy with its warehouse order. They exist only at Global. The tab has no Save of
  its own, and changing the threshold mode no longer saves by itself; setting a value back to the saved one removes
  it from the count;
- the **Base prices** on the **Pricing** tab, while the Price lists module is on. There is no *Save prices* button.

The count on Save adds them all up ("Save 3 changes"). Changes on a tab you have left stay staged and counted, and
switching tabs asks nothing. Save is offered to anyone who may change the product or any of these parts, and it
writes only what they may change.

**First, everything is checked.** The product's fields are checked as before, and the base prices are checked by
the server without being written. If anything is refused, nothing is written and every change stays. A refused
product field shows its reason on the field, as before. When the base prices have problems, a summary under the
scope bar lists each part with its problems ("Base prices — 1 problem"); **Show** opens that part's tab and moves to
the first field with an error.

**Then the parts are written, one after another**: the product's fields first, then the base prices. Each part is
recorded in the audit log as its own module records it — the product's save as one entry, the base prices as
another.

- If the product's fields are refused — someone else saved the product meanwhile, the completeness check refuses a
  status change, a URL key is taken, a value is invalid — the base prices are not written either. The editor says
  why, as before.
- If the product's fields are saved and the base prices are not, the summary says both ("Saved: Product fields.
  Not saved: Base prices — *reason*"). The product's fields are no longer staged; the base prices still are, Save
  counts only them, and pressing it again writes only the base prices.
- If the Price lists module is switched off while base prices are staged, those changes are discarded and the editor
  says so. A save the server refuses because the module was switched off is reported as that part not saved.

## What applies immediately

Some actions on the product are not staged. They are written the moment you use them, each recorded on its own,
and they neither add to the staged changes nor clear them. Each section holding such an action carries an
**Applies immediately** badge on its heading, shown only where you may use the action:

- adding, removing, reordering or replacing variants, bundle slots, grouped items, links, images, attachments and
  packaging units;
- deleting a URL redirect;
- the product's sales channels on the **Channels** tab;
- **Stock by warehouse** on the **Inventory** tab — each warehouse's stock level and low-stock threshold, each written
  by its own **Apply** on the row. **Apply** is available once the value differs from the stored one.

The prices in other price books are edited in the book's price grid, not here. The **Pricing** tab carries no badge:
its base prices save with Save.

## Switching with unsaved changes

Changes are saved one scope at a time, so switching scope (or leaving the product, or using the browser's Back
button) with unsaved changes — base prices included — opens a dialog with three choices:

- **Save and continue** — save the changes at the scope you are leaving, then switch; if any part is not saved, you
  stay;
- **Discard changes** — drop every unsaved change on the page and switch;
- **Stay here** — close the dialog and keep editing.

If the save is refused, you stay where you are and the refusal is shown on the field. If someone else saved the
product in the meantime, the editor reports a version conflict; **Reload** discards your staged changes and reads the
product again, and the button says so.

There is one such question for the whole page: no tab or panel asks one of its own. Closing or reloading the
browser tab with unsaved changes makes the browser ask before it leaves.

## Inherit, or set a value here

At Channel and Channel × language, every field that can be set at that scope shows where its value comes from:

- **Inherited** — the field is ticked "Use value from *parent scope*" and shows the parent's value read-only, in a
  dashed box. A line under the field adds only what the checkbox does not say: "No value at any scope above" when
  nothing in the chain has one, and "Inherited from Global" at Channel × language when the channel has no value of
  its own either;
- **Overridden** — the field holds its own value at this scope;
- **Empty here** — the field holds a deliberately empty value, which stops the chain: the parent's value is not used.

Without permission to change the product there is no checkbox, so each field says it in words instead: an
**Inherited** (or, for a text field at Channel × language, **Not translated**) badge with "Inherited from *scope*",
or "Set at this scope".

To set a value at this scope, untick "Use value from *parent scope*" and type it. To go back to the parent's value,
tick it again; the own value is removed when you save. A required field (the name, a required attribute) cannot be
left empty at a scope: enter a value or tick "Use value from *scope*".

The same action is available on the Scope map as **Use value from *scope***, after a confirmation.

## What is missing at this scope

Under the scope switcher the editor lists the required values that would block publishing at the scope you are
editing: "Missing here" and, at a channel, "Missing in this channel" with the languages concerned. A value counts as
present when it exists at the scope, at the channel, or at Global, in that order. At Global the list becomes
"*N* incomplete scopes" with a link to the Scope map. The list reflects **saved** values; the check made when you
save counts saved and staged values together.

## The Scope map

The **Scope map** is the overview of every scope of the product: one cell per sales channel in one language, a
"Whole channel" column for values set for the channel itself, the status in each cell (set here, from the channel or
from Global, and whether the product is live there now), and what is missing. **Edit at *scope*** opens the editor at
that scope, and a field's link focuses that field. Values kept for a channel or language the product has left are
listed under "No longer applies" and can be deleted there.

The Scope map opens in a panel on the right, over the tab you were on, from the link next to the language select and
from the "*N* incomplete scopes" line. **Close** or Escape returns to that tab; following an **Edit at *scope***
link closes the panel and opens the editor at that scope. Its address is the product's address with `?scopeMap=1`;
an older link to the former Scope map tab (`?tab=scopes`) opens the panel too.

## Read-only mode

Without the `catalog:write` permission the editor is read-only: "Read-only — you can view values at every scope".
You can switch scope and read the values, their sources and the Scope map, but no field can be changed.

## Fields that exist only at Global, or only at Channel

- **Global only** — SKU, type, attribute set, categories, stock settings, the download file, the gallery image set,
  attachment files and order, packaging units and quantities, and every attribute that is not marked scopable. At
  another scope these tabs show the value read-only with "This is the same in every scope" and an **Edit at Global**
  link.
- **Global and Channel, not Channel × language** — publication window, audience, minimum order quantity, returnable,
  and scopable attributes that are not text (numbers, selects, booleans). At Channel × language these fields are not
  offered.

## Required attributes and Global saves

The completeness check looks at each channel and language separately, so a required attribute may be absent at
Global. There is one exception, kept on purpose: **a Global save that carries an attribute cell or an attribute-set
change is refused (`required_empty`) for every empty required attribute, whether or not you changed it.** Fill the
attributes it names, or save without touching the attributes section. A Global save with no attribute cell, and
saves at Channel or Channel × language, are not refused for this. The name and the URL key can never be cleared at
Global.
