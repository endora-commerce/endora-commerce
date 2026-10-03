---
'@endora-commerce/platform': minor
---

Every tenant-scope widening (`withSystemScope`, `withOrgScope`, `enterSystemScope`) is now
recorded in `audit_log_entries` with the action `tenant.escape_hatch`, not only as the
`tenant.escape_hatch` stderr line. The stderr line is unchanged, except that a scope opened by
`enterSystemScope` now carries an `entryPoint` field.

- `composeApp` attaches the writer, so every server, worker and composing CLI command in an
  instance gets it with no change to the instance's code. `ComposeAppHandle` gains
  `escapeHatchAudit` (`flush()`, `detach()`, `pendingCount`); `dispose()` flushes and detaches
  it before the ORM closes. The type is exported from `@endora-commerce/platform/composition` as
  `EscapeHatchAuditWriter`.
- `runInstanceOperatorCommand` (the `module:*` commands of an instance) attaches it as well.
  An application that builds its own operator runtime can call `attachEscapeHatchAuditWriter`
  from `@endora-commerce/platform/lifecycle` with a getter for its EntityManager, and
  `detach()` it before closing the ORM.
- Rows are written asynchronously, about every 10 seconds, on a fork of their own, and
  identical widenings in one window are aggregated into one row that counts them
  (`state_after.occurrences`). `state_after` also carries the reason, scope, target
  organization, the module taken from the call stack, the entry point, the actor and up to 20
  request ids. A failed write is retried and logged as `tenant.escape_hatch.persist_failed`.
  Records that cannot be written by shutdown are printed as `tenant.escape_hatch.unpersisted`.
- `EscapeHatchAuditRecord` gains an optional `entryPoint`. `setEscapeHatchAuditSink` now
  returns the sink it replaced.
