---
'@endora-commerce/mod-organizations': patch
---

The organization detail screen no longer shows raw catalogue keys or raw codes (issues #1321 and #1322). The order confirmation e-mail field and its hint now have English and Polish text. The account status and VAT status options show translated labels, and so do the status filter and the VAT column of the Organizations list.

The VAT status labels moved from `convertToCompany.vatStatus.<code>` to `vatStatus.<code>` in the module's bundle, beside the new `status.<code>` labels. A deployment that overrides the old keys must rename them.
