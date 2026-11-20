---
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/mod-i18n': patch
---

The audit log screen (issue #1555): the *Action* and *Object type* filters offer what the log holds, actions under the labels the table uses, instead of asking for a code; the filters are a toolbar above one results card and apply as they change; the list pages through the whole log; and a row's detail shows the change field by field, with the stored JSON one disclosure away. `GET /api/v1/admin/audit-log` now answers `pagination.cursor` while more entries exist and reads `?cursor=`; its page is capped at 200 (it was 500, and paged nowhere). New `GET /api/v1/admin/audit-log/facets` under `audit_log:read`.
