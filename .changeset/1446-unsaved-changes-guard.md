---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/page-builder-admin': minor
---

The admin's one unsaved-changes guard (issue #1446, UX audit DS-13).

- `@endora-commerce/admin-kit/components` publishes `useUnsavedChangesGuard({ dirty, onSave?, onDiscard?, guardTabsOutside?, title?, message? })`, which returns `{ confirm(action), asking, dialog }`. While `dirty` it asks **Save and continue / Discard changes / Stay here** in the admin's own dialog before a same-origin link (the sidebar, a Back link), an opted-in host tab or a `confirm(action)` call drops the changes, and arms the browser's `beforeunload` prompt; the blocked link or tab is replayed after the answer. Render `dialog` once. Also published: `UnsavedChangesDialog` (the question on its own) and `UnsavedChangesHint` (the "Unsaved changes" status beside a Save button, a polite live region).
- `@endora-commerce/admin-kit/lib` publishes `isDraftEqual(a, b)`, the structural comparison a screen computes its `dirty` with (key order and `undefined`-valued keys ignored, as JSON does). `useUnsavedChangesPrompt` is unchanged for its callers and now shares its interception with the guard.
- `@endora-commerce/page-builder-admin`: `PageBuilderEditorLayout` takes `dirty`, `onSave` and `onDiscard` and arms the guard over the whole editor; `hasUnsavedCanvas` compares a Page Builder editor's active and stashed canvases with what was saved.
- `@endora-commerce/mod-i18n`: the `core` copy for the guard (`form.unsavedChanges.title|body|save|saving|discard|stay|hint`), in English and Polish.
