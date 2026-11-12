---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-assets-library': minor
---

`assets_library` now publishes `ASSET_CHANGED_EVENT` (`'assets_library.asset_changed.v1'`, payload
`AssetChangedEvent { assetIds }`, both exported from `@endora-commerce/contracts`) after a
committed write that changes what an embedded asset renders as: a replace, a restore of the
previous version, a permalink set or removed, a soft delete, a restore, and an edit of the
filename, label, alt text, MIME type or visibility. A move between folders is not announced. The
event is dispatched in a bus scope and awaited, so the write answers once its subscribers have
run.

`CmsContentChange` gains a fifth member, `{ kind: 'assets'; assetIds }`. A consumer that switches
exhaustively over `kind` must handle it; `megamenu` ignores it, as it ignores templates and hooks.
