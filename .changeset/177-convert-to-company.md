---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-returns': minor
---

**Personal → company conversion.** An operator can turn a personal (B2C) organization into a company in place: same id, orders, carts, addresses and channels, now with a company name, legal name, tax ID, registered address and VAT status.

- **Command** `organization.convert_to_company` — one transaction. The tax ID is normalised and checked against the active tax-ID scope. The organization keeps its status; it is stamped approved by the operator when it never was. Its member stays its Administrator, and the conversion is refused when that is not so. `personalAccountId` is cleared and `convertedToCompanyAt` set. The audit records only which fields changed (`changedFields`), whether the approval was stamped, and the scope. Refusals: `409 ORGANIZATION_CONVERSION_REFUSED` (`not_personal`, `deleted`, `owner_not_administrator`; new in `ERROR_CODES`) and `409 ORGANIZATION_TAX_ID_EXISTS`. There is no reverse.
- **Admin API** `POST /api/v1/admin/organizations/:id/convert-to-company` (`adminOrganizationConvertToCompanyBodySchema`) under the new permission `organizations:convert-to-company`. With `validateTaxId: true` — which also needs `customers:manage`, the VAT validation's own permission — a VAT validation runs **after** the conversion commits; its outcome is returned as `vatValidation`, and a failing provider does not undo the conversion. The admin conversion form offers *Validate the tax ID after converting* (ticked by default) only to an operator holding `customers:manage` and sends `validateTaxId: false` otherwise, so the default form is never refused `403`.
- **Port** `organizationCommandPort` (`OrganizationCommandPort.convertToCompany`) for admin routes and server code, never for a customer-facing route. **It checks no permission**: the caller is the gate. It runs with the ambient actor and runs no VAT validation.
- **Event** `organization.converted_to_company.v1` `{ eventId, occurredAt, organizationId, convertedAt }`, dispatched once on commit (`OrganizationConvertedToCompanyEvent`).
- **Returns** — a return of an order placed while the organization was personal is still a consumer withdrawal after a later conversion (`organizationWasConsumerAt`). The `isPersonalOrganization` dependency of the returns services takes the order's placement time as an optional second argument.
- To move the converted company's only member out, give a second member the Administrator role first, as for any company.
