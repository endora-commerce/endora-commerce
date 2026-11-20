---
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-i18n': patch
---

The admin promotion editor is one card with four sections (General, Action, Rule, Usage limits), saved by the one Save in the sticky bar at the end of the form, which now says "Unsaved changes" while the form differs from the stored promotion; Cancel and leaving the screen ask before dropping those changes. Copying a saved rule over a rule that already has conditions asks first, and Cancel keeps the current rule. Every field of the action has a translated label linked to its control, and the action type's label names its select. The Coupons section is marked "Applies immediately", because it writes outside the form's Save; for a promotion that is not saved yet it is a heading and one line, with no controls. The coupon generator's format and limit-scope options, and the scope column of the coupon table, are translated.
