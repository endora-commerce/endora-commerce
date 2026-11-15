---
'@endora-commerce/admin-kit': patch
---

Save session fix (issue #407): an edit made after a participant's read had landed, but before its seed effect had run, is no longer dropped. `useSaveParticipant`'s `setDraft` now seeds the part from the current render's loaded value and meta first. Seeding stays idempotent: a part that is already dirty, or already holds that baseline, only takes the meta. On a slow machine the first change on a freshly loaded panel could be lost this way, and loaded test runners showed it as intermittent failures.
