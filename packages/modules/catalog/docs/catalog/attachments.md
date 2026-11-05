---
title: Product attachments
---

# Product Attachments

Product Attachments are downloadable files (certificates, technical
specifications, product cards, generic PDFs) attached to a Product.
They wrap an underlying `Asset` row, so the same file can be linked to
multiple Products without duplication — the `assets` row survives even
when an attachment is deleted.

## Attachment Types

The `attachment_types` dictionary categorizes attachments. Migration
`20260429T112543_catalog_product_attachments.ts` seeds four standard rows with deterministic UUIDs so seeds and
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
| `POST /api/v1/admin/catalog/products/:id/attachments` | admin | Attach an existing Asset, optionally with names and descriptions per language and the channels it is hidden in |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Update name / description / type / position, names and descriptions per language, channels it is hidden in |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Remove (Asset survives) |

## Per sales channel and per language

An attachment is the same file in every sales channel. What can differ is its name
and description per language, and whether a channel lists it at all.

- **Name and description per language.** `nameTranslations` and
  `descriptionTranslations` map a language to a text, e.g.
  `{ "pl-PL": "Karta techniczna", "de-DE": "" }`. A named language is set, an empty
  string removes it, and a language left out is unchanged. A name is at most 160
  characters, a description at most 4000. The product page serves the text in the
  request's language, else the attachment's global name and description.
- **Hidden per channel.** `hiddenInChannels` is a list of sales channel ids and
  replaces the set of channels the attachment is hidden in. A hidden attachment is
  neither listed on the product page in that channel nor linked from it.

You can hide an attachment only in a channel the product is in; otherwise the
request answers `422 SCOPE_INVALID`. Removing a channel from the set is always
allowed, even after the product has left the channel.

Hiding is presentation, not access control. A hidden attachment is not shown in
the channel, but its file keeps its stable URL, and anyone who has that URL can
still download it. Do not rely on hiding to keep a document confidential: a file
that must not be public must not be attached to the product.

Creating or updating an attachment is recorded once in the audit log, as
`product_attachment.create` or `product_attachment.update`, with the attachment's
state before and after: its product, type, name, description, position, both
translation maps and `hiddenInChannels`. Sending the recorded before-state back
through the same route (without `productId`) restores it. The write announces
`product.updated.v1` with `changedFields: ["attachments"]`. A request that changes
nothing writes nothing and announces nothing.

With none of these set, every channel lists every attachment under its global name,
as before.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Attachment Assets must be `pdf`, `certificate`, or `other` (image/video are gallery-only) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Delete blocked by usage |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | `code` collision on create |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | `:id` missing |
| `ATTACHMENT_NOT_FOUND` | 404 | `:attachmentId` missing |
| `SCOPE_INVALID` | 422 | Hiding an attachment in a channel the product is not in |

## Storefront integration

`productDetail.attachments[]` carries the full type and Asset metadata
(filename, sizeBytes, mimeType, url), as the request's sales channel shows it:
attachments hidden there are left out, and the name and description are in the
request's language. The `<AttachmentsList>` component
groups by AttachmentType (preserving first-seen order so admin-curated
positions shape the section ordering), renders one heading per type,
and emits download anchors with `download={filename}` for clean file
names.

## Storage

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, name, description, position,
name_translations, description_translations).
`product_attachment_channel_hidden` (attachment_id, sales_channel_id,
product_id) holds an attachment hidden in a channel; it cascades on the
attachment's, the product's and the channel's delete.

The Foundation has no public `AssetsService` — the catalog uses direct
`Asset` entity imports across modules. An admin Asset upload UI is a
foundation-level follow-up; until then, admins paste an existing
asset id when creating an attachment.
