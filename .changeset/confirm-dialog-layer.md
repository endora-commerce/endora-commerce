---
'@endora-commerce/admin-kit': minor
'@endora-commerce/page-builder-admin': patch
---

`ConfirmDialog` takes a `layer` prop and `useConfirmDialog` takes `{ layer }` options (UX audit follow-up, issue #1567). Both pass it to `ModalDialog`: `layer: 'overlay'` opens the question above the fullscreen Page Builder and Puck's floating action bar, which sat over a confirmation opened at the default `z-50`. The default stays `page`, so existing call sites are unchanged. The new `UseConfirmDialogOptions` type is exported from `./components`.

The Page Builder's "Clear canvas" question, under the toolbar's "More" menu, is now `useConfirmDialog({ layer: 'overlay' })` instead of a hand-built `ModalDialog`. It behaves as before: focus starts on Cancel, Escape cancels, and focus returns to "More".
