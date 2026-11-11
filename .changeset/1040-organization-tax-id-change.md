---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
---

**Correct a company organization's tax ID.** An operator can now fix a mistyped tax ID, or give a branch that was wrongly given its head office's tax ID one of its own, without deleting the organization: its id, members, roles and orders stay.

- **Command** `organization.tax_id.change` — one transaction. Only a live company organization: a personal one is refused `409 ORGANIZATION_TAX_ID_CHANGE_REFUSED` `not_company`, a soft-deleted one `deleted` (new in `ERROR_CODES`). The value is normalised and checked against the active tax-ID scope exactly as creation checks it (soft-deleted holders count), and a database refusal at the statement or at commit answers the same `409 ORGANIZATION_TAX_ID_EXISTS`. The VAT validation summary (`vatValidatedAt`, `vatValidationProvider`, `vatValidationOutcome`) is reset to never-validated; `vatStatus` is kept. The same value after normalisation changes nothing and records no audit entry. The audit records names only: `changedFields: ['taxId']`, `vatStatusReset`, the scope. Orders, invoices and quote documents already issued keep the tax ID they were issued with.
- **Admin API** `POST /api/v1/admin/organizations/:id/change-tax-id` (`adminOrganizationChangeTaxIdBodySchema`) under the new permission `organizations:change-tax-id`, answering `{ data, changed, vatValidation }`. With `validateTaxId: true` (which also needs `customers:manage`) a VAT validation runs after the change commits; its failure does not undo the change.
- **Port** `OrganizationCommandPort.changeTaxId(organizationId, { taxId })` for admin routes and server code, never for a customer-facing route. It runs with the ambient actor and runs no VAT validation.
- **Event** `organization.tax_id_changed.v1` `{ eventId, occurredAt, organizationId, changedAt }` (`OrganizationTaxIdChangedEvent`), dispatched once on commit; it carries neither the old nor the new tax ID.
- **Admin UI** — *Change tax ID* on a company organization's page (a dialog starting on the stored tax ID, the conflict shown on the field), and *Change an organization's tax ID* in the command palette (`/organizations/change-tax-id`: pick a company organization, then correct its tax ID). The tax-ID scope screen's warning and refusal now point to this action as the way back to *Global* for a tax ID shared by mistake.
