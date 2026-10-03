---
'@endora-commerce/mod-pwa': patch
---

`POST /api/v1/admin/pwa/icon` can be reached. The route accepts `multipart/form-data` only, and
the module registered no multipart parser, so every upload was refused before the handler ran and
answered `500 INTERNAL`. The route now registers `@fastify/multipart` in a context of its own, so
the parser reaches no other route of the module. An upload larger than `PWA_ICON_MAX_BYTES` (5 MB,
exported from the module's admin routes) is refused as `400 PWA_ICON_INVALID`; what an icon may be
— PNG or WebP, square, at least 512 pixels — is unchanged.
