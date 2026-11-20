---
'@endora-commerce/mod-catalog': patch
---

The product editor's one Save is its only filled button (issue #1489, UX audit CAT-07).

- Every "Add …" in a tab section — Add variant, Add to gallery, Add attachment, Add link, Add child, Add slot, Add option and the packaging units' Add — is an `outline` button with a `Plus` icon; the copy loses its leading "+ ".
- Every row removal — a variant, an image, an attachment, a related product, a group child, a bundle slot or option, a packaging unit — is a `ghost` icon button in the destructive tone, named after its row, instead of a filled red button. Removing a packaging unit now asks first, in the same dialog as the editor's other structural removals. An edited variant's in-row Save is `outline`.
- Catalog keys added: `productEditor.links.action.removeFor`, `productEditor.grouped.action.removeFor`, `productEditor.bundle.action.deleteSlotFor`, `productEditor.bundle.action.removeOptionFor`, `packagingUnits.action.removeFor`, `packagingUnits.removeConfirm`. Removed: `productEditor.links.action.remove`, `productEditor.grouped.action.remove`, `productEditor.bundle.action.deleteSlot`, `productEditor.bundle.action.removeOption`, `packagingUnits.action.remove`.
