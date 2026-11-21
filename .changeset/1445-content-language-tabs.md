---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-cms': patch
---

`ContentLanguageTabs` (`@endora-commerce/admin-kit/components`) is now drawn by the kit's `Tabs` (issue #1445): one tab in the tab order (roving `tabindex`), ←/→ select and wrap, Home/End jump to the ends, and the `.b2b-tabs` look of every other strip instead of filled and outline buttons.

It gains an optional `idBase` prop. Pass it and wrap the per-language content in `TabPanel`, and every tab names that panel through `aria-controls`; leave it out for a strip that switches page state spread over the screen, which then names no panel:

```tsx
<ContentLanguageTabs languages={languages} activeLanguage={language} onChange={setLanguage} idBase="product-content-language" />
<TabPanel idBase="product-content-language" value={language} tabIndex={-1}>{fields}</TabPanel>
```

`Tabs` gains the matching optional `controlsPanel` prop (default `true`); `false` omits `aria-controls`.

With no language to offer the strip draws the kit's `EmptyState` (issue #1448) instead of a grey sentence, with the new `core` key `contentLanguageTabs.emptyHint` (EN and PL) as its line. The catalog's product and category content screens, the CMS block and template editors (their canvas) and the returns clause dialog name their language panel; the CMS page editor and the blog editors, whose language also switches settings fields, keep a strip with no panel.
