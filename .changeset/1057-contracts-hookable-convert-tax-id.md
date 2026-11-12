---
'@endora-commerce/contracts': minor
---

`ORGANIZATION_HOOKABLE_ACTIONS` declares two more Organization writes, both phases (issue #1057, follow-up to `specs/176-command-hooks-outbox/`):

- `convertToCompany` — `organization.convert_to_company`, with `OrganizationConvertToCompanyHookData` (`organizationId`, `status`, `vatStatus`, `changedFields`, `approvalStamped`) and `OrganizationConvertToCompanyOutbox` (`organizationId`, `status`, `changedFields`);
- `changeTaxId` — `organization.tax_id.change`, with `OrganizationTaxIdChangeHookData` (`organizationId`, `changedFields`, `vatValidationReset`) and `OrganizationTaxIdChangeOutbox` (`organizationId`, `changedFields`).

Both data shapes carry ids, codes and field names only — never the tax ID, the name or the address.

`OrganizationCommandPort.convertToCompany` and `changeTaxId` take an optional third argument, the new `OrganizationCommandPortOptions` (`{ extensions? }`): extension input for the hook modules on the action. The two-argument calls are unchanged; an implementation of the port outside this repository gains the optional parameter.
