# Contract: `organizationCommandPort` (Organization, #1821)

Owner `organizations` (non-deactivatable). Declared in `packages/contracts/src/organizations.ts`,
widening the existing interface (line 943) in place. Lands first (US1); `approve` first within it,
because `specs/188-policy-points/` approves through it.

## Operations

Readiness codes: research R-2. "Route" is the admin route that runs the same Command today.

| Method | Command action (kept) | Admin route | Readiness | Work |
| --- | --- | --- | --- | --- |
| `create(input, options?)` | `organization.create` | `POST /api/v1/admin/organizations` | C | port only |
| `update(id, patch, options?)` | `organization.update` | (behind `organizationWritePort.update`) | C | port only |
| `setParent(id, { parentId }, options?)` | `organization.set_parent` (first assign) / `organization.move` (re-parent) | `POST …/:id/parent` | C | one method: the route already chooses the action by whether a parent exists |
| `approve(id, options?)` | `organization.approved` | `POST …/:id/approve` | H-post | convert (T026) |
| `reject(id, { reason }, options?)` | `organization.rejected` | `POST …/:id/reject` | H-post | convert |
| `block(id, { reason }, options?)` | `organization.blocked` | `POST …/:id/block` | H-post | convert |
| `unblock(id, options?)` | `organization.unblocked` | `POST …/:id/unblock` | H-post | convert |
| `delete(id, options?)` | `organization.delete` | `DELETE …/:id` | C | port only |
| `setCustomFieldValues(id, merge, options?)` | `organization.set_custom_field_values` | `PATCH …/:id` (values) | C | port only |
| `convertToCompany(id, input, options?)` | `organization.convert_to_company` | `POST …/:id/convert-to-company` | C | unchanged |
| `changeTaxId(id, input, options?)` | `organization.tax_id.change` | `POST …/:id/change-tax-id` | C | unchanged |
| `setSalesChannels(id, { salesChannelIds }, options?)` | `organization.sales_channels.set` (new action; today's write records whatever `sales_channels`' membership records) | `PUT …/:id/sales-channels` | ? | T001 confirms the write path; convert |
| `setRestrictions(id, allowLists, options?)` | `organization.allow_lists_replace` | `PUT …/:id/restrictions` | H-in | convert |
| `patchRestriction(id, kind, patch, options?)` | `organization.allow_list_patch` | the three `PATCH` routes `patchRoute(url, kind)` registers, `kind` ∈ `payment_method` \| `delivery_method` \| `warehouse` | H-in | convert |
| `setCreditInheritanceMode(id, { mode }, options?)` | `organization.set_credit_mode` | `PUT …/:id/credit-inheritance-mode` | C | port only |
| `assignSalesRep(id, { adminUserId }, options?)` | `organization.sales_rep_assign` | `POST …/:organizationId/sales-reps` | C | port only |
| `unassignSalesRep(id, { adminUserId }, options?)` | `organization.sales_rep_unassign` | `DELETE …/sales-reps/:adminUserId` | C | port only |

`move` is not a separate method: `setParent` is both, as the route is (research R-9 keeps one method
per operation, and the operation is "place under a parent").

**Not offered** (contract text): members, invitations and roles (their own aggregates; moving an
account is `membershipPort`, `specs/191-membership-join-requests/`); tax-ID scope (a platform setting,
not one Organization); VAT validation runs (not a write of the aggregate).

## Interface (shape)

```ts
export interface OrganizationCommandPort {
  create(input: OrganizationWriteCreateInput, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  update(id: string, patch: OrganizationWriteUpdatePatch, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  setParent(id: string, input: { parentId: string }, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  approve(id: string, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  reject(id: string, input: { reason: string | null }, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  block(id: string, input: { reason: string | null }, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  unblock(id: string, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  delete(id: string, options?: AggregateCommandOptions): Promise<void>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  convertToCompany(id: string, input: OrganizationConvertToCompanyInput, options?: OrganizationCommandPortOptions): Promise<OrganizationRecord>;
  changeTaxId(id: string, input: OrganizationChangeTaxIdInput, options?: OrganizationCommandPortOptions): Promise<OrganizationRecord>;
  setSalesChannels(id: string, input: { salesChannelIds: readonly [string, ...string[]] }, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  setRestrictions(id: string, input: OrganizationAllowListsReplace, options?: AggregateCommandOptions): Promise<OrganizationRestrictions>;
  patchRestriction(id: string, kind: OrganizationAllowListKind, patch: OrganizationAllowListPatch, options?: AggregateCommandOptions): Promise<OrganizationRestrictions>;
  setCreditInheritanceMode(id: string, input: { mode: CreditInheritanceMode }, options?: AggregateCommandOptions): Promise<OrganizationRecord>;
  assignSalesRep(id: string, input: { adminUserId: string }, options?: AggregateCommandOptions): Promise<void>;
  unassignSalesRep(id: string, input: { adminUserId: string }, options?: AggregateCommandOptions): Promise<void>;
}
```

Input types reuse the admin bodies' contract types (`adminOrganization…BodySchema` inferences) where
they exist; T019 names each and adds none the admin API does not already have.

`reject` / `block` `reason`: the admin route's free text stays where it is stored today (the
Organization row / the customer notice); the audit entry keeps recording names and codes only.

## Conversion notes (moderation)

`OrganizationModerationService.transition` (`packages/modules/organizations/src/backend/services/
organization-moderation-service.ts`) commits, then audits, then emits `organization.status_changed.v1`,
then e-mails. As a Command: the status write and the audit entry commit together; the event is the
Command's `event` (dispatched once, on commit); the customer notice runs after commit as it does today
(best effort). `handleNewlyRegistered` (auto mode) calls `approve` through the same Command with the
system actor — which is what `specs/188-policy-points/` replaces with the moderation policy.

## Owner off

`organizations` declares `activation.nonDeactivatable: true`; the gate is registered and cannot close
in practice. Contract sentence as on `organizationDetailsPort`.

## Deprecated by this port (0.113.0 → removed 0.114.0)

`organizationWritePort.{findByTaxId → organizationDetailsPort.findByTaxId, create, update}`,
`organizationCustomFieldWritePort.setCustomFieldValues`.

## Tests

- `backend/test/contract/organizations/organization-command-port.test.ts` — parity per method
  (`expectPortParity`, T015).
- `backend/test/integration/organizations/organization-command-port.worker.test.ts` — ERP-style:
  create under a parent, `setParent` of an existing branch, approve, block/unblock, under
  `withSystemScope`, no administrator; hook veto rolls back; unclaimed extension refused.
- `packages/modules/organizations/src/backend/commands/*-organization.command.test.ts` — the four
  moderation Commands (co-located, module-owned).
- delegation tests for the two deprecated ports.
