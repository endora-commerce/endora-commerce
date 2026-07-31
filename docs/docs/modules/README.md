---
sidebar_position: 1
title: Backend modules
---

# Backend modules

Each backend module under `backend/src/modules/<name>/` owns a single business
capability and never reaches into another module's internals (Constitution
Principle I). The pages below describe each module so two audiences can use
them:

- **Developers** who need to extend the module — internal entities, services,
  and hooks they can plug into.
- **Product Owners** who need to understand *what* a module does and *which
  flows* it powers without reading code.

The OpenAPI document at `GET /api/v1/_openapi.json` is the live contract for
every HTTP surface listed here; see [API Contracts](../contracts/) for
how to consume it.

## Module map

| Module | Capability | Owns HTTP surface? |
| --- | --- | --- |
| [addresses](./addresses) | Customer postal addresses with default-per-kind invariant | yes |
| [admin-actions](./admin-actions) | Module-contributed action registry surfaced in the Admin Command Palette (⌘K Actions group) | yes (read-only admin endpoint) |
| [admin-i18n](./admin-i18n) | Admin UI per-user language preference + module-scoped translation bundles | yes |
| [admin_roles](./admin_roles) | Admin role definitions + per-module Permissions | yes |
| [admin_users](./admin_users) | Platform Administrator accounts + impersonation | yes |
| [analytics](./analytics) | Storefront event ingest + admin aggregation + optional GA4 forwarder | yes |
| [api_keys](./api_keys) | Bearer-token integration credentials | yes |
| [assets-library](./assets-library) | Central digital-asset library with pluggable storage adapters, soft-delete, and reference-protection guards | yes |
| [audit_logs](./audit_logs) | Sensitive-action audit trail | yes (admin viewer) |
| [auth](./auth) | Customer + admin sessions, password hashing, TOTP | shared |
| [blog](./blog) | Editorial Posts with Page Builder bodies, taxonomy (Categories + Tags), and storefront feeds | yes |
| [carts](./carts) | Customer shopping cart with anonymous→logged-in merge | yes |
| [catalog](./catalog) | Products, variants, categories, attributes, sales channels | yes |
| [cms](./cms) | Page Builder authoring surface — Pages, Blocks, Templates, Hooks — per channel + language | yes |
| [comparisons](./comparisons) | Compare Products: customer-curated set with display modes, share link, and PDF export | yes |
| [credentials](./credentials) | Reusable typed credential configurations (LLM, email adapter) referenced from settings | yes (admin) |
| [credit_limits](./credit_limits) | Credit-limit grant + atomic reservation | yes |
| [currencies](./currencies) | Pool of accepted ISO 4217 currencies + default | yes |
| [customer_accounts](./customer_accounts) | Customer login, password reset, 2FA, role assignment | yes |
| [delivery_methods](./delivery_methods) | Configured delivery options | yes |
| [dictionary](./dictionary) | Seeded reference data — Countries, Currencies, Languages — with admin reordering | yes |
| [health_checks](./health_checks) | Liveness + readiness probe | yes |
| [import_export](./import_export) | CSV import / export for bulk-edit entities | yes |
| [inventory](./inventory) | Stock levels, reservations, availability notifications | yes |
| [invoices](./invoices) | PDF invoice / proforma generation + asset linkage | yes |
| [ksef](./ksef) | Krajowy System e-Faktur integration — FA(3) submission of issued invoices, KSeF numbers + UPO, certificate management | yes (admin) |
| [languages](./languages) | Pool of supported BCP-47 language tags + translation-fallback helper | yes |
| [megamenu](./megamenu) | Configurable navigation tree with per-channel + per-language bindings | yes |
| [module-lifecycle](./module-lifecycle) | CLI-driven install / uninstall / enable / disable / status for every backend module + dependency validation + first-boot reconciliation | yes (read-only admin endpoint) |
| [orders](./orders) | Order placement, status machine, payment + delivery linkage | yes |
| [organizations](./organizations) | Customer Organizations, registration, invitations | yes |
| [payment_methods](./payment_methods) | Configured payment methods | yes |
| [tpay](./tpay) | TPay payment gateway (BLIK, cards, transfers) | yes |
| [payu](./payu) | PayU payment gateway (BLIK, cards, pay-by-link) | yes |
| [payments](./payments) | Payment driver dispatch + settlement events | yes |
| [price_lists](./price_lists) | Customer / group / default pricing with volume tiers + per-category adjustments | yes |
| [promotions](./promotions) | Cart-level percentage / amount / free-delivery discounts with eligibility filters | yes |
| [quick_order](./quick_order) | CSV-import + type-ahead helpers for buyers ordering by SKU | yes |
| [quote_requests](./quote_requests) | RFQ lifecycle (draft → quote → accept/reject) | yes |
| [sales_channels](./sales_channels) | Channel registry, request resolver, bidirectional membership for every channel-scoped entity | yes |
| [search](./search) | Meilisearch indexer + query bridge | no |
| [seo](./seo) | Meta-tag resolver + cached XML sitemap | yes |
| [settings](./settings) | Manifest-driven, per-sales-channel platform configuration with cached read API | yes |
| [shopping_lists](./shopping_lists) | Per-customer named bundles convertible to Cart or RFQ | yes |
| [taxes](./taxes) | Tax-rate resolver narrowed by country / product type / VAT status | yes |
| [webhooks](./webhooks) | Outbound HMAC-signed event subscriptions | yes |
