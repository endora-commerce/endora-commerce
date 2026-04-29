---
title: Product Attachments
---

# Product Attachments

Product Attachments are downloadable files (certificates, technical
specifications, product cards, generic PDFs) attached to a Product.
They wrap an underlying `Asset` row, so the same file can be linked to
multiple Products without duplication — the `assets` row survives even
when an attachment is deleted.

## Attachment Types

The `attachment_types` dictionary categorizes attachments. Migration
021 seeds four standard rows with deterministic UUIDs so seeds and
tests can reference them stably:

- `certificate` — Certificate / Certyfikat
- `tech_spec` — Technical specification / Specyfikacja techniczna
- `product_card` — Product card / Karta produktu
- `pdf` — generic PDF

Admins can add custom types via the **Attachment Types** page in the
admin panel. Deleting a type that any product still references returns
`409 ATTACHMENT_TYPE_IN_USE`.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attachment-types` | admin | List types with usage counts |
| `POST /api/v1/admin/catalog/attachment-types` | admin | Create custom type |
| `PATCH /api/v1/admin/catalog/attachment-types/:id` | admin | Update name / position |
| `DELETE /api/v1/admin/catalog/attachment-types/:id` | admin | Delete; rejects when in use |
| `GET /api/v1/admin/catalog/products/:id/attachments` | admin | List attachments on a product |
| `POST /api/v1/admin/catalog/products/:id/attachments` | admin | Attach an existing Asset |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Update name / description / type / position |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Remove (Asset survives) |

## Errors

| Code | Status | When |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Attachment Assets must be `pdf`, `certificate`, or `other` (image/video are gallery-only) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Delete blocked by usage |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | `code` collision on create |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | `:id` missing |
| `ATTACHMENT_NOT_FOUND` | 404 | `:attachmentId` missing |

## Storefront integration

`productDetail.attachments[]` carries the full type and Asset metadata
(filename, sizeBytes, mimeType, url). The `<AttachmentsList>` component
groups by AttachmentType (preserving first-seen order so admin-curated
positions shape the section ordering), renders one heading per type,
and emits download anchors with `download={filename}` for clean file
names.

## Storage

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, name, description, position).

The Foundation has no public `AssetsService` — the catalog uses direct
`Asset` entity imports across modules. An admin Asset upload UI is a
foundation-level follow-up; until then, admins paste an existing
asset id when creating an attachment.
