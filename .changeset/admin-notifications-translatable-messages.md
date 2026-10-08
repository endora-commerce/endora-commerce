---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-admin-notifications': minor
'@endora-commerce/admin-shell': minor
---

An entry on the Admin UI's notification bell can be shown in each reader's language. Additive:
a module that records entries as before is unaffected, and so is a consumer that reads only
`title` and `body`.

**`@endora-commerce/contracts`.** New type `AdminNotificationMessage` —
`{ scope: string; key: string; params?: Record<string, string | number> }`, the bundle
namespace (a module id, or `core`), a key in that bundle and what fills its `{name}`
placeholders. `RecordAdminNotificationInput` gains two optional members, `titleMessage` and
`bodyMessage`; `title` stays required and is the English sentence shown when the message
cannot be resolved. `AdminNotificationRecord` gains the same two as optional members, so an
existing implementation of `AdminNotificationRecordPort` — a test double included — still
satisfies it.

```ts
await adminNotifications.record({
  audience: 'admin_user',
  targetAdminUserId,
  kind: 'my_module.thing.done',
  title: `Thing ${number} is done`,
  titleMessage: { scope: 'my_module', key: 'notifications.done.title', params: { number } },
});
```

**`@endora-commerce/mod-admin-notifications`.** A migration,
`Migration20261007T194748AdminNotificationsMessageKeys`, adds two nullable `jsonb` columns to
`admin_notifications` — `title_message` and `body_message`; nothing is backfilled and existing
rows read `null`. `adminNotificationRecordPort.record` stores a message and answers it, and
**refuses** one it could not draw: a scope that is not a bundle namespace, an empty key or one
longer than 255 characters, a param that is not a string or a finite number, and a
`bodyMessage` without a `body`. `GET /api/v1/admin/notifications` answers `titleMessage` and
`bodyMessage` on every item, `null` when the entry has none.

**`@endora-commerce/admin-shell`.** `NotificationBell` resolves `titleMessage` and
`bodyMessage` through the loaded translation bundles — the reader's language, then English —
and shows the recorded `title` / `body` when the entry carries no message, when no bundle
holds the key (the recording module is switched off or not installed), or when the template
names a placeholder the entry has no param for. A raw key is never shown, and a param is drawn
as text.
