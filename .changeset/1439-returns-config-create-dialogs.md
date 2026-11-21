---
'@endora-commerce/mod-returns': patch
---

The three returns configuration lists — return reasons, return delivery methods and return statuses — create from a *New …* button in the page header that opens a dialog, instead of a form drawn open under the list (issue #1439). With no reason or method yet, the empty state carries that button instead. A missing required field is said at the field, a server refusal stays in the dialog with what was typed, and a success closes the dialog and is said next to the header's button. The statuses screen now says *Status added.* after a create. When every delivery method already has a return setting, the dialog says so instead of offering an empty choice. An operator without `returns:write` — the permission every write route already requires — still sees the three lists, but without *New …*, the row *Delete* buttons, or the active and e-mail toggles, which are shown disabled. No API, setting, permission or migration changes.
