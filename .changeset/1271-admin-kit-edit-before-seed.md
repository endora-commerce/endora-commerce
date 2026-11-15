---
'@endora-commerce/admin-kit': patch
---

Save session fix (issue #1271): an edit made in the moment between a panel's read landing and the session being seeded with it is no longer dropped. `useSaveParticipant`'s `setDraft` now seeds a participant that has no entry yet from the current render's read before it records the draft; an entry that already exists is not re-seeded, so a Save's newer baseline is kept.
