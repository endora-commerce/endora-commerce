---
'@endora-commerce/admin-kit': minor
---

`@endora-commerce/admin-kit/components` exports `ConfirmDialog` and `useConfirmDialog`
(with `ConfirmDialogProps`, `ConfirmOptions` and `UseConfirmDialog`), the design-system
replacement for the browser's `window.confirm()` (issue #313).

`useConfirmDialog()` returns `{ confirm, confirmDialog }`. Render `confirmDialog` once in the
screen, then replace `if (!window.confirm(message)) return;` with:

```tsx
if (!(await confirm({ message, confirmLabel: t('common.action.delete'), destructive: true }))) return;
```

`confirm` resolves `true` on the confirm button and `false` on Cancel, Escape, the scrim, or when
the screen unmounts. `title`, `confirmLabel` and `cancelLabel` default to the `core` bundle's
`common.confirm.title`, `common.action.confirm` and `common.action.cancel`. A `destructive`
question styles the confirm button as destructive and opens with focus on Cancel. Any other
question opens with focus on the confirm button. Focus returns to the opener on close.
`ConfirmDialog` is the controlled form, with `busy` and `error`, for a screen that keeps the
dialog open while its own request runs. Both are built on `ModalDialog` and render into
`document.body` through a portal, so a call site inside a table row does not nest a `<div>` in
a `<tbody>`.

`react-dom` (`^19.0.0`) is now a peer dependency, for `createPortal`. Any app that renders the
admin already has it.
