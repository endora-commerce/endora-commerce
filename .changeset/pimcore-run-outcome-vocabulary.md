---
'@endora-commerce/contracts': major
'@endora-commerce/mod-pim-pimcore': minor
---

Cut the unreachable half of the Pimcore run-outcome vocabulary.

**Removed from `@endora-commerce/contracts`**, all breaking by removal and none of
them consumed by anything in this repository:

- `pimcoreImportFailureCodeSchema` loses `delivery_protocol_error`, `apply_failed`
  and `other_pim_enabled`; it is now `['worker_lost', 'internal_error',
  'superseded']`. `PimcoreImportFailureCode` narrows with it.
- `pimcoreImportSkipReasonSchema` and `PimcoreImportSkipReason` are gone
  entirely.
- `pimcoreImportRunSchema` (and therefore `PimcoreImportRunDto` and
  `PimcoreImportRunDetailDto`) loses its `skipReason` field.

Nothing wrote any of them. Each removed failure code was structurally unreachable
rather than merely unimplemented: a delivery protocol fault is refused to the
sender as an HTTP status before the Command that would create a run commits, so
there is no run to stamp; an apply fault is isolated to its record and rolls the
run up as `completed_with_issues` with no failure code at all (FR-105, FR-108),
so a run-wide `apply_failed` contradicted the requirement above it; and
`other_pim_enabled` is a skip reason, which by its own definition means the run
never started and therefore cannot also be why a started run stopped. The skip
reasons are the pull-era refusal path retired with FR-005, FR-007 and FR-008 —
`PimcoreImportRun.skipReason` was written nowhere and `run.status` was never
`'skipped'`.

`'skipped'` **stays** in `pimcoreImportRunStatusSchema`: it costs nothing and is
the natural status if a skip path is ever added. `internal_error` stays too — it
is the notifier's defensive default over a nullable column, which is the one
member of the three with a live reader.

**A consumer reading a run DTO needs no change**: a narrowed response union is
the safe direction, and the removed members were never emitted. A consumer that
*wrote* one of these codes into a `PimcoreImportFailureCode`-typed value has no
replacement and should not have compiled — no such consumer exists.

`@endora-commerce/mod-pim-pimcore` drops `PimcoreImportRun.skipReason`, the run
DTO field, the two admin screens' skip-reason rendering and the nine now-dead
`runs.failureCode.*` / `runs.skipReason.*` labels in both shipped languages. The
`skip_reason` column is left on `pimcore_import_runs`, unwritten; no migration.

See `specs/092-pimcore-pim-sync/research.md` §18.3 and `data-model.md` §7.
