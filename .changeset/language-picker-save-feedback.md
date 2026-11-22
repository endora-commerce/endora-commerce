---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

Show an accessible, localized EN/PL error beside the top-bar language picker when saving the preferred language fails: the previous language is restored and another attempt is possible. Escape, an outside click or reopening the menu dismisses the error. A failed session refresh after a successful save keeps the new language (#1769).
