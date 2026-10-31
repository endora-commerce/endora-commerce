---
'@endora-commerce/mod-admin-actions': minor
---

A palette action's `keywordsKey` (issue #560) is stored in a new nullable `module_actions.keywords_key` column — migration `Migration20261030T145645AdminActionsKeywordsKey` — and resolved in the operator's language, falling back to English, when `GET /api/v1/admin/admin-actions` answers. Its words are served after the manifest's `keywords`, so an operator finds the action by a word in their own language and still by the English one. The reconciler writes the column on the next install or boot reconcile.
