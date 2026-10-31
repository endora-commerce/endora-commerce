---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
---

Kit pickers speak the admin's language and announce their state; no prop changes.

- `Combobox` keeps a polite live region (`role="status"`) mounted beside its input and writes the open list's status into it — the loading message, the empty message, or `Results: {count}` — so a screen reader hears a finished load, an empty result and a failed search (WCAG 2.2 SC 4.1.3). It is empty while the list is closed. Its default `loadingMessage` and `emptyMessage` now come from the `core` bundle (`common.combobox.loading`, `common.combobox.noResults`) instead of English literals. A test that finds the status text with `getByText` now matches two elements, the visible row and the live region; query the listbox (`getByRole('listbox')`) or the region (`getByRole('status')`) instead.
- `AdminUserPicker`, `CustomerPicker`, `CategorySelect`, `CustomerGroupPicker` and `SalesChannelPicker` take their default placeholder, accessible name, empty, prompt and error copy from the `core` bundle in English and Polish (`adminUserPicker.*`, `customerPicker.*`, `categorySelect.*`, `customerGroupPicker.*`, `salesChannelPicker.*`). Props that override them are unchanged.
- `AdminUserPicker` and `CustomerPicker` prompt for a name or e-mail address until their first search answers, instead of saying "No matching …" before anything has been searched.
- `SalesChannelPicker` labels channels by the admin language's locale (`pl` → `pl-PL`), so a Polish admin sees the Polish channel name; before, every label fell back to `en-US`. A failed load now shows its error even when the caller passes `emptyMessage`.

`@endora-commerce/mod-i18n` ships the new `core` keys in `en.json` and `pl.json`.
