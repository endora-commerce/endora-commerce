---
'@endora-commerce/admin-kit': minor
---

`ListToolbar` offers *Clear all filters* without applied-filter chips, and hands focus on after it (issue #1505, WORK-05).

- New optional prop `filtersActive`. With `onClearFilters` given and no `appliedFilters`, the filter row ends with **Clear all filters** while `filtersActive` is true. A page that lists its applied filters as chips keeps the button at the end of the chip row, as before, and does not need the prop.
- After **Clear all filters**, in either place, focus moves to the toolbar's first enabled control, normally the search box. Before, focus was left on a button that went away with the filters.
- The *More filters* toggle stays focused while it opens and closes the panel. This was already the behaviour; it is now documented and covered by a test.
