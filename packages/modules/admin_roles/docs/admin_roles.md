---
title: admin_roles
description: Admin role definitions + per-module Permissions
---

# `admin_roles`

Admin role definitions and the per-module Permission matrix the role grants.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/roles` | List Roles |
| `POST /api/v1/admin/roles` | Create Role with a Permission set |
| `PATCH /api/v1/admin/roles/:id` | Update Role |
| `DELETE /api/v1/admin/roles/:id` | Delete (rejected if assigned to active admin users) |

## Permission model

Permissions are strings shaped `module:action` (e.g. `catalog:write`,
`integrations:manage`, `audit:read`). `permission-service.ts` exposes
`hasPermission(adminUser, 'module:action')`; the `requireAdmin(permission?)`
pre-handler in `auth/plugin.ts` consults it on every gated route. A Role
may also require 2FA — `requireAdmin` enforces the 2FA challenge before
invoking the route handler.

## The platform-administrator role

Every instance has one role the platform creates itself: `platform_admin`,
shown as *Platform administrator*, holding the wildcard `*` — every permission.
Installing the module creates it and every boot ensures it is still there with
full access, so the role an administrator is given by default always exists.
Its permission set cannot be narrowed and the role cannot be deleted
(409 `ADMIN_ROLE_PROTECTED`), whether or not anybody holds it. Renaming it is
allowed and is kept.

An administrator must hold a role. `hasPermission` refuses an active
administrator that has none with 403 `ADMIN_ROLE_REQUIRED` rather than
answering "no", so the operator is told what to repair; see `admin_users` for
how to repair it.

## Entities

`AdminRole`, with `requires2fa: boolean` and a `permissions: string[]`
column.

## Extension points

- **Custom permission strings** — define new ones at their first use; the
  permission set is open and not enumerated server-side.
- **Hierarchical roles** — `permission-service.hasPermission` can resolve
  inherited permissions; today every Role is flat.
