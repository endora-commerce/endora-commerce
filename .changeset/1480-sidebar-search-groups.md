---
'@endora-commerce/admin-shell': patch
'@endora-commerce/admin-kit': patch
---

The admin sidebar's search entry is now a button styled as a search field (issue #1480). It opens the command palette when it is clicked or activated with Enter or Space, no longer when keyboard focus merely lands on it, and it carries an accessible name and `aria-keyshortcuts="Meta+K Control+K"`. Every collapsible sidebar group header, the Pinned section's included, now exposes `aria-expanded` and names the item region it folds through `aria-controls`; group headers and the search entry get a visible focus ring. The top bar's Help button, which had no action, is removed.
