---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
---

`@endora-commerce/admin-kit/components` publishes `ListToolbar`, `ListToolbarSearch` and `FilterChip` (issue #1440, UX audit DS-06), with the `AppliedFilter`, `ListToolbarProps`, `ListToolbarSearchProps` and `FilterChipProps` types.

`ListToolbar` is a list page's filter row, extracted from the Orders list's toolbar and the Tasks list's "More filters (n)" disclosure. It renders a `search` landmark named by `label`, holding `search`, the three or four primary `filters` and the list's own `actions` (saved views, the column picker) pushed to the right. `moreFilters` folds the rest behind a **More filters** button that shows `moreFiltersActiveCount` as **More filters (n)** while it is closed. The panel is always mounted, so `aria-controls` names an element, and its controls render only while it is open. `appliedFilters` lists each applied filter as a removable chip named "Remove filter: …", and `onClearFilters` adds **Clear all filters**. The toolbar draws no frame of its own, so the page decides the card and border around it.

`ListToolbarSearch` is the toolbar's search box. It is `type="search"`, named by `label` rather than by its placeholder, and its icon is decorative.

`FilterChip` is a one-press filter toggle: a `<button type="button" aria-pressed>` in the theme's `b2b-filterchip` style, controlled through `pressed` and `onPressedChange(next)`. On a coarse pointer it has a 44 px hit area. A filter with several values belongs in a labelled `Select` or `MultiSelect`, not in a chip.

```tsx
<ListToolbar
  label={t('orders.toolbar.label')}
  search={<ListToolbarSearch label={t('orders.field.search')} value={q} onValueChange={setQ} />}
  filters={<MultiSelect ariaLabel={t('orders.field.status')} … />}
  actions={<SavedViewsControl … />}
  moreFilters={<>…</>}
  moreFiltersActiveCount={hiddenInUse}
  appliedFilters={chips}
  onClearFilters={clearAll}
/>
```

The shared bundle gains the toolbar's copy in English and Polish (`common.listToolbar.*`).
