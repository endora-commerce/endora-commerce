---
'@endora-commerce/mod-projects': patch
---

Projects admin: nothing typed is discarded without a question (issue #452). On the create form, choosing a Template while Stages are typed by hand, or while the description is one written by hand, asks first in the admin's confirmation dialog; Cancel leaves the form as it was, and choosing "No template" again brings back the typed Stages and description. The Template editor guards unsaved edits with the admin kit's unsaved-changes prompt (links and leaving the page), asks before Cancel discards them, and asks before Duplicate, which copies the saved Template and not what is on screen. New strings in English and Polish under `create.template.replace.*`, `templates.editor.unsaved.*` and `templates.editor.duplicateUnsaved.*`.
