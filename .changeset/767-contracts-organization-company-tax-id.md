---
'@endora-commerce/contracts': minor
---

New `organizationCompanyTaxId(organization)`: the tax id a reader may print or hand out for an `OrganizationRecord` — a company Organization's, `null` for a personal (B2C) Organization, whose `taxId` is an internal placeholder, and `null` for an empty one (issue #767). Three response shapes widen accordingly: `adminOrderDetailSchema`'s `organization.taxId`, the admin quote request's `organization.taxId` and `priceBookTargetOrganizationSchema`'s `taxId` are now `string | null`. A consumer that read them as `string` must handle `null`, which is answered for a personal Organization. The admin order and admin quote request `organization` objects also gain a required `isPersonal: boolean`. The helper accepts an Organization whose `isPersonal` is absent and reads it as a company.
