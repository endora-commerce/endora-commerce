---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-product-feeds': patch
---

Feed template and run-issue replies are described by their contract (issue #599, section 6):

- `feedTemplateSchema` declares `fieldCount` (optional). Every template reply has answered it: the list, the detail, create, update, duplicate and import. The admin template list, the start-from page and the create-feed page read it, and the contract did not declare it.
- `feedTemplateListResponseSchema` makes `pagination` optional. `GET /api/v1/admin/feed-templates` answers the whole list as `{ data }` and has never sent `pagination`, which the schema required.
- New `feedTemplateSaveWarningSchema` / `FeedTemplateSaveWarning` and `feedTemplateUpdateResponseSchema` / `FeedTemplateUpdateResponse` describe `PUT /api/v1/admin/feed-templates/:id`, which answers `warnings` beside `data`. New inferred types `FeedTemplateResponse`, `FeedTemplateListResponse`, `ImportFeedTemplateResponse` and `FeedRunIssueListResponse` cover the existing schemas.
- `mod-product-feeds` builds template, template-field and run-issue replies as the contract's `FeedTemplate`, `FeedTemplateField` and `FeedRunIssue` instead of `Record<string, unknown>`. The template and run-issue routes declare their reply types. The admin API module's `FeedTemplateFieldDto` and `TemplateSaveWarning` are now aliases of the contract types instead of hand-written copies. Nothing on the wire changes.
