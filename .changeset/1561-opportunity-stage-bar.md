---
'@endora-commerce/mod-crm': patch
---

The opportunity screen says its status once, in the badge beside the title (issues #1561, #1566). The stage bar no longer has a *Current status* block: it shows only the moves, under *Move to…*, and a closed opportunity still says how and when it closed. The optional reason of a move is folded behind an *Add a reason* button: opening it focuses the field, the next move sends the reason, and the field folds again. Folding it by hand drops what was typed. In the sidebar, a computed value's one-line hint links to the statuses that count (`/crm/workflow#value-counting`) for a holder of `crm:configure`. The translation key `opportunity.stage.current` is removed; `opportunity.stage.heading`, `opportunity.status.addReason` and `value.hint.configure` are new.
