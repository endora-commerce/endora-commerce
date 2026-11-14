---
'@endora-commerce/mod-projects': patch
---

Issue #460 — a Project's *Change history* names what its entries refer to and draws the nested changes, on the kit `RecordHistory`'s label and renderer props.

- People (members, listed people), Organizations, Stages and Roles are shown by name, never as ids. Names come from the Project, the Roles dictionary and the entries' actors. A Stage the Project no longer has keeps the name an older entry recorded for it. Anything else that cannot be named reads as *no longer on this project*.
- A change of the members lists who was added (with their roles), whose roles changed and who was removed. A change of the workflow lists the moves it allowed and withdrew. A change of a Stage's tasks lists the tasks added, changed and removed. An entry about one Stage names that Stage first.
- A comment's kind, a Stage entry's notes and a loss reason are shown in the reader's language. A Stage's own fields (planned duration, responsible roles, deadline, completion gate and the rest) have labels.
- `ProjectHistory` now takes the Project (`project`) instead of `projectId`.

Nothing new is recorded in the audit log, and nothing is migrated.
