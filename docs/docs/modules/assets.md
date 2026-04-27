---
title: assets
---

# `assets`

A minimal binary-asset registry referenced by Catalog (product images),
Invoices (PDFs), and any future module that needs blob storage.

## What it owns

- `Asset` entity (id, mime, byteSize, originalFilename, storage path,
  ownerType, ownerId).
- A pluggable storage adapter — local filesystem in dev, object storage
  (S3 / DO Spaces / Backblaze) in production.

## No standalone HTTP surface

Assets are surfaced through the consuming module:
- Catalog returns image URLs in product responses.
- Invoices are downloaded via `GET /api/v1/orders/:id/invoice`.

## Extension points

- **Storage backend** — the adapter port sits in
  `assets/services/asset-storage-port.ts`; implement against your provider
  and inject in the composition root.
- **Image transforms** — for catalog images, run a transform pipeline at
  upload time and store multiple sizes as separate `Asset` rows.
