---
'@endora-commerce/mod-tasks': minor
---

Tasks take part in a Project merge (issue #1907, `specs/192-organization-merge/` US6): a new
participant (`project-tasks`, `records` phase) moves the Tasks of the merged-away Project to the
survivor's context, without their Stage, and re-points the Task references naming it, through the
new audited Command `task.merge_move_context`. A mention of a merged Project in a Task's text now
renders as, and links to, the survivor.
