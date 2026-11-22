---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': patch
---

**The admin top bar's notification bell and language picker are kit menus, and every top-bar control is a 44 px target on touch screens (issues #1783, #1784).**

- **`@endora-commerce/admin-kit`:** `./ui` now exports `DropdownMenuRadioGroup` and `DropdownMenuRadioItem`, a pick-one-of-N menu entry (`menuitemradio` with `aria-checked` and a check mark), and `DropdownMenuLabel`. On a coarse pointer, one rule in `theme.css` makes every control in `.b2b-topbar__actions`, and the mobile menu button, at least 44 × 44 px. The profile avatar keeps its 28 px circle and grows its target with padding. A mouse keeps the 34 px controls. The `.b2b-main .b2b-topbar__icon-btn` rule is removed: it matched nothing, because the top bar is not inside `.b2b-main`.
- **`@endora-commerce/admin-shell`:** the bell and the language picker were hand-made `role="menu"` panels. They now use the kit `DropdownMenu`. Focus moves into the menu when it opens. The arrow keys, Home and End move between entries. Typing jumps to a notification by its title or to a language by its name. Escape closes the menu and gives focus back to the button. The bell's menu is named by its heading, and *Mark all read* keeps it open. While a language is being saved, the picker's button is `aria-disabled` rather than `disabled`, so keyboard focus stays on it instead of falling to the page. It still cannot be opened until the save ends. The save error from #1769 behaves as before.
