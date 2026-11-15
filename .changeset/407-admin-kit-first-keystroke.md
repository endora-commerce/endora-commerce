---
'@endora-commerce/admin-kit': patch
---

Save session fix (issue #407): an edit made right after a participant became writable is no longer dropped. `useSaveParticipant`'s `setDraft` now applies the current render's `writable` and label before it records the draft, instead of waiting for an effect.
