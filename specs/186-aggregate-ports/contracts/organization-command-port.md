# Contract: `organizationCommandPort` (Organization, #1821)

Owner `organizations` (non-deactivatable). Declared in `packages/contracts/src/organizations.ts`,
widening the existing interface (line 943) in place. Lands first (US1); `approve` first within it,
because `specs/188-policy-points/` approves through it.

## Operations

Readiness codes: research R-2, **as measured by the T001 inventory** (2026-11-25, `origin/master`
at `d97b9dd0a`). "Route" is the admin route for the operation; "Side effects" is everything the route
or the service it calls does outside the write itself, which the port call must reach too (FR-013).
File references are relative to `packages/modules/organizations/src/backend/` unless they say
otherwise.

| Method | Command action (kept) | Admin route | Readiness | Side effects outside the write | Work |
| --- | --- | --- | --- | --- | --- |
| `create(input, options?)` | `organization.create` (`commands/create-organization.command.ts`) | `POST /api/v1/admin/organizations` | C | none after commit. The channel binding runs **inside** the Command, through the kernel membership writer on the Command's `em` (see *Sales channels* below for what that writer does outside the transaction) | port only |
| `update(id, patch, options?)` | `organization.update` (`commands/update-organization.command.ts`) | none — reached only through `organizationWritePort.update` | C | none | port only; parity is against `organizationWritePort.update` (T025), there is no route to compare with |
| `setParent(id, { parentId }, options?)` | `organization.set_parent` (first assign, detach) / `organization.move` (re-parent) (`commands/set-parent.command.ts`, `move.command.ts`) | `POST …/:id/parent` | C | none | one method: the route chooses the action by whether the row has a parent. The route accepts `parentId: null` (detach to a root, recorded as `set_parent`); the interface below types `parentId: string` only — see *Inventory findings* 3 |
| `approve(id, options?)` | `organization.approved` | `POST …/:id/approve` | H-post | the customer notice (`organization_approved` template, English fallback), best effort, after commit; `organization.status_changed.v1` emitted after the audit | convert (T026) |
| `reject(id, { reason }, options?)` | `organization.rejected` | `POST …/:id/reject` | H-post | the customer notice (`organization_rejected`), unless the body's `notifyCustomerEmail` is `false`; the event | convert (T026) |
| `block(id, { reason }, options?)` | `organization.blocked` | `POST …/:id/block` | H-post | the event; no notice | convert (T026) |
| `unblock(id, options?)` | `organization.unblocked` | `POST …/:id/unblock` | H-post | the event; no notice | convert (T026) |
| `delete(id, options?)` | `organization.delete` (`commands/delete-organization.command.ts`) | `DELETE …/:id` | C | none | port only |
| `setCustomFieldValues(id, merge, options?)` | `organization.set_custom_field_values` (`commands/set-custom-field-values.command.ts`) | none runs this action — `PATCH …/:id` runs `organization.admin_patch` (`commands/admin-patch-organization.command.ts`), which merges the values *and* the column changes in one Command | C | none | port only; parity is against `organizationCustomFieldWritePort.setCustomFieldValues` (T025) — see *Inventory findings* 2 |
| `convertToCompany(id, input, options?)` | `organization.convert_to_company` | `POST …/:id/convert-to-company` | C | the role cache dropped and announced after commit (`roleCache.dropAndAnnounce`) — the existing port already does it; the optional VAT validation is the route's (`validateTaxId`), not the operation's (D-290 / OD-2) | unchanged |
| `changeTaxId(id, input, options?)` | `organization.tax_id.change` | `POST …/:id/change-tax-id` | C | none; the optional VAT validation is the route's, as above | unchanged |
| `setSalesChannels(id, { salesChannelIds }, options?)` | `organization.sales_channels.set` (new) | `PUT …/:id/sales-channels` | **H-post, not a Command** (measured; was `?`) | written by the **kernel's** `SalesChannelMembershipService.replaceChannelsForEntity` (`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`, resolved as `salesChannelMembershipPort`), not by the `sales_channels` module: the delete-and-insert runs in its own transaction, then — outside it — the Organization access cache is dropped and announced (`invalidateAfterWrite`), then one `sales_channel.membership.changed` entry per membership added or removed (object type `sales_channel_membership`, `AuditPort.record`, its own fork), then one `sales_channels.membership_changed` event per membership. The same set again is a no-op: nothing written, audited or emitted | convert (T028) — see *Inventory findings* 1 |
| `setRestrictions(id, allowLists, options?)` | `organization.allow_lists_replace` | `PUT …/:id/restrictions` | H-in (`services/organization-restriction-service.ts`, `recordAuditFromContext` inside `em.transactional`) | none: the service's header says storefront cache invalidation was "layered on top by US4", and nothing on this path does it today | convert (T027) |
| `patchRestriction(id, kind, patch, options?)` | `organization.allow_list_patch` | the three `PATCH` routes `patchRoute(url, kind)` registers, `kind` ∈ `payment_method` \| `delivery_method` \| `warehouse` | H-in (same service) | none | convert (T027) |
| `setCreditInheritanceMode(id, { mode }, options?)` | `organization.set_credit_mode` (`commands/set-credit-mode.command.ts`) | `PUT …/:id/credit-inheritance-mode` | C | none | port only |
| `assignSalesRep(id, { adminUserId }, options?)` | `organization.sales_rep_assign` | `POST …/:organizationId/sales-reps` (`routes.sales-reps.ts`) | **H-in, not C** (measured): `services/sales-rep-assignment-service.ts` `assign` persists the row and calls `recordAuditFromContext` on one unit of work, then flushes; idempotent (an existing assignment answers the row, audits nothing) | none | **convert** (was "port only") |
| `unassignSalesRep(id, { adminUserId }, options?)` | `organization.sales_rep_unassign` | `DELETE …/sales-reps/:adminUserId` (`routes.sales-reps.ts`) | **H-in, not C** (measured): same service, `unassign` | none | **convert** (was "port only") |

### Inventory findings (T001)

1. **Sales channels.** The write is the kernel's membership writer, and it is not transactional with
   its own audit: `replaceChannelsForEntity` commits its statements (on the caller's `em` when one is
   passed — `organization.create` passes the Command's), then writes each membership entry through
   `AuditPort.record`, which forks and commits on its own, and drops the access cache before the
   caller has committed. So today, on `organization.create`, a create that rolls back after the bind
   leaves committed `sales_channel.membership.changed` entries behind, and the access cache is
   dropped for an Organization whose new set is not yet visible (a read in between re-caches the old
   set). T028 must therefore choose where the membership entries go when the write becomes
   `organization.sales_channels.set`: kept as they are beside the new entry (two records of one
   change under two object types — the double record `specs/154-sales-channel-access/` research R-10
   avoided by not wrapping), or the new entry alone. Either way the cache drop has to move after the
   Command's commit. **Owner question** (recorded in research R-2): it changes what the kernel writer
   records, which is `packages/platform`'s, not this module's.
2. **Custom-field values.** No admin route runs `organization.set_custom_field_values`; the admin
   `PATCH …/:id` runs `organization.admin_patch`, one Command for the column changes and the bag
   (issue #470 O-2). The port keeps `set_custom_field_values` (what `organizationCustomFieldWritePort`
   runs, and what is declared hookable), so its parity is measured against the deprecated port, not
   a route. `organization.admin_patch` stays the route's and is not on the port: `update` covers the
   columns and `setCustomFieldValues` the bag.
3. **Detach.** `POST …/:id/parent` with `parentId: null` detaches an Organization to a root
   (`organization.set_parent`). The interface types `setParent(id, { parentId: string })`. T019 either
   widens it to `string | null` (one method for "place in the tree", as R-9 argues for `move`) or the
   contract adds "detach is not offered" to the *Not offered* paragraph.
4. **Reject reason.** The route requires a reason (`reason: z.string().min(1).max(2000)`,
   `schemas/organization.ts`) and the service refuses an empty one; block's is optional and nullable.
   The interface types both as `string | null`. `reject` should take `{ reason: string }`, and the
   route's `notifyCustomerEmail` (default `true`) needs a decision: not on the port (the notice always
   goes) or an input member.
5. **`expectedVersion`.** Every moderation and restriction route **requires** the Organization's
   `version` and answers `409 VERSION_CONFLICT` with `currentVersion`; `organization.update` honours
   an optional one; create, set parent, delete, credit mode, sales reps, sales channels and the
   custom-field write check none. On the port it is optional throughout (`AggregateCommandOptions`):
   absent, the moderation and restriction Commands write over whatever version they read.
6. **Refusal codes.** The admin create answers an unknown channel `422 VALIDATION_FAILED`; the
   deprecated `organizationWritePort.create` answers `422 UNKNOWN_SALES_CHANNEL`
   (`services/organization-write-guards.ts`). The port's `create` keeps the deprecated port's code
   (what server-side callers branch on today), so `create` parity compares everything but that code.
7. **Gates the port does not carry.** Set parent, create under a parent, credit mode and both sales-rep
   routes refuse a scoped administrator (`403`, D-260), and those are the write routes that carry no
   `organizationInReach`; every other `/:id` write route carries it. Both are the caller's gate
   (FR-009) and are not on the port.

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
