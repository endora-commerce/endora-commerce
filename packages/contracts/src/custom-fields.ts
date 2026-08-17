import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Custom Fields Layer (feature 055) — entity-agnostic runtime custom fields
 * on core entities (Category, Order, Organization, Customer, QuoteRequest).
 *
 * These are the source-of-truth boundary schemas (Principle V). The per-value
 * validator applied to host records is DERIVED at runtime from a stored
 * definition (see backend `custom-field-value.service.ts`); the schemas here
 * cover the definition/option admin API and the value-bag envelope.
 */

/** The host entity types custom fields may attach to at launch. Extensible via the backend registry. */
export const supportedEntityTypeSchema = z.enum([
  'category',
  'order',
  'organization',
  'customer',
  'quote_request',
  // Feature 061 — product attributes are catalog extensions of product-host
  // definitions; the type is host-managed (writes only via /catalog/attributes).
  'product',
]);
export type SupportedEntityType = z.infer<typeof supportedEntityTypeSchema>;

/** The set of runtime value types. `text` is stored as a string; `select` stores one option value; `multiselect` an array. */
export const customFieldValueTypeSchema = z.enum([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
]);
export type CustomFieldValueType = z.infer<typeof customFieldValueTypeSchema>;

/** Per-locale label map (BCP-47-keyed). Empty is allowed when only `labelDefault` is filled. */
export const localizedLabelSchema = z.record(z.string(), z.string());
export type LocalizedLabel = z.infer<typeof localizedLabelSchema>;

/** A select/multiselect option. `id` absent on create. */
export const customFieldOptionSchema = z.object({
  id: uuidSchema.optional(),
  value: z.string().min(1).max(200),
  label: localizedLabelSchema.default({}),
  labelDefault: z.string().min(1).max(200),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type CustomFieldOptionDto = z.infer<typeof customFieldOptionSchema>;

/** A full custom-field definition, options embedded. */
export const customFieldDefinitionSchema = z.object({
  id: uuidSchema,
  entityType: supportedEntityTypeSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: localizedLabelSchema,
  labelDefault: z.string().min(1).max(200),
  valueType: customFieldValueTypeSchema,
  required: z.boolean(),
  sortOrder: z.number().int(),
  // Opaque host-capability flags (FR-006). The generic core stores but never
  // interprets `config`; a host module reads its own flags from here.
  config: z.record(z.string(), z.unknown()).default({}),
  options: z.array(customFieldOptionSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomFieldDefinitionDto = z.infer<typeof customFieldDefinitionSchema>;

/** Create a definition. `entityType` + `key` are immutable after create. */
export const createCustomFieldDefinitionSchema = customFieldDefinitionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateCustomFieldDefinitionRequest = z.infer<typeof createCustomFieldDefinitionSchema>;

/** Patch a definition. `entityType` and `key` cannot change once records may hold values. */
export const updateCustomFieldDefinitionSchema = createCustomFieldDefinitionSchema
  .partial()
  .omit({ entityType: true, key: true });
export type UpdateCustomFieldDefinitionRequest = z.infer<typeof updateCustomFieldDefinitionSchema>;

/**
 * One supported host entity type as served by the admin entity-types listing
 * (feature 061 T037). `managedBy` is present only for host-managed types
 * (e.g. `product` → catalog attributes): the generic admin UI renders those
 * read-only and links to `managedBy.route`. Label fields are i18n keys
 * resolved against the `custom_fields` module bundle.
 */
export const customFieldEntityTypeInfoSchema = z.object({
  entityType: supportedEntityTypeSchema,
  labelKey: z.string(),
  managedBy: z
    .object({
      moduleId: z.string(),
      labelKey: z.string(),
      route: z.string(),
    })
    .optional(),
});
export type CustomFieldEntityTypeInfo = z.infer<typeof customFieldEntityTypeInfoSchema>;

/** A validated value bag keyed by definition `key`. Values are typed by their definition's `valueType`. */
export const customFieldValuesSchema = z.record(z.string(), z.unknown());
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

/** One per-field validation failure returned to the admin for per-field rendering (FR-004). */
export const customFieldValidationErrorSchema = z.object({
  field: z.string(),
  code: z.enum([
    'wrong_type',
    'missing_required',
    'unknown_option',
    'out_of_range',
    'duplicate_option',
  ]),
  message: z.string(),
});
export type CustomFieldValidationError = z.infer<typeof customFieldValidationErrorSchema>;

/**
 * What `CustomFieldValuePort.validateAndMerge` throws, as a **shape** rather
 * than a constructor (feature 075, Phase C).
 *
 * Five host modules catch it to turn it into the 422 envelope, and each of them
 * did it with `err instanceof CustomFieldValidationError` — which imports
 * `custom_fields`' class and is the last thing several of their cuts would
 * otherwise be left holding. This is D-77's remedy for
 * `CustomFieldDefinitionError` applied to its sibling: narrow structurally, so
 * the host names a published shape instead of a foreign constructor.
 *
 * The guard tests `name` and the `errors` array rather than the prototype
 * chain, which is also what makes it survive the error crossing a package
 * boundary once each module is its own npm package (F4).
 */
export interface CustomFieldValidationFailure extends Error {
  readonly errors: readonly CustomFieldValidationError[];
}

export function isCustomFieldValidationFailure(
  error: unknown,
): error is CustomFieldValidationFailure {
  return (
    error instanceof Error &&
    error.name === 'CustomFieldValidationError' &&
    Array.isArray((error as { errors?: unknown }).errors)
  );
}

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `custom_fields` publishes to the seven modules that
// read it (feature 075, Phase P). Plain TypeScript, not Zod: these describe
// in-process calls, not an API boundary.
//
// **One seam is deliberately not published here, and D-77 ruled that it stays
// that way.** `CustomFieldDefinitionApplyApi` — the six co-transactional
// `apply*` methods `catalog`'s attribute Commands call — takes the caller's
// MikroORM `EntityManager`, which may not appear in a `@b2b/contracts`
// signature (FR-034) and which a branded stand-in would publish rather than
// remove.
//
// What holds it there is not a convention but a constraint:
// `fk_product_attributes_custom_field_definition`, `on delete restrict`, plus a
// `unique` on the same column. A child insert must see its parent inside one
// transaction, and a second transaction cannot satisfy a foreign key against a
// row it cannot see. AGENTS.md § Migrations item 4 tells you to *declare* a
// cross-module foreign key rather than avoid it; `catalog`'s manifest does.
// The seam's ledger entry is `permanent: true`, and what retires it is F4's
// package entry points — not a port, and not a relocation.
//
// Two narrowings were taken with that ruling, and both live here. The `apply*`
// returns are the published records below rather than live managed entities, so
// a host loses the *ability* to mutate a definition outside the seam; and the
// failure crossing the boundary is the code union and guard below rather than
// an imported error class.
// ---------------------------------------------------------------------------

/**
 * How a definition or option write can be refused (feature 061).
 *
 * Published as a union rather than a class so a host narrows the failure
 * **structurally**. `catalog` mapped these onto its own HTTP surface by
 * `err instanceof CustomFieldDefinitionError`, which meant importing a
 * constructor out of another module to read a string field off it.
 */
export const CUSTOM_FIELD_DEFINITION_ERROR_CODES = [
  'not_found',
  'duplicate_key',
  'options_required',
  'options_forbidden',
  'entity_type_unknown',
  'value_type_locked',
  'option_in_use',
] as const;
export type CustomFieldDefinitionErrorCode =
  (typeof CUSTOM_FIELD_DEFINITION_ERROR_CODES)[number];

/** A refused definition or option write, as a host outside `custom_fields` sees it. */
export interface CustomFieldDefinitionFailure {
  readonly name: 'CustomFieldDefinitionError';
  readonly code: CustomFieldDefinitionErrorCode;
  readonly message: string;
}

/**
 * Whether `error` is a refused definition write, narrowed by shape.
 *
 * `name` and `code` together, not `name` alone: the name is what the class sets
 * on itself and the code is what the caller branches on, so a shape carrying one
 * without the other is not something a host can act on.
 */
export function isCustomFieldDefinitionFailure(
  error: unknown,
): error is CustomFieldDefinitionFailure {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === 'CustomFieldDefinitionError' &&
    typeof candidate.code === 'string' &&
    (CUSTOM_FIELD_DEFINITION_ERROR_CODES as readonly string[]).includes(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

/** One custom-field definition, as a module outside `custom_fields` sees it. */
export interface CustomFieldDefinitionRecord {
  id: string;
  entityType: SupportedEntityType;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: CustomFieldValueType;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** One selectable option of a `select` / `multiselect` definition. */
export interface CustomFieldOptionRecord {
  id: string;
  definitionId: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A definition with its options — the unit the per-entity cache holds. */
export interface CustomFieldDefinitionWithOptions {
  readonly definition: CustomFieldDefinitionRecord;
  readonly options: CustomFieldOptionRecord[];
}

/**
 * Container name: `customFieldDefinitionReadPort`. Owner: `custom_fields`.
 *
 * `catalog`'s composed attribute read model is the heaviest consumer: since
 * feature 061 the definition half of a product attribute *is* a custom-field
 * definition, and it reads them through this one question. `product_feeds`
 * asks the same thing of its own host.
 *
 * Reads ride the per-entity in-process cache (invalidated by every committed
 * definition Command, with a 5 s TTL fallback), so this is cheap enough to
 * call on a hot path — which is what the existing `DefinitionSource` interface
 * was extracted for.
 */
export interface CustomFieldDefinitionReadPort {
  listForEntity(entityType: SupportedEntityType): Promise<CustomFieldDefinitionWithOptions[]>;
}

/**
 * Container name: `customFieldValueService`. Owner: `custom_fields`.
 *
 * Five host modules — `orders`, `organizations`, `customers`, `quote_requests`
 * and `catalog` — validate their own custom-field bag through this before
 * persisting it.
 *
 * It performs **no** database write and **no** audit: the host persists its own
 * record and audits its own write (Principle XIII). This port only validates
 * the incoming values and returns the merged bag, which is what keeps the
 * module boundary intact (Principle I) and avoids a double audit.
 *
 * `validateAndMerge` throws `CustomFieldValidationError` — serialised as HTTP
 * 422 — with the per-field errors (feature 055 FR-004). Unknown patch keys are
 * ignored; dormant keys already in the bag are retained (FR-010).
 */
export interface CustomFieldValuePort {
  validateAndMerge(
    entityType: SupportedEntityType,
    currentBag: Record<string, unknown>,
    patch: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>>;
  /** The bag as a caller should render it: dormant keys stripped. */
  project(
    entityType: SupportedEntityType,
    bag: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

// `CustomFieldValidationFailure` and `isCustomFieldValidationFailure` are
// declared once, above, beside the other D-77 structural guards. Two Phase-C
// cuts published them independently on the same afternoon — `quote_requests`
// and `organizations` — and both merged, which stopped `@b2b/contracts`
// compiling at all. The surviving pair keeps the `name === 'CustomFieldValidation
// Error'` test rather than re-parsing every entry: it is the check that still
// works once each module is its own npm package (F4), which is the reason the
// guard exists, and it costs nothing on an error path.
