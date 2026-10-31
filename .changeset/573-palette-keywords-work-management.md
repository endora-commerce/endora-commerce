---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
---

The command-palette actions of the work-management modules (`crm`, `projects`, `tasks`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
