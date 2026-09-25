---
title: Attribute Sets
---

# Attribute Sets

Attribute Sets group `ProductAttribute` definitions into reusable
schemas. Every Product is wired to exactly one Attribute Set; the system
ships a `default` set that applies when admins do not pick one.

## Why they exist

Without sets, every Product carries its full attribute graph in
`attributeValues`. Different product types (electronics, apparel,
chemicals) need different attributes, but the foundation schema
treated every key as global. Sets let admins curate a focused authoring
experience per category and let the storefront render a tighter
attribute table.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attribute-sets` | admin | List all sets including `default` |
| `GET /api/v1/admin/catalog/attribute-sets/:id` | admin | Set detail with assigned attributes |
| `POST /api/v1/admin/catalog/attribute-sets` | admin | Create custom set (`code` snake_case, unique) |
| `PATCH /api/v1/admin/catalog/attribute-sets/:id` | admin | Update name; system Default is immutable |
| `DELETE /api/v1/admin/catalog/attribute-sets/:id` | admin | Delete; rejects with 409 when any Product references the set |
| `POST /api/v1/admin/catalog/attribute-sets/:id/attributes` | admin | Assign attributes to the set |
| `DELETE /api/v1/admin/catalog/attribute-sets/:id/attributes/:key` | admin | Unassign |

The Product create/update payload accepts `attributeSetId`. When
omitted, the system Default Set is used.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `ATTRIBUTE_SET_CODE_TAKEN` | 409 | `code` already exists |
| `ATTRIBUTE_SET_IN_USE` | 409 | Delete blocked: at least one Product references the set |
| `SYSTEM_ATTRIBUTE_SET_IMMUTABLE` | 409 | Mutating the seeded Default Set |
| `ATTRIBUTE_SET_NOT_FOUND` | 404 | `:id` missing |
| `ATTRIBUTE_NOT_FOUND` | 404 | `:key` missing on assignment |

## Storefront integration

`productDetail.attributeSet` carries `{id, code, name}` so themes can
render the set label above the attribute table. Foundation reference
theme renders the localized set name as a small subheading.

## Storage

`attribute_sets` (id, code unique, name jsonb, is_system bool) +
`attribute_set_attributes` (composite PK on (set_id, attribute_id)).
The system Default row is seeded by migration 017 with deterministic
UUID `defa0017-0000-4000-8000-000000000000` so seeds and tests can
reference it stably.

## Audit log

AttributeSet CRUD writes one `AuditLogEntry` per mutation with
`stateBefore` and `stateAfter` so the audit page surfaces who changed
what.
