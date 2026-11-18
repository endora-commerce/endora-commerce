---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
---

**Shorter copy on the CRM, Tasks and Projects admin screens** (issue #1486, UX audit WORK-11). The page
descriptions and hints that restated a title or described the controls below them are gone, and the
ones kept — a rule the screen does not show — fit on one line. Translation keys removed from both the
`en` and `pl` bundles: CRM `opportunity.list.description`, `opportunity.create.description`,
`opportunity.create.requiredHint`, `opportunity.stage.hint`, `opportunity.status.reasonHint`,
`board.description`, `workflow.description`, `workflow.statuses.description`, `assignment.changeHint`,
`tags.description`, `analytics.description`, `value.hint.manual`, `boardCard.description`,
`calendar.description`; Tasks `list.description`, `mine.description`, `create.requiredHint`,
`field.assigneeHint`, `comments.hint`, `workflow.description`, `workflow.statuses.description`,
`workflow.field.categoryHint`, `boardCard.description`, `tags.description`, `tags.list.description`,
`priorities.description`, `priorities.list.description`; Projects `list.description`,
`create.stages.hint`, `editor.hint`, `editor.movesHint`, `tasks.hint`, `templates.editor.intro`,
`templates.editor.rolesHint`, `lossReasons.description`. A deployment overriding one of these keys
can drop the override.
