# Contract: personal → company conversion

Normative for FR-030 … FR-042. Owner: `organizations`.

## 1. Command `organization.convert_to_company`

- **Factory**: `makeConvertToCompanyCommand(deps, { organizationId, input })` in
  `organizations/src/backend/commands/convert-to-company.command.ts`.
- **deps**: `{ accounts: Pick<CustomerAccountReadPort, 'listByOrganization'>, taxIdScope: TaxIdScopeService, lookups: TaxIdLookupService }`.
- **objectType / objectId**: `organization` / the organization id (unchanged by the conversion).
- **Steps** (one transaction, research R-11):
  1. `select … for update` the row; not found / out of reach → `404 NOT_FOUND`.
  2. `isPersonal = false` → `409 ORGANIZATION_CONVERSION_REFUSED` `{ code: 'not_personal' }`;
     `deletedAt` set or fully scrubbed → `{ code: 'deleted' }`.
  3. Normalised tax ID X; scope read in-transaction; pre-check (tax-id-scope §5) →
     `409 ORGANIZATION_TAX_ID_EXISTS`.
  4. Predefined roles ensured (`insert … on conflict do nothing`); live members read; a member whose
     `organizationRoleId` is not the administrator role → `409 ORGANIZATION_CONVERSION_REFUSED`
     `{ code: 'owner_not_administrator' }`.
  5. Write: `isPersonal=false`, `taxId=X`, `name`, `legalName`, `registeredAddress`, `vatStatus`,
     `personalAccountId=null`, `convertedToCompanyAt=now`, approval stamp when `approvedAt` is null.
  6. `flush` inside a `taxIdConflictOf` catch; outcome `{ result, before, after }` per data-model §7.
  7. `event(result)` → `organization.converted_to_company.v1`.

## 2. Input

```ts
export const adminOrganizationConvertToCompanyBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  legalName: z.string().trim().min(1).max(255).optional(),
  taxId: taxIdSchema,                      // the admin boundary's normalising transform
  registeredAddress: z.object({
    street: z.string().min(1).max(255),
    city: z.string().min(1).max(120),
    postalCode: z.string().min(1).max(20),
    country: z.string().length(2),        // validated against the dictionary like admin create
  }),
  vatStatus: vatStatusSchema.default('vat_payer'),
  validateTaxId: z.boolean().default(false),   // route-only; not passed to the port's Command
});
export type OrganizationConvertToCompanyInput =
  Omit<z.infer<typeof adminOrganizationConvertToCompanyBodySchema>, 'validateTaxId'>;
```

## 3. Admin route

`POST /api/v1/admin/organizations/:id/convert-to-company`

- `preHandler: [requireAdmin('organizations:convert-to-company'), organizationInReach]` — the gate as
  `preHandler`, never inside the handler (`module-admin-surfaces.md` item 3).
- Runs the Command through `runOrganizationWrite` (commit-time `23P01`/`23505` → 409).
- After commit: `OrganizationRoleCache.dropAndAnnounce(id)`; when `validateTaxId`,
  `taxIdValidationService.triggerValidation(id, { actorAdminUserId, providerHint: 'auto' })`, its
  failure caught and reported, never rethrown.
- `200 { data: <serializeOrg>, vatValidation: { outcome, provider } | null }`.
- Errors: `404`, `409 ORGANIZATION_CONVERSION_REFUSED` (`not_personal` | `deleted` |
  `owner_not_administrator`), `409 ORGANIZATION_TAX_ID_EXISTS`, `422 VALIDATION_FAILED`.

## 4. Published port `organizationCommandPort`

```ts
/** Container name: `organizationCommandPort`. Owner: `organizations`. Server-side writes on the Organization aggregate. */
export interface OrganizationCommandPort {
  /**
   * Runs `organization.convert_to_company` as one Command with the ambient actor (an admin inside an
   * admin request; system under `withSystemScope` in a worker). For admin routes and server code
   * (an ERP import) — never for a customer-facing route. No VAT validation: trigger one yourself
   * after it resolves if you need it.
   */
  convertToCompany(organizationId: string, input: OrganizationConvertToCompanyInput): Promise<OrganizationRecord>;
}
```

Implementation `OrganizationCommandService(commandBus, deps)` in
`services/organization-command-port.ts`, registered with `ctx.di.providePort` beside
`organizationCustomFieldWritePort` (PR #990) when that has landed. Off-state: the port machinery's
`503 MODULE_DISABLED` (unreachable: `organizations` is non-deactivatable).

## 5. Never from a customer route (FR-031)

`backend/test/contract/organizations/convert-to-company-not-customer-reachable.contract.test.ts`:

1. Boot the composed app with a recording Command Bus decorator.
2. For every registered route whose URL does not start with `/api/v1/admin/`, inject one request per
   method with a customer session and with none, body `{}` and a plausible organization id.
3. Assert no Command with action `organization.convert_to_company` was recorded, and that no
   non-admin URL contains `convert`.

Plus a unit check over the source: no `routes.(customer|public|storefront|members|roles).ts` in
`organizations`, and nothing under `storefront/`, references `convertToCompany` or
`makeConvertToCompanyCommand`.

## 6. Consumers

`returns` (`return-case-service.ts` `isConsumerWithdrawal`, l. 420–440): an organization counts as a
consumer for an order when `isPersonal === true` **or** `convertedToCompanyAt` is set and the order
was placed before it. `OrderReturnContext` (`contracts/src/returns.ts`, the interface holding
`completingStatusEnteredAt`) gains `placedAt: Date` from returns' existing order read. No subscriber.
Everything else: research R-12.

## 7. No reverse

No `organization.convert_to_personal`, no route, no port method. A test asserts the manifest's and the
route table's absence of any such action.
