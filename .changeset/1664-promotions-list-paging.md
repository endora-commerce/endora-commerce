---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-i18n': patch
---

`GET /api/v1/admin/promotions` pages (issue #1664). `adminPromotionListQuerySchema` takes `page` (default 1) and `pageSize` (1–200), and `promotionListResponseSchema` now carries `meta: { page, pageSize, total }`, ordered by name. A caller that names no `pageSize` still gets the whole list on one page, with `meta.pageSize` equal to its length (at least 1).

- **Promotions (admin)**: the list is the kit `ListPage` with the kit pager, like the sales lists unified under issue #1500 (UX audit SALES-24). *New promotion* is in the header for an operator holding `promotions:write`, and the name is the link to the editor. *Statistics* and *Delete* are in each row's menu; *Delete* is last and confirmed, and the request runs inside the dialog. The kind and value columns are translated ("X% off the whole cart", "10%") instead of action codes and English built in code. Attribute criteria name their operator, and category, product, customer-group and organization criteria are counted; the old list could not draw them.

Removed an unused translation key (core): `promotions.empty`.
