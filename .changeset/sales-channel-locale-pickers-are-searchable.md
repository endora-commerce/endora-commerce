---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-i18n': patch
---

The Sales Channel create and edit forms pick languages and currencies from searchable controls,
and a default that is no longer selected is reported instead of being replaced.

- **`@endora-commerce/admin-kit/ui` exports `MultiCombobox`** (with `MultiComboboxProps`) — a
  searchable multi-select: one combobox input over a filtered listbox, the selection shown as
  removable chips. It takes the same `ComboboxOption[]` as `Combobox` and a `value: T[]` /
  `onChange(next: T[])` pair, matches on `label` and `description` without regard to diacritics,
  and is driven from the keyboard (arrows, `Home`/`End`, `Enter` to toggle, `Escape`, `Backspace`
  to remove the last chip). `MultiSelect` is unchanged and remains the control for filter bars.
- **`Combobox` accepts `invalid` and `ariaDescribedBy`**, so it can be used as a validated form
  field, and **closes its listbox when focus leaves it**. It used to stay open after `Tab`, until a
  pointer press elsewhere; a caller that relied on that has nothing to change, the list simply no
  longer covers the next field.
- **Sales Channel form**: *Languages* and *Currencies* are `MultiCombobox`es over the active
  Dictionary entries, searchable by code and by name; *Default language* and *Default currency* are
  `Combobox`es limited to what is selected. Removing the entry that is the current default now
  **empties the default** and blocks saving until one is chosen — the form used to promote the
  first remaining entry silently. The submitted value has the same shape as before.
- The shared admin bundle gains `common.multiCombobox.added`, `.noMatches`, `.remove` and
  `.removed` in English and Polish.
