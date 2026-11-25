---
'@endora-commerce/cli': minor
---

`endora check` runs the new `check:merge-participation` rule over a module package
(issue #1907): every persisted `organizationId` / `*OrganizationId(s)` / `projectId` / `*ProjectId`
property of the package's own entities must be declared, with a disposition, by its manifest's
`merge.participates`. New rule module `@endora-commerce/cli/rules/merge-participation.js`.
