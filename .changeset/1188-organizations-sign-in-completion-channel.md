---
'@endora-commerce/mod-organizations': patch
---

`customerSignInCompletionPort` honours the new optional `salesChannelId` of its input and hands it to the post-sign-in hook: the `onLogin` option's argument gains the optional `salesChannelId`, the channel whose signed-out basket a sign-in merges when its request carries none (issue #1188). A composition's `organizationsLoginHook` should merge on `salesChannelId ?? <request channel>`; one that ignores it keeps merging on the request's channel. The password sign-in is unchanged.
