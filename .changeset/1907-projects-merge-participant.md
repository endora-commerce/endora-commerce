---
'@endora-commerce/mod-projects': minor
---

Projects take part in an Organization merge as holders of Organization references (issue #1907):
the organization that stays joins every project the duplicate took part in, and the records linked
under the duplicate follow it, through the audited, irreversible Command
`projects.project.merge_reassign_organization`.
