---
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
---

The Page Builder editors keep the canvas directly under the header at every width (issue #1511, UX audit CONTENT-01).

- Below 1800 px an open settings panel is a sheet laid over the right of the canvas, sticky under the top bar and scrolling on its own, instead of a two-column wall of cards above the canvas. Escape closes the sheet and returns focus to **Show settings**. From 1800 px the panel is still a column beside the canvas. The sheet is not modal: the canvas stays usable beside it, and the fields keep what was typed when it is closed or the window is resized.
- At every width the settings are one panel titled **Settings**, with a heading per group (Metadata, Breadcrumbs, Scope, SEO, URL keys, Tags, …) instead of one card per group. A new blog post or category, which has no canvas yet, shows the same panel as the page.
- Unchanged: the panel still opens for a new entity and when a save is refused over a field in it, and the operator's choice to show or hide it is still remembered.
- `PageBuilderEditorLayout` now draws the one card its `settings` share: a consumer passes its groups as `EditorSection`s with `as="h3"` (and the kit's `ScopePicker` with `titleAs="h3"`), not as `Card`s.
