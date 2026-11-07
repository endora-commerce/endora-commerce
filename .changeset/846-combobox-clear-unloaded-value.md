---
'@endora-commerce/admin-kit': patch
---

`Combobox` (`@endora-commerce/admin-kit/ui`) now lets you clear any value the field shows, not only one found among the loaded `options`. Before, the "Clear selection" button and Backspace on an empty input worked only once `options` contained the current `value`. So a server-side picker that shows its value through `selectedLabel` could not clear it when that value was missing from the current page, or when the lookup no longer returned it (a deactivated record). This affected every picker built on `Combobox`, the kit's own and modules' alike. The props are unchanged; `clearable={false}` and `disabled` still mean no Clear. A non-null `value` that the field cannot show (not in `options` and no `selectedLabel`) still offers nothing to clear.
