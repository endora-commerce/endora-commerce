---
'@b2b/contracts': minor
---

Publish `CmsBlockSeedPort` — the idempotent seeding seam for a predefined CMS
block, on the `cmsBlockSeedPort` container, owned by `cms`.

`ensureSeededBlock(block: CmsSeededBlock)` inserts the block where no block
carries its code, then binds it to every sales channel it is not already bound
to. Both halves are idempotent, so a re-run inserts nothing and binds nothing —
which is what lets a module call it on every boot and lets an operator's edit of
the seeded text survive every restart. `CmsSeededBlock` is published with it and
carries `code`, `name`, `languages` and a `CmsContentEnvelope`: the block's text
is the asking module's business, its storage is the CMS's, and the descriptor
deliberately carries no channel list, block id or version.

It exists because a module that ships a predefined block had no seam to ask for
one and wrote `cms_blocks` and `cms_block_sales_channels` directly instead. Two
did.

Additive: no existing export changed shape.

Calling it before the first request — which is where a boot seed runs — needs a
presence decision first, `effectiveState.isPresent('cms')`, because the port is
gated and a gate's "no" at route registration stops the next start rather than
one request. The interface's own doc block states that, and states what an
absent `cms` costs (nothing that the first boot after it returns does not
recover).
