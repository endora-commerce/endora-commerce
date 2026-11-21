---
'@endora-commerce/mod-projects': patch
---

A project's Stages tab lists each stage as one compact row instead of an always-open form (issue #1523). *Edit* opens one stage at a time, and that stage's single *Save* writes its fields and the tasks it creates on entry together; the separate *Save* for the stage's tasks is gone. Opening another stage over unsaved changes, and deleting a stage, now ask first. The result of a change is said next to *Add stage*. On a project's Overview and on *New project*, the sentence under *Who sees this project* names the module setting by the label the Settings screen gives it, and is one clause long (issue #1565). No API, setting, permission or migration changes.
