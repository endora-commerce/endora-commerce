---
'@endora-commerce/cli': patch
---

Three things the install wizard said before it could know them. Its first line stated a total — `0 of 7 answers came from flags` — before the parts were chosen, above a run whose `[answers]` line then said `total=3`; the total is now printed only when the flags already fixed the selection. The directory question said *instance* even when the next answer made the directory the storefront's own; with the parts still to be chosen it now asks `Which directory should it be written to?`. And the parts checklist kept `[x] docs` beside a storefront-only selection; a member row is now shown unchecked, with the reason, once neither the API nor the admin is selected. A script that matches the wizard's prompts by text needs the new wording.
