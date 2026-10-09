---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The Admin UI tells an administrator whose account holds no role why the panel is empty. Such an
account can sign in — `GET /api/v1/admin/me` answers 200 with `role: null` and no permissions —
while every permission-gated route refuses it with `403 ADMIN_ROLE_REQUIRED`. The shell mounted
normally, every gated sidebar and palette entry filtered itself out, and the sentence explaining
the refusal was never shown because no page was left to request it. `AppShell` now renders a
warning notice above the routed screen whenever the signed-in session's `role` is `null`, saying
that the account has no role and that another administrator, or `admin:create` on the command line,
has to assign one. The notice is an `Alert` from the design system, so it is announced
(`role="alert"`) as well as shown.

Two keys join the `core` bundle in English and Polish: `appShell.noRole.title` and
`appShell.noRole.description`.

No API, setting or permission changes.
