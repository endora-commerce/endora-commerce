---
'@endora-commerce/mod-projects': patch
---

Projects creates a Stage's Tasks and deletes a Project's Tasks through `taskCommandPort` rather than the deprecated `taskWritePort` (issue #1829). Its manifest's `degrades-without` edge on `tasks` names `taskCommandPort`. Behaviour is unchanged.
