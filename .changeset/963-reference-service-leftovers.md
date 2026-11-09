---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
---

Resolving the references in a text no longer reads the reader's administrator record when the text mentions a Product (issue #963). The reference services of `crm`, `tasks` and `projects` still looked up the reader's preferred language and then discarded it, a leftover from per-locale product names: a Product is named by its single Global `name`. The labels shown do not change.
