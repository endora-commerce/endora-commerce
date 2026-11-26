---
'@endora-commerce/platform': minor
---

`SalesChannelMembershipService.replaceChannelsForEntity` (`salesChannelMembershipPort`) now answers `previousChannelIds`: the entity's channel ids before the replacement, sorted, from the writer's own read on the manager it writes on (inside the caller's transaction when it passes `em`). It is set both when the set changed and when it was already in place. `MembershipMutationResult` gains it as an optional field; the other mutations do not set it, and existing callers are unaffected (issue #1821).
