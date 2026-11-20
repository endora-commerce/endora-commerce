---
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-i18n': patch
---

Five admin lists no longer draw a create form open above their rows, nor a red button in every row (issue #1501, UX audit SHELL-14). Each is the kit `ListPage`: one *New …* in the header, row actions in a `RowActionMenu` with the destructive one last and confirmed through `useConfirmDialog`, and an `EmptyState` offering the first record.

- **Users** (`/admin-users`): *New user* opens the create form in a dialog; *Reset password* opens a dialog instead of a form expanded under the row; *Deactivate* / *Reactivate* and *Remove* are in the row menu. The role is shown as a value with a *Change…* dialog (`StatusChangeControl`) instead of an unlabelled select that saved as soon as an option was picked.
- **API keys**: the create form is a route of its own, `/api-keys/new` (`contributions.routes[1]`, gated on `integrations:manage` like the list); it ends on the one-time bearer token, shown in place of the form. *Revoke* is in the row menu.
- **Webhooks**: the subscribe form is a route of its own, `/webhooks/new` (`contributions.routes[1]`, same gate); it ends on the one-time signing secret. *Pause* / *Resume* and *Delete* are in the row menu.
- **Taxes**: *New tax rule* opens the upsert form in a dialog, and the new *Edit* row action opens it prefilled, the code read-only.
- **Setting groups** (`/settings/groups`): *New group* opens a dialog with labelled *Code* and *Display name* fields; *Rename* and *Delete* are in the row menu, which is disabled, with the reason, on the system-protected group. Its load, create and delete errors are translated.
