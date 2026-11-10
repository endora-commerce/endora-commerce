# Contract: `organizations`' first hookable actions

Published in `packages/contracts/src/organizations.ts` (or a sibling `organization-hooks.ts`
re-exported from the package index) as:

```ts
export const ORGANIZATION_HOOKABLE_ACTIONS = {
  create:              hookableAction<OrganizationCreateHookData,  OrganizationCreateOutbox>(
                         'organization.create', 'organization', ['beforeCommit', 'afterCommit']),
  register:            hookableAction<OrganizationRegisterHookData, OrganizationRegisterOutbox>(
                         'organization.register', 'organization', ['beforeCommit', 'afterCommit']),
  adminPatch:          hookableAction<OrganizationUpdateHookData,  OrganizationUpdateOutbox>(
                         'organization.admin_patch', 'organization', ['beforeCommit', 'afterCommit']),
  setCustomFieldValues: hookableAction<OrganizationUpdateHookData, OrganizationUpdateOutbox>(
                         'organization.set_custom_field_values', 'organization', ['beforeCommit', 'afterCommit']),
} as const;
```

`adminPatch` and `setCustomFieldValues` are declared in the change that lands after #990 (OD-3).

## Data shapes

`OrganizationRecord` is the existing published record (`toOrganizationRecord`). In a hook it
reflects the **uncommitted** state on the Command's transaction. Spec 177 changes
`OrganizationRecord.taxId` to `string | null`; hook data inherits that change.

```ts
interface OrganizationCreateHookData {
  readonly organization: OrganizationRecord;
  readonly salesChannelIds: readonly string[];
}
interface OrganizationRegisterHookData {
  readonly organization: OrganizationRecord;
  readonly customerAccountId: string;
  readonly salesChannelId: string | null;       // null = system default bound
  readonly registryLookupOutcome: string | null;
}
interface OrganizationUpdateHookData {
  readonly organization: OrganizationRecord;    // after
  readonly changedFields: readonly string[];    // sorted column names
  readonly changedCustomFields: readonly string[];
}

type OrganizationCreateOutbox   = { organizationId: string; status: string };
type OrganizationRegisterOutbox = { organizationId: string; customerAccountId: string; status: string };
type OrganizationUpdateOutbox   = { organizationId: string; changedFields: string[]; changedCustomFields: string[] };
```

Every outbox shape carries `organizationId`. The drain pins the handler's tenant context to it.

## Extensions

All four Commands accept `extensions` from their caller. Spec 178 decides how
`POST /api/v1/admin/organizations`, `POST /api/v1/organizations/register` and
`PATCH /api/v1/admin/organizations/:id` carry an `extensions` body field. Until it does, only
server-side callers (ports, overlays) can pass extensions. Spec 176 adds no HTTP field.

## Who else declares

- 177 declares `organization.convert_to_company` with this API, and optionally
  `organization.set_parent` / `organization.move`. These are additive.
- Owners of the other custom-field hosts (`customer_accounts`, `orders`, `quote_requests`,
  `catalog`, `crm_opportunities`, `projects`, `tasks`) declare their own actions when 178 needs them.
  None is declared in 176.
