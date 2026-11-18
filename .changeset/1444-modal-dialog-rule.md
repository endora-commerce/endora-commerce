---
'@endora-commerce/admin-kit': minor
---

`ModalDialog` is the admin's one modal dialog (issue #1444, DS-11). It now renders into `document.body` through a portal, so it is placed against the viewport from inside a transformed drawer, a table row or the fullscreen Page Builder; it takes a `layer` prop — `'page'` (default, `z-50`, unchanged stacking) or `'overlay'`, which stacks it at the new exported `MODAL_OVERLAY_Z_INDEX` above the builder's floating chrome; with two dialogs open only the topmost answers Escape, and an Escape a control inside already handled (`defaultPrevented`) is left alone; and a dialog with nothing focusable focuses its own panel. A caller that queried the dialog inside its own render container must query `document.body` (Testing Library's `screen` already does). `StatusChangeControl` no longer wraps it in a second portal. New type export: `ModalDialogLayer`.
