---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-catalog': patch
---

`@endora-commerce/admin-kit/ui` publishes `Tabs`, `TabPanel` and `RecordTabs` (issue #1445), with the helpers `tabId`, `tabPanelId` and `nextTabValue`.

`Tabs` is the kit's in-page tab strip: the WAI-ARIA tabs pattern with automatic activation — one tab in the tab order, ←/→ select and wrap, Home/End jump to the ends, disabled tabs are skipped — drawn with `.b2b-tabs` / `.b2b-tab` like `RouteTabs`. It is controlled through `value` and `onValueChange(next)`; every tab's `aria-controls` names the strip's one `TabPanel`, which is labelled by the selected tab. `RecordTabs` frames a record's sections in one card, strip on top and panel as its body; an item's `count` is drawn as a badge and spoken as "{label}, items: {count}" (the new `core` key `common.tabs.counted`, EN and PL), or as the item's own `countLabel`.

```tsx
<Tabs items={items} value={tab} onValueChange={setTab} idBase="dictionary" aria-label={t('tabs.label')} />
<TabPanel idBase="dictionary" value={tab}>{panel}</TabPanel>
```

Tabs inside tabs are not allowed: a second level inside a panel becomes `Section`s, and in development a `Tabs` rendered inside a `TabPanel` logs a warning. `.b2b-tab` now draws a visible focus ring and a disabled state. The product editor's tabs are `RecordTabs`; their ids, keys and behaviour are unchanged.
