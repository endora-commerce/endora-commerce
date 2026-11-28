---
'@endora-commerce/cli': minor
---

`endora check` runs the new `check:merge-participation` rule over a module package
(issue #1907): every persisted `organizationId` / `*OrganizationId(s)` / `projectId` / `*ProjectId`
property of the package's own entities must be declared, with a disposition, by its manifest's
`merge.participates`. New rule module `@endora-commerce/cli/rules/merge-participation.js`.

`check:divergence` classifies the two record-merge members of `ModuleContext`, `ctx.merge.host` and
`ctx.merge.participate`, as `own-surface`: a module making its own record type mergeable, or moving
its own records after a merge, is not a divergence from core.

The rule also reports `unguarded-reference-write`: a module file that sets a declared, not `kept`,
reference in SQL (`insert into` / `update … set`) or a native ORM call, while its participation is not
`freeze: 'guarded'` or the file never asks the freeze (`assertMergeWritable`, `mergeWriteRefusal`).
New exports `entityTablesFromSource` and `referenceWriteFindings`.
