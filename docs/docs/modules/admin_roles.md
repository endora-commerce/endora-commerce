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

## Entities

`AdminRole`, with `requires2fa: boolean` and a `permissions: string[]`
column.

## Extension points

- **Custom permission strings** — define new ones at their first use; the
  permission set is open and not enumerated server-side.
- **Hierarchical roles** — `permission-service.hasPermission` can resolve
  inherited permissions; today every Role is flat.
