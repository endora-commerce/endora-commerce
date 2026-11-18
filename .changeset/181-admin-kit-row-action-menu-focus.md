---
'@endora-commerce/admin-kit': minor
---

`RowActionMenu` no longer loses a dialog's focus to its own trigger (`specs/181-guest-complaints/` design review A-1).

- **An item's `onSelect` now runs after the menu has closed**, from the menu content's `onCloseAutoFocus`, with the ⋮ trigger focused first. Until now an item that opened a dialog (`ConfirmDialog`, `useConfirmDialog`) had the dialog take focus and then lose it to the trigger behind the scrim, in the timer Radix queues at unmount: Tab left the modal, Enter reopened the menu, and a destructive dialog's "open on *Cancel*" was defeated. The dialog now keeps focus and returns it to the trigger when it closes. The action is no longer synchronous with the select event: a test that asserts its effect straight after selecting an item awaits it (`waitFor`, or a flushed timer). `RowActionMenuItem` used outside a `RowActionMenu` runs `onSelect` at once, as before; an `asChild` item without `onSelect` is unchanged.
- New optional prop `showLabel` on `RowActionMenu`: the trigger shows `label` as its text, in an outline button with a chevron, instead of the icon alone — for a menu on a detail page rather than in a table row. The text is then the accessible name.
- A `DropdownMenu` composed directly, outside `RowActionMenu`, keeps Radix's behaviour; an item there that opens a dialog still needs the same deferral.
