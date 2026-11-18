---
'@endora-commerce/admin-kit': minor
---

`@endora-commerce/admin-kit/lib` publishes `useDetailResource` and `@endora-commerce/admin-kit/ui` publishes `Skeleton` and `DetailSkeleton` (issue #1447, UX audit DS-14).

`useDetailResource(key, load)` holds the record a detail screen shows and keeps its first load apart from every refresh. `load` answers the record, `null` for one that does not exist, or throws. It returns `data`, `initialLoading`, `refreshing`, `error`, `refresh()`, `setData` and `busyProps` (`{ 'aria-busy': true }` while a refresh runs). A refresh keeps `data` on screen; a new `key` starts a new first load and never shows the previous record; an earlier, slower read never overwrites a later one.

`Skeleton` is one `aria-hidden` placeholder block whose pulse runs only without `prefers-reduced-motion`. `DetailSkeleton` is a record page's first load — header, tab strip (`tabs={false}` drops it) and field rows — in a `role="status"`, `aria-busy` region labelled `common.state.loading` unless `label` says otherwise. Use either for the first load only.

```tsx
const resource = useDetailResource(id, loadOrder);
if (resource.initialLoading) return <DetailSkeleton />;
<Card {...resource.busyProps}>…</Card>
// after an action: await resource.refresh();
```
