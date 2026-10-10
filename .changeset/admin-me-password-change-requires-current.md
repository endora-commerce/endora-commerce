---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

An administrator changing their own password has to supply the current one.

**Breaking for API clients of `PATCH /api/v1/admin/me`.** The route used to store whatever
`password` it was sent: a signed-in session was the only proof asked for, so anybody holding one —
an unattended browser, a copied cookie — could replace the password and keep the account. A
request that carries `password` must now carry `currentPassword` as well:

```jsonc
// before
{ "password": "<new password>" }
// now
{ "password": "<new password>", "currentPassword": "<current password>" }
```

- `password` without `currentPassword` is refused with `400 VALIDATION_FAILED`, the issue naming
  the `currentPassword` field.
- A wrong `currentPassword` is refused with `403 CURRENT_PASSWORD_INVALID`. It is 403 and not the
  401 the buyer-side change-password route answers with, because the Admin UI treats every 401 as
  an expired session and signs the administrator out.
- A refused request changes nothing: a first or last name sent in the same request is not applied
  either.
- A request without `password` is unchanged — first and last name stay editable without any
  password, and a `currentPassword` sent alone is ignored.

The current password is checked with the same hash verification sign-in uses. Nothing else about a
password change moves: the administrator's sessions and second factor are left as they were.

`updateAdminUserSelfRequestSchema` in `@endora-commerce/contracts` gains the optional
`currentPassword` field and the rule that ties it to `password`; `UpdateAdminUserSelfRequest` gains
the field. `AdminUserService` in `@endora-commerce/mod-admin-users` gains `updateSelf(id, input)`,
which the route calls, and `AdminUserService.update` no longer accepts `password` — it was the
unverified write, and the route was its only caller.

The other ways to set an administrator's password are untouched: creating an account,
`POST /api/v1/admin/admin-users/:id/password` (a peer reset, gated by `admin_users:manage`) and the
`admin_users create` command.

**Admin UI.** The profile screen has a "Current password" field above "New password". It is asked
for only when a new password is typed, and a wrong one is reported on the field itself, not in
the page banner.

**Sentences.** `errors.CURRENT_PASSWORD_INVALID` in the `core` bundle reads "The current password
is incorrect." / "Obecne hasło jest nieprawidłowe." instead of the placeholders "Current Password
Invalid." / "Błąd: current password invalid." — the buyer-side change-password route answers with
the same code, so its message changes too. Three keys join the bundle in English and Polish:
`profile.field.currentPassword`, `profile.field.currentPasswordHelp` and
`profile.error.currentPasswordRequired`.
