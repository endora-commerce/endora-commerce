---
'@endora-commerce/contracts': minor
---

New port contract `OrganizationWritePort` (container name `organizationWritePort`, exported as `ORGANIZATION_WRITE_PORT`; owner `organizations`) with its input types `OrganizationWriteCreateInput`, `OrganizationWriteUpdatePatch` and `OrganizationWriteUpdateOptions`. It lets a module find, create and update an Organization's identity and contact fields, for example an ERP or CRM connector that synchronises a customer master. Additive.

- `findByTaxId(taxId): Promise<OrganizationRecord[]>` answers exactly what `OrganizationDetailsPort.findByTaxId` answers: the input is normalised with `normalizeTaxId`, and the result is every live holder, the tree's root first. It returns a list because in the `per-tree-root` tax-ID scope a head office and its branches share one tax ID. Use `OrganizationDetailsPort.resolveByTaxId` for the single match.
- `create(input): Promise<OrganizationRecord>` runs the `organization.create` Command that the admin create uses, with the same checks and the active tax-ID scope. It also accepts `legalName`, `customFieldValues` and `parentId`. `status` is `'active' | 'pending_verification'`.
- `update(id, patch, options?): Promise<OrganizationRecord>` runs a new `organization.update` Command over `name`, `legalName`, `vatStatus`, `registeredAddress` and `orderConfirmationEmails`. It refuses any other key, including the tax ID, whose correction is `OrganizationCommandPort.changeTaxId`. `options.expectedVersion` refuses a stale write.
- Refusals are `HttpError`s typed by `code`: `VALIDATION_FAILED`, `DICTIONARY_ENTRY_NOT_FOUND` / `DICTIONARY_ENTRY_INACTIVE`, `ORGANIZATION_TAX_ID_EXISTS`, `UNKNOWN_SALES_CHANNEL`, `CUSTOM_FIELD_VALUE_INVALID`, `ORGANIZATION_TREE_INVALID`, `NOT_FOUND`, `VERSION_CONFLICT` and `ORGANIZATION_WRITE_CONTENDED`. The actor is the caller's ambient tenant context.
