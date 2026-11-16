---
title: Admin roles
description: Admin role definitions + per-module Permissions
---

# Admin roles (`admin_roles`)

Admin role definitions and the per-module Permission matrix the role grants.

## Public surface

This module has no routes of its own. The role routes are served by `admin_users` over this
module's services, all under `admin_users:manage`; that module's page describes each answer.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/admin-roles` | List roles with their permission arrays |
| `PUT /api/v1/admin/admin-roles/:code` | Create or update the role with that code (unknown permission codes answer `400 VALIDATION_FAILED`) |
| `GET /api/v1/admin/admin-roles/:code/two-factor-impact` | How many holders would be signed out by turning the role's two-step requirement on |
| `DELETE /api/v1/admin/admin-roles/:id` | Delete (`409 ADMIN_ROLE_IN_USE` while any administrator, a soft-deleted one included, holds it) |
| `GET /api/v1/admin/permissions` | The catalogue of permission codes an operator may grant |

## Permission model

Permissions are strings shaped `module:action` (e.g. `catalog:write`,
`integrations:manage`, `audit_log:read`). `permission-service.ts` exposes
`hasPermission(adminUserId, 'module:action')`; the `requireAdmin(permission?)`
guard, a port of the `auth` module, consults it on every gated route. A role
may also require two-step verification (`requiresTwoFactor`): its holders are
asked for a second factor at sign-in, through the `mfa` module, and turning the
requirement on signs out the holders who have none (see `admin_users`).

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

`AdminRole`, with `requiresTwoFactor: boolean` and a `permissions: string[]`
(JSON) column.

## Extension points

- **Custom permission strings** — a module declares its codes in its manifest's
  `permissions`; the catalogue (`permission-catalogue.service.ts`) offers the codes of
  every present module on `/admin-roles`, and a role is saved only with known codes (a
  switched-off module's included) or the wildcard `*`.
- **Hierarchical roles** — `permission-service.hasPermission` can resolve
  inherited permissions; today every Role is flat.
