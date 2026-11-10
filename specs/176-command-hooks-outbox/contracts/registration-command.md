# Contract: registration as one Command (P1)

## `organization.register`

- Built by `makeRegisterOrganizationCommand(deps, input)` in
  `packages/modules/organizations/src/backend/commands/register-organization.command.ts`.
- `objectType: 'organization'`, `objectId`: an organization id generated before the run
  (`randomUUID()`, as `organization.create` does).
- `run(ctx)`, all on `ctx.em`, in this order:
  1. tax-id pre-check → `409 ORGANIZATION_TAX_ID_EXISTS`;
  2. insert the Organization (`pending_verification`, plus the #987 custom-field values) and flush.
     `UniqueConstraintViolationException` → `409 ORGANIZATION_TAX_ID_EXISTS`. This catch is the one
     place 177 extends for `23P01`;
  3. channel binding through `SalesChannelMembershipPort` with `{ em }`;
  4. `await ctx.run(accountCommand)`, where `accountCommand` comes from
     `customerAccountMemberCommandPort.create(...)` and was prepared before the bus run (the hash is
     already computed). `organizationRoleId` is resolved on `ctx.em` with `predefinedRoleIdOn`;
  5. the registry-lookup validation row (`withSystemScope`, as today), when the ticket matches;
  6. the e-mail verification token;
  7. emit `customer_account.created.v1` on the module's `EventBus`. The emit is buffered, so it
     dispatches only on commit.
- `event(result)` → `organization.registered.v1`.
- Audit state (`audit-state.md`): `before: null`, and this after-state:
  `{ status, vatStatus, salesChannelId, registryLookup: { provider, outcome } | null,
  customFieldKeys: { organization: string[], customer: string[] } }`. There is no name, tax id or
  address. The result carries the raw verification token to the caller. It is never audited.
- `hookData` / `outboxData` per `organization-hookable-actions.md` (P2/P3).

## `customer_account.create` (child)

- New contract in `packages/contracts/src/customer-accounts.ts`:

```ts
/** Container name: `customerAccountMemberCommandPort`. Owner: `customer_accounts`. */
export interface CustomerAccountMemberCommandPort {
  /** Hashes the password now, outside any transaction, and returns the Command to run
   *  (top-level via commandBus.run, or as a child via ctx.run). */
  create(input: CustomerAccountCreateInput): Promise<CustomerAccountCreateCommand>;
}
export interface CustomerAccountCreateCommand {           // structural, like CustomerAccountRoleChangeCommand
  readonly action: string; readonly objectType: string; readonly objectId: string;
  run(ctx: never): Promise<{ readonly result: CustomerAccountRecord }>;
}
```

- `action: 'customer_account.create'` keeps the action name the port audits today, so audit history
  stays continuous. Audit state follows `audit-state.md` and #1016's `customer_accounts` allowlist.
- `409 EMAIL_ALREADY_REGISTERED` comes from the pre-check and from the unique index, inside `run`.
- `CustomerAccountMemberWritePort.create` becomes `commandBus.run(await commandPort.create(input))`.
  Its contract is unchanged and its hand-written `#audit` call is removed.

## `RegistrationService.registerOrganization` after P1

```text
validateCountry → validateCustomFieldGroups (#987) → readRegistryTicket
→ accountCommand = await accounts.commands.create(...)      // hash here
→ result = await commandBus.run(makeRegisterOrganizationCommand(...))
→ deleteTicket (best effort)
→ return { organization, customerAccount, verificationToken }
```

The route `POST /api/v1/organizations/register` is unchanged.

## Port edge

`organizations` resolves `lazyPort<CustomerAccountMemberCommandPort>(ctx,
'customerAccountMemberCommandPort')`. The edge goes in `nonBindingDependencies` /
acknowledged edges exactly as `customerAccountMemberWritePort` is today. A
`dependencies` entry would close the cycle the manifest comment describes.
