---
'@endora-commerce/page-builder-core': minor
---

Adds `contextAdmits(declared, target)` — the one implementation of *"does a block
declared for these contexts appear in this palette"*.

If you were writing `contexts.includes(context)` to decide whether a block belongs
in a palette, that is right for `cms`, `email` and `invoice` and **wrong for
`newsletter`**: the platform admits every `email` block into the newsletter
palette, and no block declares `newsletter` at all. Import `contextAdmits`
instead.

Nothing is removed and no behaviour changes. `filterConfigByContext` and
`getDisallowedComponentNames` now call it rather than each carrying their own
copy of the rule — they had one apiece, one positive and one negated, and the two
were proved equivalent over all 64 subset/context combinations before the
extraction rather than after.
