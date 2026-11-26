---
'@endora-commerce/demo-composition': minor
'@endora-commerce/mod-addresses': minor
'@endora-commerce/mod-admin-actions': minor
'@endora-commerce/mod-admin-notifications': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/mod-auth': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-credentials': minor
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-currencies': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-customer-notifications': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-document-templates': minor
'@endora-commerce/mod-email': minor
'@endora-commerce/mod-erp-connector': minor
'@endora-commerce/mod-forms': minor
'@endora-commerce/mod-google-analytics': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-import-export': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-languages': minor
'@endora-commerce/mod-linkedin-ads': minor
'@endora-commerce/mod-megamenu': minor
'@endora-commerce/mod-meta-ads': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/mod-payments': minor
'@endora-commerce/mod-pim-connector': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/mod-projects': minor
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-prompt-actions': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-related-payers': minor
'@endora-commerce/mod-returns': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-search': minor
'@endora-commerce/mod-seo': minor
'@endora-commerce/mod-settings': minor
'@endora-commerce/mod-shipments': minor
'@endora-commerce/mod-shopping-lists': minor
'@endora-commerce/mod-tasks': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/platform': minor
'@endora-commerce/test-kit': minor
---

**Breaking: MikroORM 7.** The platform and every module package now run on MikroORM 7.2.11
(issue #1866). Their `@mikro-orm/core`, `@mikro-orm/postgresql` and `@mikro-orm/migrations` peers
move from `^6` to `^7.2.11`, and every package that declares an entity gains a
`@mikro-orm/decorators` `^7.2.11` peer: MikroORM 7 moved the entity decorators out of
`@mikro-orm/core`, and the packages now import them from `@mikro-orm/decorators/legacy`. An instance
raises its own `@mikro-orm/*` ranges to `^7.2.11` and adds `@mikro-orm/decorators` before upgrading;
`docs/docs/upgrading-an-instance.md#mikro-orm-7` lists the API changes for an instance's own code.

No migration comes with the switch, the migration history is read as before, and the platform's ORM
configuration keeps MikroORM 6's `joined` loading, `forceUtcTimezone: false` and late `onCreate`
hooks, so queries send the statements they sent on 6.
