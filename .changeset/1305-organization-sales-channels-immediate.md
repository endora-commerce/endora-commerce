---
'@endora-commerce/mod-organizations': patch
---

The sales-channels panel on the organization detail applies each change immediately (issue #1305). It used to hold the ticked channels as a draft behind its own **Save sales channels** button, a second Save beside the page's one Save (spec 180, SC-001), although the panel is an immediate action.

- Ticking or unticking a channel writes the assignment at once, through the same `PUT /api/v1/admin/organizations/:id/sales-channels` and with the same audit rows; the panel has no Save button and adds nothing to the page Save's count.
- While a write is in flight the channel being changed is marked busy, a status line announces it, and no further tick is taken until it finishes. A write that fails puts the checkbox back and names the channel and the reason.
- Unticking the last channel is refused in the panel, with the existing *"An organization must be assigned at least one sales channel."* message, and writes nothing.
- The catalogue keys `salesChannels.save`, `salesChannels.saving`, `salesChannels.saved` and `salesChannels.saveError` are removed; `salesChannels.adding`, `salesChannels.removing`, `salesChannels.added`, `salesChannels.removed` and `salesChannels.toggleError` are added, in English and Polish.
