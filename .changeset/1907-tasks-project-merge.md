---
'@endora-commerce/mod-tasks': minor
---

Tasks take part in a Project merge (issue #1907, `specs/192-organization-merge/` US6): a new
participant (`project-tasks`, `records` phase) moves the Tasks of the merged-away Project to the
survivor's context, each into the survivor's Stage of the same name or else its current Stage (the
Stage map the Project host writes into the merge's host context), and re-points the Task references naming it, through the
new audited Command `task.merge_move_context`. A mention of a merged Project in a Task's text now
renders as, and links to, the survivor.
