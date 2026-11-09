# Contract — registration values and admin-create parity

Normative for FR-015 – FR-028.

## 1. Registration request (`packages/contracts/src/organizations.ts:187`)

```ts
registerOrganizationRequestSchema = z.object({
  organization: z.object({
    /* …unchanged… */
    customFieldValues: customFieldValuesSchema.optional(),   // NEW — entity type `organization`
  }),
  firstUser: z.object({
    /* …unchanged… */
    customFieldValues: customFieldValuesSchema.optional(),   // NEW — entity type `customer`
  }),
  acceptedTermsVersion: z.string(),
  registryLookupId: registryLookupIdSchema.optional(),
});
```

`AdminOrganizationCreateBodySchema` (`:977`) inherits `customFieldValues` through its derivation from
`organization` — intended (OD-7). **The routes validate differently** (FR-023):

| Route | Validator |
| --- | --- |
| `POST /api/v1/organizations/register` | `validateForCustomerInput(type, values, 'organization.register')` for each group |
| `POST /api/v1/admin/organizations` | `validateAndMerge('organization', {}, values)` |

## 2. Registration processing order (`RegistrationService.registerOrganization`)

1. country check; tax-ID and e-mail pre-checks (unchanged);
2. registry ticket read (feature 173, unchanged);
3. **validate both groups; merge refusals; throw before any write** (FR-024);
4. create Organization **with** `customFieldValues` (FR-025);
5. channel binding (unchanged);
6. `accounts.write.create({ …, customFieldValues })` (FR-025);
7. lookup row, token, audit `organization.register` with
   `customFieldKeys: { organization: string[], customer: string[] }`, never values (FR-028).

## 3. Registration refusal

`422 CUSTOM_FIELD_VALUE_INVALID`; `details` entries with `field` prefixed by group:

```json
{ "error": { "code": "CUSTOM_FIELD_VALUE_INVALID", "details": [
  { "field": "organization.acquisition_source", "code": "missing_required", "message": "…" },
  { "field": "firstUser.credit_limit_override", "code": "not_open_for_input", "message": "…" }
] } }
```

A request with values and no composed value port: every key `not_open_for_input` (FR-027). A
request with no values behaves exactly as before (FR-026).

## 4. `CustomerAccountCreateInput` (`packages/contracts/src/customer-accounts.ts:273`)

```ts
/**
 * Feature 175 — the account's custom-field values, ALREADY VALIDATED by the
 * caller through custom_fields' value port (the caller owns the surface and
 * must validate before its first write). Stored as given; `{}` when absent.
 */
customFieldValues?: Record<string, unknown>;
```

## 5. Admin create bodies (FR-016 – FR-019)

Each gains `customFieldValues: customFieldValuesSchema.optional()`; the host validates with
`validateAndMerge(<type>, {}, values)` **inside its create Command**, assigns the bag to the row
before the flush, and the Command's audit row carries it (FR-021). A refusal rolls the Command back
(nothing created) and answers the existing per-field 422.

| Schema | File:line | Entity type | Host |
| --- | --- | --- | --- |
| `createCategoryRequestSchema` | `catalog.ts:1365` | `category` | `catalog` |
| `adminCreateOrderRequestSchema` | `orders.ts:732` | `order` | `orders` |
| `AdminOrganizationCreateBodySchema` | `organizations.ts:977` (derived) | `organization` | `organizations` |
| `adminDirectMemberToRoleRequestSchema` | `organization-roles.ts:177` (`.strict()`) | `customer` | `organizations` → `customer_accounts` |
| `adminCreateQuoteRequestSchema` | `quote-requests.ts:622` | `quote_request` | `quote_requests` |

The update paths are unchanged (all already accept values — spec Context table).

## 6. Bump

`@endora-commerce/contracts` **minor** (new optional request fields, new exports, new enum members on
an error code — a consumer exhaustively switching on the code enum gets a compile error, which is the
intended signal in a 0.x minor).
