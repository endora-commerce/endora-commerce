---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': patch
'@endora-commerce/cli': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-analytics': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-related-payers': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-webhooks': patch
---

`formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`) now **require** the admin UI language: the browser-locale fallback is gone (#1776). Before: `formatDateTime(order.placedAt)`; after: `formatDateTime(order.placedAt, language)`, with `language` from `useAppLanguage()` or `useTranslationContext()` (`@endora-commerce/admin-kit/i18n`). A module that still calls either with one argument stops type-checking.

Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.
