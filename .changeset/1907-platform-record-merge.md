---
'@endora-commerce/platform': minor
---

The record merge mechanism (issue #1907, `specs/192-organization-merge/`).

- `ModuleContext.merge` — `ctx.merge.host(type, impl)` for the module that declares
  `merge.hosts`, and `ctx.merge.participate(host, key, participant)` for every module whose
  `merge.participates` entry moves records. Composition seals the registry and refuses a
  registration without a declaration, a declaration without a registration, and a host declared
  by two modules. In a context built by hand for one module both calls are no-ops.
- `./kernel` publishes the `RecordMergeService` and `RecordMergeBeginInput` types: what a host's
  Commands call through the root-registered `recordMergeService`.
- `./tenancy` publishes `mergeWriteRefusal(hostType, id)`. The org write guard and the request
  scope now refuse a write naming the loser of a running merge (`409 RECORD_MERGE_IN_PROGRESS`,
  except inside that merge's own `record-merge:<id>` system scope) and a write naming a merged
  Organization (`409 ORGANIZATION_MERGED` with `details.survivorId`).
- A cross-cutting migration adds `record_merges`, `record_merge_steps`, `record_merge_locks` and a
  partial index on `audit_log_entries ((state_after ->> 'mergeId'))`.
- The runner consumes the BullMQ queue `platform.record-merge`, started by `_lifecycle` where the
  process runs workers, with a repeatable catch-up every fifteen minutes and on every module
  presence change, so a participant that was off runs its deferred step when it is back.
- `./composition` (host-internal) gains `RecordMergeRegistry`, `mergeDeclarationsFrom`,
  `createRecordMergeRuntime`, `KERNEL_MERGE_PARTICIPATIONS` and the three entity classes; a root
  that composes by hand passes `mergeRegistry` and `mergeDeclarations` to `composeModules` and
  registers `recordMergeService` and `recordMergeRuntime`.
