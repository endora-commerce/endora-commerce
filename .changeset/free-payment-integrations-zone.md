---
'@endora-commerce/contracts': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-i18n': patch
---

Add the `payment_method.list.integrations` admin zone so separately installed payment gateways can contribute their own configuration cards. Remove the five extracted gateways' breadcrumb and shared translation records from the free packages.
