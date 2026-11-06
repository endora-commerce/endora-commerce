---
'@endora-commerce/cli': patch
'@endora-commerce/cms-components': patch
'@endora-commerce/mod-addresses': patch
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-linkedin-ads': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-meta-ads': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-prompt-actions': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/platform': patch
---

A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.
