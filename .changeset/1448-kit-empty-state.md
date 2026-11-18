---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-price-lists': patch
---

`@endora-commerce/admin-kit/ui` publishes `EmptyState` (issue #1448): the block a list, a tab or a panel shows when it has nothing to show — a decorative icon, a title, at most one line and at most one action, drawn with the design system's `.b2b-empty` classes.

It has two variants. `no-data` (the default) takes `icon`, `title`, an optional `description` and an optional `action`. `no-results` takes `onClearFilters` and renders the kit's own title, line and *Clear filters* button (new `core` keys `common.emptyState.clearFilters`, `common.emptyState.noResults.title` and `common.emptyState.noResults.body`, in English and Polish); `icon`, `title` and `description` override them.

```tsx
<EmptyState variant="no-results" title={t('list.emptyFiltered')} onClearFilters={clearFilters} />
<EmptyState icon={<ClipboardList size={20} />} title={t('list.empty.title')} action={createButton} />
```

The forms and form-entries lists, the CRM opportunities list, the task and *My tasks* lists, the task settings lists, the project and project-template lists, the custom-fields table, the price-book list, and the product-feed list, runs, delivery and templates screens now use it. The forms list now says "No forms yet" with a line of its own (a reader is told who can create one), and it hides the header's *New form* while the empty state carries it. The form-entries list's empty state gains a title.
