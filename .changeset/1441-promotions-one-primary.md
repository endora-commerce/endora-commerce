---
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-i18n': patch
---

The promotion screens keep one filled button per view (issues #1436 and #1441). The promotions list no longer shows the "Cart-level discounts. Percentage values are 0..100; amount-off requires a currency." description: the title says the first half, and the editor's fields already enforce the second. In the promotion rule library, each saved rule's red Delete button is now a quiet bin icon named after the rule, and it asks before deleting. In the promotion editor, the coupons' Add and Generate buttons are outline, so the sticky Save is the only filled button. The `promotions.page.description` translation key is removed; `promotionRules.action.deleteNamed` and `promotionRules.deleteConfirm` are added in English and Polish.
