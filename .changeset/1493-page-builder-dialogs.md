---
'@endora-commerce/admin-kit': patch
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-i18n': patch
---

Every dialog the Page Builder, the e-mail builder and the CMS editor open over the canvas is now the kit's `ModalDialog` on the `overlay` layer (issue #1493, UX audit CONTENT-03). Save as template, apply template, copy from language, clear canvas, Translate, the column-layout pickers, the colour palette, the asset library, the product and category searches, the variable picker and the e-mail preview all trap focus, close on Escape, return focus to the button that opened them, and are named by their title. Before, each drew its own scrim, and none of them trapped focus. The result of saving or applying a template, or of copying from a language, now appears next to its button. Before, it was announced only to screen readers. A failure stays inside the dialog. Clear canvas opens with focus on Cancel. The column-layout pickers, the variable picker and the catalogue searches read their copy from `core` in English and Polish, and their search fields are labelled. `MODAL_OVERLAY_Z_INDEX` rises from 10000 to 2147483646, so an `overlay` dialog also opens above the rich-text editor's own dialogs, from which the asset library is opened.
