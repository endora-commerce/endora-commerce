# Data model — feature 175

One migration, owned by `custom_fields`. No host table changes: every host already stores its bag
in `custom_field_values` (or `attribute_values` for `product`, untouched). No tenant-scope change
(Principle XI): `custom_field_definitions` is platform-global, values stay on host rows and inherit
the host's scope.

## 1. `CustomFieldDefinition` (extended) — `custom_field_definitions`

Entity: `packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.ts`.

| Property | Column | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `customerInput` | `customer_input` | `jsonb` (`CustomFieldInputSurface[]`) | `'[]'::jsonb` | Surfaces the value may be supplied on by a buyer (FR-001). Added to the entity's `OptionalProps`. |
| `adminAccess` | `admin_access` | `varchar(16)` (`'edit' \| 'read' \| 'hidden'`) | `'edit'` | Admin-panel affordance only (FR-005, FR-007). Added to `OptionalProps`. |

**Invariants** (checked on the resulting definition at create, update and every `apply*`; R-4):

1. every element of `customerInput` ∈ `customerInputSurfacesOf(entityType)` — else `customer_input_unsupported`;
2. `customerInput ≠ []` ⇒ `audience = 'customer'` — else `customer_input_audience`;
3. `customerInput ≠ []` ⇒ `valueType ≠ 'page_builder'` — else `customer_input_value_type`;
4. `required` ⇒ `adminAccess = 'edit'` — else `admin_access_required` (SD-2);
5. `customerInput` holds no duplicates (normalised on write: deduplicated, sorted).

No state machine. Changing either attribute is an ordinary definition update through the existing
Command (audited, Principle XIII) followed by `publishInvalidate(entityType)` on
`b2b:custom_fields:definitions-changed` (`custom-field-definitions-cache.ts:6`) and, for an entity
type that declares a surface, a storefront tag revalidation (R-7).

### Migration

Scaffold: `pnpm --filter backend run migration:new -- --module custom_fields --name definition_customer_input_admin_access`
(timestamped by the tool; class `Migration<STAMP>CustomFieldsDefinitionCustomerInputAdminAccess`),
then `composer:generate` and commit `backend/src/db/migrations-registry.generated.ts`.

```sql
-- up
alter table "custom_field_definitions" add column "customer_input" jsonb not null default '[]'::jsonb;
alter table "custom_field_definitions" add column "admin_access" varchar(16) not null default 'edit';
-- down
alter table "custom_field_definitions" drop column "admin_access";
alter table "custom_field_definitions" drop column "customer_input";
```

Same-module table, no foreign key, no cross-module SQL (module-migrations items 4 / 4a do not
apply). Existing rows read `[]` / `edit` — no backfill. Existing required definitions are `edit`,
so invariant 4 holds for every existing row.

## 2. Supported-entity registry (extended) — code, not a table

`SupportedEntityMeta` (`custom-field-registry.ts:18`) gains:

```ts
/** Feature 175 — the buyer input surfaces definitions of this type may be opened on. */
readonly customerInputSurfaces?: readonly CustomFieldInputSurface[];
```

`organization` and `customer` get `['organization.register']`. Helper:
`customerInputSurfacesOf(entityType): readonly CustomFieldInputSurface[]`.

## 3. Input surface — contract vocabulary

`customFieldInputSurfaceSchema = z.enum(['organization.register'])` in
`packages/contracts/src/custom-fields.ts`. One surface; the owner of the write path is
`organizations` (`POST /api/v1/organizations/register`).

## 4. Host rows — unchanged columns, new write paths

| Entity type | Row | New write path in this feature |
| --- | --- | --- |
| `organization` | `organizations.custom_field_values` | registration (buyer), admin create |
| `customer` | `customer_accounts.custom_field_values` | registration (buyer), admin member direct-create; **cleared** on anonymisation |
| `category` | `categories.custom_field_values` | admin create |
| `order` | `orders.custom_field_values` | admin create on behalf |
| `quote_request` | `quote_requests.custom_field_values` | admin create on behalf |
| `opportunity`, `project`, `task` | unchanged | — (already complete) |
| `product` | `products.attribute_values` | — (host-managed, exempt) |

`CustomerAccountCreateInput` (`packages/contracts/src/customer-accounts.ts:273`) gains
`customFieldValues?: Record<string, unknown>` — a bag **already validated** by the caller through
`custom_fields`' port; `customer_accounts` stores it as given (default `{}`).

## 5. Admin write declaration — code, not a table (R-11)

`CustomFieldWriteDeclaration` (contracts) — exported per host as `customFieldWrites` beside its
manifest, read as literal AST:

```ts
type CustomFieldWriteDeclaration =
  | { entityType: SupportedEntityType; kind: 'create' | 'update' | 'values';
      method: 'POST' | 'PATCH' | 'PUT'; path: string; body: string /* contracts export name */ }
  | { entityType: SupportedEntityType; kind: 'create' | 'update'; exempt: string /* non-empty reason */ }
  | { entityType: SupportedEntityType; kind: 'buyer-input'; surface: CustomFieldInputSurface;
      method: 'POST'; path: string; body: string; at: string /* dotted path to the values */; test: string };
```

Initial declarations:

| Module | Declarations |
| --- | --- |
| `catalog` | category create `POST /api/v1/admin/catalog/categories` `createCategoryRequestSchema`; category update `PATCH …/:id` `updateCategoryRequestSchema`; product create/update **exempt** ("host-managed: values are catalog attribute values written by the catalog's attribute surfaces") |
| `orders` | order create `POST /api/v1/admin/orders` `adminCreateOrderRequestSchema`; order values `PATCH …/orders/:id/custom-fields` `customFieldValuesSchema` |
| `organizations` | organization create `POST /api/v1/admin/organizations` `AdminOrganizationCreateBodySchema`; organization update `PATCH …/:id` `adminPatchOrganizationRequestSchema`; customer create `POST …/organizations/:id/members` `adminDirectMemberToRoleRequestSchema`; invitation **exempt** ("creates no account; the invited person creates it on acceptance, a buyer action"); buyer-input × 2 (`organization`, `customer`) on `organization.register` |
| `customers` | customer values `PATCH /api/v1/admin/customers/:id/custom-fields` `customFieldValuesSchema` |
| `quote_requests` | create `POST /api/v1/admin/quote-requests` `adminCreateQuoteRequestSchema`; update `PATCH …/:id` `adminPatchQuoteRequestSchema` |
| `crm` | create / update `CreateOpportunityRequestSchema` / `UpdateOpportunityRequestSchema` |
| `projects` | create / update `CreateProjectBodySchema` / `UpdateProjectBodySchema` |
| `tasks` | create / update `CreateTaskBodySchema` / `UpdateTaskBodySchema` |

## 6. Wire shapes (summary — full text in `contracts/`)

- Definition record / create / update gain `customerInput` and `adminAccess`.
- Validation error codes gain `not_open_for_input`, `too_many_keys`.
- Registration request: `organization.customFieldValues?`, `firstUser.customFieldValues?`.
- Five admin create bodies gain `customFieldValues?`.
- Public read: `InputSurfaceFieldsResponse`.
- Audit: `organization.register` gains `customFieldKeys`.
