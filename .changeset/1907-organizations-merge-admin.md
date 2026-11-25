---
'@endora-commerce/mod-organizations': minor
---

The Organization merge in the Admin UI (issue #1907, `specs/192-organization-merge/`), under
`organizations:merge`.

- **Merge flow.** *More → Merge a duplicate into this organization…* on a company organization's
  page opens three steps: choose the duplicate (company organizations you reach), review the
  preview — every refusal in words, a *Merging is not available yet* notice naming the modules
  while a start would be refused with `RECORD_MERGE_PARTICIPATION_INCOMPLETE`, the records that
  would move per module, conflicts and warnings, a choice per differing value — then confirm
  with an explicit *cannot be undone* tick and start.
- **New screens:** `/organizations/merge` (the flow from ⌘K, choosing the organization to keep
  first), `/organizations/merges` (merges, *needs attention* first, with **Resume**) and
  `/organizations/merges/:mergeId` (progress by phase and step, **Resume**, and **Cancel** before
  any record moved).
- **Palette actions** `merge-organizations` and `open-record-merges`, both under
  `organizations:merge`.
- An archived (merged) organization's page is read-only and says *Merged into … on … by …*,
  linking to the organization that stays; a running merge shows a notice on both organizations'
  pages, and the survivor lists *Merged organizations* on its Overview tab.
- **Bell entries:** when a merge needs attention, every active holder of `organizations:merge`
  who reaches both organizations is notified; when it completes, the administrator who started
  it. Nothing is recorded while `admin_notifications` is off.
- The merge routes now answer each merge with `survivorName`, `loserName` and `actorName` beside
  the ids (`OrganizationMergeView`).
- New page in the module's docs: *Merging duplicate organizations* (English and Polish).
