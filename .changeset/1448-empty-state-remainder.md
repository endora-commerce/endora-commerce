---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-product-feeds': patch
---

More admin lists tell "nothing here yet" apart from "your filters match nothing" (issue #1448). They used one grey sentence for both, so an operator who had never filtered read "No entries match the current filter.", and an operator whose filters hid every row had no way back but to undo each filter by hand. They now show the kit `EmptyState`: the `no-data` variant, with an icon, a title and one line, when there is nothing to list, and the `no-results` variant, whose *Clear filters* button resets the filters and returns focus to the first filter field, when the filters hide everything.

- **Audit log**: "Nothing recorded yet" on an unfiltered empty log. *Clear filters* also clears the filters held in the URL.
- **Invoices**: "No invoices yet" until an order is invoiced.
- **Languages, Countries and Currencies** (dictionaries): Countries and Currencies used to draw an empty table when the search matched nothing, and Languages printed its "no match" sentence even when nothing was filtered. *Clear filters* on Languages also resets the status filter.
- **Transactional e-mails**: "No transactional e-mails" when no module declares one, and a no-match state for the search. The list no longer shows an empty state before it has loaded. The `transactional_emails` key `list.empty` is replaced by `list.emptyFiltered`.
- **Newsletter subscribers**: "No subscribers yet", and a no-match state for the search and tag filters. A server scope notice still takes precedence. The list no longer shows an empty state before it has loaded. `subscribers.empty` now reads "No subscriber matches these filters."
- **Comparisons**: "No comparisons yet", and a no-match state with the list's first *Clear filters*. A server scope notice still takes precedence.
- **Product-feed template builder**: a field search that matches nothing shows the `no-results` state rather than a bare sentence. The search box gains an accessible name.

New keys, in English and Polish: `core` `auditLog.emptyState.*` and `invoices.emptyState.*`; `dictionaries` `languages.emptyState.*`, `countries.empty`, `countries.emptyState.*`, `currencies.empty` and `currencies.emptyState.*`; `transactional_emails` `list.emptyFiltered` and `list.emptyState.*`; `newsletter` `subscribers.emptyState.*`; `comparisons` `list.emptyState.*`.
