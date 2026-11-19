---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-organizations': patch
---

`useConfirmDialog`'s `confirm` takes a new `returnFocusTo` option: an element, a ref, or a resolver that names where focus goes after a confirmed answer. A confirmed action that removes the control that asked it, such as a row's *Remove*, used to leave focus on `body` once the row was gone. The target is resolved once, when the dialog closes on a confirmed answer. On Cancel, or when it resolves to nothing, focus returns to the opener as before. The new `ConfirmFocusTarget` type is exported, and the controlled `ConfirmDialog` passes a `finalFocusRef` through to `ModalDialog`.

Organization members: after a member is removed, focus moves to the next row's *Edit*, else to the previous row's, else to *Add member*.
