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
| `POST /api/v1/admin/catalog/products/:id/attachments` | admin | Attach an existing Asset with its type and its Global name and description |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Update type / position |
| `PUT /api/v1/admin/catalog/products/:id/scoped-values` | admin | Name, description and hidden flag at Global, a channel, or a channel and language (see below) |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Remove (Asset survives) |

## Per scope: Global, Channel, Channel × language

An attachment is the same file in every sales channel. What can differ per scope is
its name, its description, and whether it is listed at all. All three are scoped
fields, saved with the rest of the scope by `PUT …/products/:id/scoped-values`:

```json
{
  "scope": { "channelId": "<retail-uuid>", "languageCode": "pl-PL" },
  "version": "7",
  "changes": {
    "attachments": { "<attachmentId>": { "name": "Karta techniczna", "description": null, "hidden": false } }
  }
}
```

- **Name** — required: at most 160 characters, never empty, at every scope. An empty
  name at Global is refused.
- **Description** — at most 4000 characters; `null` stores a deliberately empty
  description, which stays empty there even though a parent scope has one.
- **Hidden** — `true` or `false`, at Global, a channel, or a channel and language. A
  hidden attachment is neither listed on the product page there nor linked from it.

`{ "inherit": true }` removes the scope's own value, and a field left out is unchanged.
A scope that holds no value inherits it — Channel × language → Channel → Global.
Writing at a channel the product is not in, or a language the channel does not
offer, answers `422 SCOPE_INVALID`; removing an override is always allowed, even after
the product has left the channel.

Hiding is presentation, not access control. A hidden attachment is not shown at
the scope, but its file keeps its stable URL, and anyone who has that URL can
still download it. Do not rely on hiding to keep a document confidential: a file
that must not be public must not be attached to the product.

Creating or updating an attachment is recorded once in the audit log, as
`product_attachment.create` or `product_attachment.update`, with the attachment's
state before and after. A scoped save is recorded as `product.scoped_values.save`.
Both announce `product.updated.v1`. A request that changes nothing writes nothing and
announces nothing. Deleting an attachment removes its overrides at every scope.

With no override, every channel and language lists every attachment under its Global
name and description.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Attachment Assets must be `pdf`, `certificate`, or `other` (image/video are gallery-only) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Delete blocked by usage |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | `code` collision on create |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | `:id` missing |
| `ATTACHMENT_NOT_FOUND` | 404 | `:attachmentId` missing |
| `SCOPE_INVALID` | 422 | A scoped attachment value for a channel the product is not in, or a language the channel does not offer |

## Storefront integration

`productDetail.attachments[]` carries the full type and Asset metadata
(filename, sizeBytes, mimeType, url), as the request's sales channel and language
show it: attachments hidden there are left out, and the name and description are the
effective values there. The `<AttachmentsList>` component
groups by AttachmentType (preserving first-seen order so admin-curated
positions shape the section ordering), renders one heading per type,
and emits download anchors with `download={filename}` for clean file
names.

## Storage

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, the Global name, description and hidden flag,
position). `product_attachment_scope_overrides` holds a name, description or hidden
flag at a channel or a channel and language; it references the attachment together
with its product, so an override cannot point at another product's attachment, and
it cascades on the attachment's, the product's and the channel's delete.

The Foundation has no public `AssetsService` — the catalog uses direct
`Asset` entity imports across modules. An admin Asset upload UI is a
foundation-level follow-up; until then, admins paste an existing
asset id when creating an attachment.
