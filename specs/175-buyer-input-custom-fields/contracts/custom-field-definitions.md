# Contract — custom-field definitions (`@endora-commerce/contracts`, `custom_fields`)

Normative for FR-001 – FR-009, FR-014, FR-035, FR-036. File: `packages/contracts/src/custom-fields.ts`.

## 1. New vocabulary

```ts
export const customFieldInputSurfaceSchema = z.enum(['organization.register']);
export type CustomFieldInputSurface = z.infer<typeof customFieldInputSurfaceSchema>;

export const customFieldAdminAccessSchema = z.enum(['edit', 'read', 'hidden']);
export type CustomFieldAdminAccess = z.infer<typeof customFieldAdminAccessSchema>;
```

## 2. Definition shapes (additive)

| Schema (line on `fe8b10ccb`) | Change |
| --- | --- |
| `customFieldDefinitionSchema` (`:121`) | `+ customerInput: z.array(customFieldInputSurfaceSchema)`, `+ adminAccess: customFieldAdminAccessSchema` |
| `createCustomFieldDefinitionSchema` (`:150`) | `+ customerInput: …default([])`, `+ adminAccess: …default('edit')` |
| `updateCustomFieldDefinitionSchema` (`:165`) | both `.optional()` (absent = unchanged, as `listFilter` / `carryTo`) |
| `customFieldEntityTypeInfoSchema` (`:188`) | `+ customerInputSurfaces: z.array(customFieldInputSurfaceSchema).default([])` — what the admin form reads to decide whether to offer the option (FR-035) |
| `CustomFieldDefinitionRecord` (`:515` interface) and the `apply*` seam's input | both properties |

Additive for every reader: a response carrying two new keys parses under the old schema. A writer
that omits them gets the defaults. **Bump: `minor`** (0.x series, new exports).

## 3. Definition refusals

`422 CUSTOM_FIELD_DEFINITION_INVALID`, `details.reason` one of the existing reasons or:

| `details.reason` | When | en sentence (pl in the bundle) |
| --- | --- | --- |
| `customer_input_unsupported` | a surface the entity type does not offer | "This field cannot be collected from buyers on that form." |
| `customer_input_audience` | input on and audience `internal`, either order of change | "A field collected from buyers must be visible to customers." |
| `customer_input_value_type` | input on and value type `page_builder` | "A Page Builder field cannot be collected from buyers." |
| `admin_access_required` | `required` with access `read` / `hidden` | "A required field must stay editable in the admin." |

`details` carries `{ reason, key }` and no token beyond `key`; the manifest's error-code entry
declares the tokens per `check:error-translations`.

## 4. Value validation error codes

`customFieldValidationErrorSchema.code` (`:213`) gains:

- `not_open_for_input` — the key is not a live definition open on the surface (also every key when
  the value port is not composed);
- `too_many_keys` — more than 50 keys in one group; `field` is the group name (`organization`,
  `firstUser`), not a key.

The envelope is unchanged: `422 CUSTOM_FIELD_VALUE_INVALID`, `details` the array of entries.

## 5. Value port (`CustomFieldValuePort`, `:639`)

```ts
/**
 * Feature 175 — values a BUYER supplies on a declared input surface, for a record
 * being created. Refuses (never drops) any key not open on `surface`; enforces
 * `required` only among open definitions; text ≤ 1 000 chars after trimming,
 * whitespace-only = empty; ≤ 50 keys, refused before any definition is read.
 * Returns the bag to store. Throws the CustomFieldValidationError family.
 */
validateForCustomerInput(
  entityType: SupportedEntityType,
  values: Record<string, unknown> | undefined,
  surface: CustomFieldInputSurface,
): Promise<Record<string, unknown>>;
```

`validateAndMerge`, `project` and `projectForCustomer` are unchanged; none of them reads
`adminAccess` (FR-007).

## 6. Admin write declarations (R-11)

```ts
export type CustomFieldWriteDeclaration =
  | { readonly entityType: SupportedEntityType; readonly kind: 'create' | 'update' | 'values';
      readonly method: 'POST' | 'PATCH' | 'PUT'; readonly path: string; readonly body: string }
  | { readonly entityType: SupportedEntityType; readonly kind: 'create' | 'update';
      readonly exempt: string }
  | { readonly entityType: SupportedEntityType; readonly kind: 'buyer-input';
      readonly surface: CustomFieldInputSurface; readonly method: 'POST'; readonly path: string;
      readonly body: string; readonly at: string; readonly test: string };
```

A type only — it exists so a host's `customFieldWrites` export is checked by `tsc` as well as by the
rule.
