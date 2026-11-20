---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-quick-order': patch
---

Sales admin screens drop the page descriptions that repeated their title or addressed developers (issue #1436, UX audit 2026-11-17, DS-02). The Orders, Customers, Returns, Quote requests, Carts and Organizations lists, the order and quote-request create screens, Order statuses, Return statuses, Payment methods, Credit limits, the promotion editor, Promotion statistics, Order on behalf, New organization, Change tax ID and Convert to company no longer show a description. The payment and delivery method Integrations cards drop their one-line intro.

Kept descriptions are now one line: Return delivery methods ("A return cost of 0 means the shop pays for the return."), Delivery methods ("Price changes don't affect orders already placed."), Promotion rules, Online customers and Customer groups ("A customer's own group overrides their organization's."). New organization says that members are invited from the organization's page beside its Save, as `create.hint.inviteMembers`.

Translation keys removed from both `en` and `pl`: `core` `orders.page.description`, `orderCreate.description`, `orderStatusConfig.description`, `rfq.list.description`, `rfqCreate.description`, `organizations.page.description`, `returns.description`, `returns.statuses.description`, `legacyMethods.payment.description`, `legacyMethods.integrations.description`, `legacyMethods.integrations.shippingDescription`, `creditLimits.page.description`, `promotions.edit.description`, `promotionStats.description`, and the unused `rfq.detail.convert.description` and `rfq.detail.approveDescription`; customers `list.description`; carts `carts.page.description`; quick_order `onBehalf.page.description`; organizations `create.description`, `changeTaxId.page.description` and `convertToCompany.page.description`. A deployment that overrides one of these keys can drop the override.
