---
'@endora-commerce/contracts': minor
---

`returnCaseSummarySchema` (and so `ReturnCaseSummary`) gains the required field `customerAccountId: uuidSchema`, the account that filed the case (`specs/170-organization-roles/` FR-053, owner ruling OR-11). A buyer whose role holds `returns.view_organization` lists the Organization's cases, and the field lets the storefront tell a colleague's case from the caller's own. Additive for readers: `returnCaseDetailSchema` already declared the field and keeps it, and `adminReturnRowSchema` inherits it through `.extend`. A producer that builds a `ReturnCaseSummary` or an `AdminReturnRow` must now fill it.

The doc comment on `OrderReadPort.findByIdForCustomer` is corrected (comment only, no type change): a member whose organization role holds `orders.view_organization` (*Administrator* included) reaches every order of the Organization, anyone else only the orders they placed; `returns` is named beside `invoices` as a consumer (FR-054).
