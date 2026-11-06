---
'@endora-commerce/mod-seo': minor
---

`POST /api/v1/admin/seo/sitemap/:channelCode/regenerate` and `GET /api/v1/admin/seo/sitemap/:channelCode/xml` answer `404 NOT_FOUND` for a channel code no sales channel has, as the crawler-file preview does. They answered `500` before (issue #793).
