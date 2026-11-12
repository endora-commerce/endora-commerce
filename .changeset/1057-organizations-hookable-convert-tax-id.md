---
'@endora-commerce/mod-organizations': minor
---

`organization.convert_to_company` and `organization.tax_id.change` are hookable (issue #1057): the manifest lists both refs, and both Commands supply `hookData` and `outboxData` and accept `extensions`. A hook on either is handed ids, codes and field names only, never the tax ID.

- A tax-ID correction to the same value still runs its hooks, with `changedFields: []`. It records no audit entry unless a hook noted a write; then it records one, `stateBefore: null` and `stateAfter: { extensions }`, naming only the hook's fields.
- `organizationCommandPort.convertToCompany(id, input, { extensions })` and `changeTaxId(id, input, { extensions })` forward extension input; a key no present hook module claims answers `422 COMMAND_EXTENSION_UNCLAIMED` before anything is written. No HTTP body carries it.
