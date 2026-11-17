---
'@endora-commerce/admin-shell': patch
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
---

The command palette (⌘K / CTRL+K) now tells a screen reader which result is highlighted (issue #481). The search input is a `combobox` that controls a `listbox`, every result is an `option` with a stable id, and the input's `aria-activedescendant` follows the highlight as the arrow keys move. Group headings label `role="group"` containers, and a record type that could not be searched is a disabled option. Keyboard behaviour is unchanged: focus stays in the input, `Enter` opens the highlighted result and `Alt+Enter` pins or unpins it.

A pinnable result now says "Pinned" or "Not pinned" in its accessible name and carries `aria-keyshortcuts="Alt+Enter"`. The pin icon beside it is no longer a `<button>`: a result's children are presentational, so the icon is a pointer shortcut hidden from assistive technology, marked `data-palette-pin` and `data-pinned`. The theme's `.b2b-palette__pin[aria-pressed="true"]` selector is now `.b2b-palette__pin[data-pinned="true"]`; a deployment stylesheet that targets the old selector must follow.

New `core` bundle keys: `appShell.palette.pin.statePinned`, `appShell.palette.pin.stateUnpinned`, `appShell.palette.results` and `appShell.palette.title` (the palette dialog's name), in English and Polish.
