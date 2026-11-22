---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-i18n': minor
---

The server-backed list reorder that CRM and Tasks each kept a copy of now lives in the admin kit
(issue #1633): `useServerReorder` and `ReorderControls` from `@endora-commerce/admin-kit/components`,
with the types `ReorderableRow`, `ReorderNotice`, `UseServerReorderOptions`, `UseServerReorderResult`
and `ReorderControlsProps`. The hook moves the row at once, sends the whole list in one save, rolls back
and reports a refusal, and on a 409 `ORDER_STALE` reloads the list and says so; the screen still passes
its own `staleMessage` and `failedMessage`. The CRM workflow statuses and the Tasks statuses and
priorities use the kit copies and behave as before.

The controls' accessible names are now `core` copy: `reorder.moveRowUp` and `reorder.moveRowDown`
("Move {name} up" / "Move {name} down", same wording in Polish as before). The `crm` and `tasks` keys
`reorder.moveUp` and `reorder.moveDown` are removed.
