---
'@endora-commerce/platform': patch
'@endora-commerce/cms-components': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-settings': patch
---

Un-awaited Promises found by the typed lint rules now enabled for the whole repository (issue #1027) are awaited, handled or marked as deliberate fire-and-forget. No behaviour changes:

- `resumeWorkersFor` no longer awaits BullMQ's synchronous `Worker.resume()`; the API interceptor pre-handler is typed as Fastify's async hook.
- The breakpoint video hook ignores a refused autoplay through `Promise.resolve(video.play()).catch(...)`.
- Admin screens wrap async form and button handlers in `void` (each handler catches its own errors), and the admin-search matchers of catalog, orders and quote requests are typed as returning `unknown`, because a Knex builder is thenable.
