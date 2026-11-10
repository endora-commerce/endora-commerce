---
'@endora-commerce/test-kit': minor
---

Issue #470 — a new `./audit` subpath with `expectNoAuditValues(entries, sentinels)` and `findAuditValues(entries, sentinels)`, the sentinel assertion of the audit-state rule (D-288): for a tenant-scoped record the platform audit log carries names and structure, never values.

- `expectNoAuditValues` fails with a `node:assert` `AssertionError` that lists every place a sentinel appears in `stateBefore` / `stateAfter` (or `before` / `after`): at any depth, as an object key, in another case, or a number written as a decimal string.
- It also fails when it is given no entry, so a Command that skipped its audit cannot pass, and it refuses an empty sentinel list or an empty string sentinel.
- No new dependency: the helper uses `node:assert` only and needs no test runner.
