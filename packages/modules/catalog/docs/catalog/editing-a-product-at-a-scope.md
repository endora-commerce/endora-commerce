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
…"). A banner reading "Changes apply only to *scope*" is shown whenever you are not at Global, and the editor says in
words where you are ("Editing …"). Next to it is a link to the **Scope map** tab.

Saving applies to the current scope only. A save never changes a value at any other scope.

## Switching with unsaved changes

Changes are saved one scope at a time, so switching scope (or leaving the product, or using the browser's Back
button) with unsaved changes opens a dialog with three choices:

- **Save and continue** — save the changes at the scope you are leaving, then switch;
- **Discard changes** — drop them and switch;
- **Stay here** — close the dialog and keep editing.

If the save is refused, you stay where you are and the refusal is shown on the field. If someone else saved the
product in the meantime, the editor reports a version conflict; **Reload** discards your staged changes and reads the
product again, and the button says so.

## Inherit, or set a value here

At Channel and Channel × language, every field that can be set at that scope shows where its value comes from:

- **Inherited** — the field is ticked "Use value from *parent scope*" and shows the parent's value, with its source,
  read-only. A text field at Channel × language reads "Not translated"; "No value" appears when nothing in the
  chain has one;
- **Overridden** — the field holds its own value at this scope;
- **Empty here** — the field holds a deliberately empty value, which stops the chain: the parent's value is not used.

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

## The Scope map tab

The **Scope map** tab is the overview of every scope of the product: one cell per sales channel in one language, a
"Whole channel" column for values set for the channel itself, the status in each cell (set here, from the channel or
from Global, and whether the product is live there now), and what is missing. **Edit at *scope*** opens the editor at
that scope, and a field's link focuses that field. Values kept for a channel or language the product has left are
listed under "No longer applies" and can be deleted there.

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
