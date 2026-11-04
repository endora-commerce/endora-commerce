---
'@endora-commerce/mod-seo': minor
---

**Breaking — product metadata has three scopes and is saved with the product (feature 172).**

- Product SEO overrides sit at Global, Channel or Channel × language. **The `product_meta_three_levels` migration deletes every product override stored for a language without a channel** — there is no such scope any more; category and CMS page overrides are unchanged.
- `GET /api/v1/admin/seo/meta/product/:id` is a static route on `catalog:read`, addressed by `?channelId=&languageCode=`, and answers each field's own or inherited value, the resolved metadata and its sources.
- The generic `PUT` and `DELETE /api/v1/admin/seo/meta/product/:id` answer `422 VALIDATION_FAILED` (`reason: product_seo_saved_with_product`): product SEO is written by catalog's `PUT …/scoped-values`, through the new `seoProductMetaWritePort` (`readWithin`, `applyWithin`) on the caller's transaction.
- `seoMetaWritePort` (`SeoMetaWritePort.upsertProductMeta`, a language-only writer) is removed. Write product SEO through catalog's save, or through the connector port where the field is supported.
- The derived product metadata reads the effective name and description at the request's channel and language (`catalogProductAvailabilityPort.effectiveTexts`); a deliberately empty override makes the page use the derived value.
