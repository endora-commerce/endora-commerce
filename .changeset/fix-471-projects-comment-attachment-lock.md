---
'@endora-commerce/mod-projects': patch
---

A note, a message or an attachment written on a Project now locks the Project and asks again, under the lock, whether the writer may still see it (issue #471), as the Project's own writes already did. When another administrator takes the Project out of the writer's sight or reach between the check and the write — adding an Organization the writer does not reach, or taking them off a members-only Project — adding a note or a message, editing or deleting a note, and attaching or removing a file answer `404 PROJECT_NOT_FOUND` and write nothing; an upload refused this way takes its stored file back. Writes on one Project's notes, messages and attachments now run one at a time with the Project's other writes.
