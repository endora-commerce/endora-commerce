---
'@endora-commerce/test-kit': minor
---

New `@endora-commerce/test-kit/merge` subpath with `expectMergeParticipant`, the merge-participant
conformance helper (issue #1907, `specs/192-organization-merge/` `contracts/merge-participant.md` §3):
preview counts equal the rows moved, batches stay within their size, a second run moves and changes
nothing, an injected failure rolls back whole, no event is dispatched, and every audit entry carries
the merge id. `composeTestServer` now composes the record merge as `composeApp` does and registers
`recordMergeService` and `recordMergeRuntime`.
