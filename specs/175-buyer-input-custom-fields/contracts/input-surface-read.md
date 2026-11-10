# Contract — public read of the fields open on an input surface

Normative for FR-029, FR-030, FR-033, FR-034. Owner: `custom_fields`
(`packages/modules/custom_fields/src/backend/routes.public.ts`, new). Schema:
`packages/contracts/src/custom-fields.ts`.

## Request

`GET /api/v1/custom-fields/input-surfaces/:surface`

- Anonymous. `config: { salesChannelAccess: 'open' }` — reachable on a store closed to anonymous
  visitors, because registration is (feature 154).
- Channel-independent: no channel-scoped data is read (Principle XII does not apply; definitions are
  platform-global).
- Language: `Accept-Language` through `request.responseLanguage()`.

## Response `200`

```ts
export const inputSurfaceFieldSchema = z.object({
  key: z.string(),
  valueType: customFieldValueTypeSchema.exclude(['page_builder']),
  required: z.boolean(),
  label: z.string(),                        // resolved: label[lang] ?? labelDefault
  options: z.array(z.object({ value: z.string(), label: z.string() })), // [] unless select/multiselect
  sortOrder: z.number().int(),
});
export const inputSurfaceFieldsResponseSchema = z.object({
  data: z.object({
    surface: z.string(),
    entities: z.record(supportedEntityTypeSchema, z.array(inputSurfaceFieldSchema)),
  }),
});
```

- Only live definitions whose `customerInput` contains `:surface`; per entity type in `sortOrder`.
- Never answers a stored value, `audience`, `adminAccess`, `config` or an internal field.
- An unknown or undeclared surface → `200` with `entities: {}` (not 404: the storefront treats both
  the same, and a 404 would reveal nothing useful).

Example (`Accept-Language: pl`):

```json
{ "data": { "surface": "organization.register", "entities": {
  "organization": [{ "key": "acquisition_source", "valueType": "select", "required": true,
    "label": "Skąd o nas wiesz?", "sortOrder": 10,
    "options": [{ "value": "trade_fair", "label": "Targi" }, { "value": "web", "label": "Internet" }] }],
  "customer": [{ "key": "phone", "valueType": "text", "required": false, "label": "Telefon",
    "sortOrder": 20, "options": [] }] } } }
```

## Caching

- Backend: answered from the per-entity definitions cache (no query per request in the steady state).
- Storefront: `revalidate: 300`, tag `custom-fields:input-surface:<surface>`. `custom_fields`
  revalidates the tag through `StorefrontRevalidator` after any definition or option change of an
  entity type that declares a surface (after the Command commits, beside `publishInvalidate`).
- Storefront failure of any kind (network, 404 because `custom_fields` is not composed, schema
  mismatch) → no extra fields, page renders (FR-033).

## For storefronts scaffolded before feature 175 (OD-9, FR-034)

The `organizations` module documentation carries, in English and Polish: this read, the two
registration groups (`contracts/registration-and-admin-create.md` §1) and the refusal shape (§3 there),
with a minimal Server Component example. That page is the whole adoption path — no package
component.
