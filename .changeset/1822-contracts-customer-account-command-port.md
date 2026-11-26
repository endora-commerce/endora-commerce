---
'@endora-commerce/contracts': minor
---

`CustomerAccountCommandPort` (container name `customerAccountCommandPort`, owner `customer_accounts`) is the new CustomerAccount aggregate write port (issue #1822, `specs/186-aggregate-ports/`). It declares `create`, `createStandalone`, `updateProfile`, `block` (`{ reason?: string | null }`), `unblock`, `softDelete`, `restore`, `setCustomerGroup` (`{ customerGroupId: string | null }`), `setCustomFieldValues` (a `CustomFieldMerge`), `setSubtreeRollup` (`{ enabled }`), `promoteToOrganizationAdmin`, `markEmailVerified` (`{ verifiedAt }`), `changeRole` (`{ organizationRoleId }`), `setPreferredLanguage` (`{ language }`), `removeMember` and `anonymize`, each ending in `AggregateCommandOptions` (`expectedVersion` is ignored: an account has no version). No method takes an `actorAdminUserId`: the actor is the ambient one. Moving an account between Organizations is not on it.

`CustomerAccountReadPort` gains `listDueForAnonymization(cutoff)` and `hasDueForAnonymization(cutoff)`, moved from the lifecycle port.

Deprecated since 0.113.0, removed in a later release — each delegates to its replacement and writes the same audit entry as before:

- `customerAccountLifecycleWritePort.createStandalone(input)` → `customerAccountCommandPort.createStandalone(input)`
- `customerAccountLifecycleWritePort.block(id, { actorAdminUserId, reason, audit })` → `customerAccountCommandPort.block(id, { reason })`
- `customerAccountLifecycleWritePort.unblock(id, { actorAdminUserId, audit })` → `customerAccountCommandPort.unblock(id)`
- `customerAccountLifecycleWritePort.softDelete(id, { actorAdminUserId })` → `customerAccountCommandPort.softDelete(id)`
- `customerAccountLifecycleWritePort.restore(id, { actorAdminUserId })` → `customerAccountCommandPort.restore(id)`
- `customerAccountLifecycleWritePort.setCustomerGroup(id, groupId, { actorAdminUserId })` → `customerAccountCommandPort.setCustomerGroup(id, { customerGroupId: groupId })`
- `customerAccountLifecycleWritePort.setCustomFieldValues(id, merge)` → `customerAccountCommandPort.setCustomFieldValues(id, merge)`
- `customerAccountLifecycleWritePort.anonymize(id)` → `customerAccountCommandPort.anonymize(id)`
- `customerAccountLifecycleWritePort.listDueForAnonymization(cutoff)` / `.hasDueForAnonymization(cutoff)` → `customerAccountReadPort.listDueForAnonymization(cutoff)` / `.hasDueForAnonymization(cutoff)`
- `customerAccountMemberWritePort.create(input)` → `customerAccountCommandPort.create(input)`
- `customerAccountMemberWritePort.updateProfile(id, patch)` → `customerAccountCommandPort.updateProfile(id, patch)`
- `customerAccountMemberWritePort.setSubtreeRollup(id, enabled)` → `customerAccountCommandPort.setSubtreeRollup(id, { enabled })`
- `customerAccountMemberWritePort.promoteToOrganizationAdmin(id)` → `customerAccountCommandPort.promoteToOrganizationAdmin(id)`
- `customerAccountMemberWritePort.markEmailVerified(id, verifiedAt)` → `customerAccountCommandPort.markEmailVerified(id, { verifiedAt })`

The Organization moves (`setOrganization`, `detachToPersonalOrganization`, `attachToOrganization`) are not deprecated here.
