---
'@endora-commerce/mod-sales-channels': patch
---

The channel form no longer loses an operator's change to its own re-seed (issue #764). `ChannelIdentityForm` re-seeded its fields from `initial` in a passive effect, which runs after the commit that first shows the loaded channel; a change made in that window, such as turning *Prefix the default language in URLs* off, was overwritten once the effect ran, and the save sent the loaded value. The form now re-seeds during render, and only when `initial` changes after mount.
