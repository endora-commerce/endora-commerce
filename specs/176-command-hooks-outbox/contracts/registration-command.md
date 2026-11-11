# Contract: registration as one Command (P1)

*Amended 2026-11-11 by the P1 implementation, against `master` after specs 175 (#987, #990), 177
(#1034, #1040) and the organizations names-only audit series (#1039, #1044). Where this contract
first said otherwise, the earlier text is listed at the end.*

## `organization.register`

- Built by `makeRegisterOrganizationCommand(deps, input)` in
  `packages/modules/organizations/src/backend/commands/register-organization.command.ts`.
- `objectType: 'organization'`, `objectId`: an organization id generated before the run
  (`randomUUID()`, as `organization.create` does).
- `input` carries the request, the normalised tax ID, the request's channel, both validated
  custom-field groups, the registry-lookup validation row computed before the run (a pure
  function of the ticket), and the prepared account creation (already hashed).
- `run(ctx)`, all on `ctx.em`, in this order:
  1. tax-id check through `TaxIdLookupService.resolveByTaxId(taxId, { em })` →
     `409 ORGANIZATION_TAX_ID_EXISTS`;
  2. insert the Organization (`pending_verification`, plus the feature-175 custom-field values) and
     flush. A refusal at the flush goes through `organizationWriteError(err, () =>
     taxIdExistsRefusal())`, which maps `global`'s `23505` and a statement-time `23P01`;
  3. channel binding through `SalesChannelMembershipPort` with `{ em }`;
  4. `await ctx.run(account.command({ organizationId, organizationRoleId }))`, where `account` came
     from `customerAccountMemberCommandPort.prepareCreate(...)` before the bus run (the hash is
     already computed). `organizationRoleId` is resolved on `ctx.em` with `predefinedRoleIdOn`;
  5. the registry-lookup validation row (`withSystemScope`, as before), when the ticket matched;
  6. the e-mail verification token;
  7. emit `customer_account.created.v1` on the module's `EventBus`. The emit is buffered in the
     bus's event scope, so it dispatches only on commit.
- `event(result)` → `organization.registered.v1`.
- The call site wraps `commandBus.run` in `runOrganizationWrite(bus, command, () =>
  taxIdExistsRefusal())`, so `per-tree-root`'s deferred `23P01`, raised at `COMMIT`, is the same
  `409 ORGANIZATION_TAX_ID_EXISTS` (`specs/177-tax-id-scope/` research R-6, R-15; held by
  `tax-id-write-paths.test.ts`).
- Audit state (`audit-state.md`, O-2): `before: null`, and the after-state `master` already
  recorded by hand since #1044, unchanged: `{ status, changedFields, registryLookup?: { provider,
  outcome }, changedCustomFields }`. `changedFields` is `presentFields(organization,
  ORGANIZATION_CREATED_FIELDS)`. `changedCustomFields` holds the keys of both groups, sorted and
  prefixed `organization.` / `firstUser.`. Every key is in the module's `ORGANIZATION_AUDIT_KEYS`.
  There is no name, tax id or address. The result carries the raw verification token to the
  caller. It is never audited.
- `hookData` / `outboxData` per `organization-hookable-actions.md` (P2/P3).

## `customer_account.create` (child)

In `packages/contracts/src/customer-accounts.ts`:

```ts
/** Container name: `customerAccountMemberCommandPort`. Owner: `customer_accounts`. */
export interface CustomerAccountMemberCommandPort {
  /** Hashes the password now, outside any transaction, and returns a builder. */
  prepareCreate(input: CustomerAccountCreatePreparation): Promise<PreparedCustomerAccountCreate>;
}
/** `CustomerAccountCreateInput` without the two ids a caller may only know inside its transaction. */
export type CustomerAccountCreatePreparation = Omit<CustomerAccountCreateInput, 'organizationId' | 'organizationRoleId'>;
export interface PreparedCustomerAccountCreate {
  command(target: { organizationId: string; organizationRoleId: string }): CustomerAccountCreateCommand;
}
export interface CustomerAccountCreateCommand {           // structural, like CustomerAccountRoleChangeCommand
  readonly action: string; readonly objectType: string; readonly objectId: string;
  run(ctx: never): Promise<{ readonly result: CustomerAccountRecord }>;
}
```

- The preparation and the Command are split because a registration learns its *Administrator*
  role id only from the row its Organization's insert trigger wrote, inside the transaction, while
  the hash must run before the transaction opens (FR-005).
- `action: 'customer_account.create'`, `objectType: 'customer_account'`, `objectId`: the account id
  generated when the Command is built. This keeps the action name and object the port audited
  before, so audit history stays continuous. The audit state is `accountCreatedAuditState`, the
  `customer_accounts` names-only allowlist from #1016.
- `409 EMAIL_ALREADY_REGISTERED` comes from the pre-check and from the unique index, inside `run`.
- `CustomerAccountMemberWritePort.create` becomes `commandBus.run(prepared.command(...))`. Its
  contract is unchanged and its hand-written `#audit` call for the creation is removed.
- The type-level assignability check (both ways against the platform's
  `Command<CustomerAccountRecord>`) lives in
  `customer_accounts/src/backend/commands/customer-account-create.command.test.ts`, because
  `@endora-commerce/contracts` depends on no platform code.

## `RegistrationService.registerOrganization` after P1

```text
validateCountry
→ fast pre-checks: tax ID (resolveByTaxId), then e-mail (findByEmail)  // the order the endpoint answered in
→ readRegistryTicket → validateCustomFieldGroups (#987) → lookupRow (pure)
→ account = await accounts.commands.prepareCreate(...)                 // hash here
→ result = await runOrganizationWrite(commandBus, makeRegisterOrganizationCommand(...), taxIdExistsRefusal)
→ deleteTicket (best effort)
→ return { organization, customerAccount, verificationToken }
```

`RegistrationService` takes one options object (`emFactory`, `commandBus`, `events`,
`accounts: { read, commands }`, and the optional `dictionaryValidator`, `channelMembership`,
`registryLookup` and `customFieldValues`). It no longer takes an audit port and records nothing by
hand. The route `POST /api/v1/organizations/register` is unchanged.

## Port edge

`organizations` resolves `lazyPort<CustomerAccountMemberCommandPort>(ctx,
'customerAccountMemberCommandPort')`. The edge goes in the manifest's acknowledged port edges,
exactly as `customerAccountMemberWritePort` is. A `dependencies` entry would close the cycle the
manifest comment describes. `backend/test/unit/_lifecycle/gating-graph.test.ts` lists it.

## What this contract said before the 2026-11-11 amendment

- The port method was `create(input): Promise<CustomerAccountCreateCommand>`. It could not be built
  as written, because `organizationRoleId` is part of the input and is known only inside the
  transaction.
- The after-state was `{ status, vatStatus, salesChannelId, registryLookup | null, customFieldKeys:
  { organization, customer } }`. `master` has recorded a names-only state for this action since
  #1044 (`changedFields`, `changedCustomFields`), so that state is kept for continuity.
- The tax-ID and e-mail pre-checks moved entirely inside the Command (research R-3). They now also
  stay outside, as fast pre-checks. This keeps the order of the codes the endpoint answers when a
  request has several faults (FR-008), and it answers the common duplicate before the password is
  hashed. The Command checks the tax ID again on its own transaction, and the constraints and the
  unique index answer the race.
