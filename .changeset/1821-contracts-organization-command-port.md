---
'@endora-commerce/contracts': minor
---

`OrganizationCommandPort` (container name `organizationCommandPort`, owner `organizations`) is now the Organization aggregate's write port (issue #1821, `specs/186-aggregate-ports/`). Besides `convertToCompany` and `changeTaxId` it declares `create`, `update`, `setParent` (`{ parentId: string | null }`, `null` detaches), `approve`, `reject` (`OrganizationRejectInput`: a required `reason`, optional `notifyCustomerEmail`), `block` (`OrganizationBlockInput`), `unblock`, `delete`, `setCustomFieldValues` (a `CustomFieldMerge`), `setRestrictions` (`OrganizationAllowListsReplace`), `patchRestriction` (`OrganizationAllowListKind`, `OrganizationAllowListPatch`; both answer `OrganizationRestrictions`), `setCreditInheritanceMode`, `assignSalesRep` and `unassignSalesRep`. Every method ends in `AggregateCommandOptions`: `OrganizationCommandPortOptions` is now an alias of it, so the existing two methods also accept `expectedVersion` (ignored by them) and `source`.

Deprecated since 0.113.0, removed in a later release — each delegates to its replacement and behaves as before (the one difference: `organizationWritePort.update` checks its options before the patch, so a call with both invalid lists the options errors in its 422):

- `organizationWritePort.findByTaxId(taxId)` → `organizationDetailsPort.findByTaxId(taxId)`
- `organizationWritePort.create(input)` → `organizationCommandPort.create(input)`
- `organizationWritePort.update(id, patch, { expectedVersion })` → `organizationCommandPort.update(id, patch, { expectedVersion })`
- `organizationCustomFieldWritePort.setCustomFieldValues(id, merge, { extensions })` → `organizationCommandPort.setCustomFieldValues(id, merge, { extensions })`
