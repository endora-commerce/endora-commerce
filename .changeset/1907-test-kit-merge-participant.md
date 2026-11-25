---
'@endora-commerce/test-kit': minor
---

`@endora-commerce/test-kit/merge` adds `createMemoryMergeWorld` (issue #1907,
`specs/192-organization-merge/`): an in-memory EntityManager and Command Bus a module package's
co-located test runs its merge participant's own Command in, so `expectMergeParticipant` can be
used without a database. The bus records one audit entry per Command and rolls every table back
when the Command throws; `injectFailure` makes the next `flush` throw.
