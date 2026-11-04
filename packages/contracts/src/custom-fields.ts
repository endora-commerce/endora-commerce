import { z } from 'zod';
import { calendarDateSchema, isoDateTimeSchema, uuidSchema } from './common.js';

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
  // Feature 143 — a Sales Opportunity of the `crm` module. The registry entry
  // names that module as the type's owner, and the type is offered only while
  // the owner is present.
  'opportunity',
  // Feature 163 — a Project of the `projects` module; offered only while that
  // module is present, as an Opportunity's type follows `crm`.
  'project',
  // Feature 165 — a Task of the `tasks` module (research R-8); offered only
  // while that module is present.
  'task',
]);
export type SupportedEntityType = z.infer<typeof supportedEntityTypeSchema>;

/**
 * The set of runtime value types. `text` is stored as a string; `select` stores one option value; `multiselect` an array.
 *
 * `page_builder` (feature 172) is a Page Builder document per language. It is
 * never a field value: the generic value path refuses it, no list filter
 * applies to it, and a definition may take it only on an entity type whose
 * registry entry offers it (`product` alone) — the document lives in its
 * host's own storage.
 */
export const customFieldValueTypeSchema = z.enum([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'page_builder',
]);
export type CustomFieldValueType = z.infer<typeof customFieldValueTypeSchema>;

/** Per-locale label map (BCP-47-keyed). Empty is allowed when only `labelDefault` is filled. */
/**
 * Who a custom field's stored VALUES are answered to.
 *
 * - `customer` — the values are part of what a non-administrator reads: the
 *   buyer-facing (storefront) replies and the external, API-key replies.
 * - `internal` — administrators only. The values never leave the admin API.
 *
 * A definition created without the attribute is `internal`: a field has to be
 * opened to customers deliberately. Definitions that existed before the
 * attribute did were migrated to `customer`, which is how their values were
 * already being answered.
 */
export const customFieldAudienceSchema = z.enum(['customer', 'internal']);
export type CustomFieldAudience = z.infer<typeof customFieldAudienceSchema>;

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

/**
 * Patch an option (feature 157). Every member optional and **without the create
 * defaults**: `customFieldOptionSchema.partial()` keeps them, so a patch naming
 * only the label used to arrive carrying `isDefault: false`, `sortOrder: 0`
 * and `label: {}` and reset all three. The stored `value` is never patched.
 */
export const updateCustomFieldOptionSchema = z.object({
  label: localizedLabelSchema.optional(),
  labelDefault: z.string().min(1).max(200).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCustomFieldOptionRequest = z.infer<typeof updateCustomFieldOptionSchema>;

/**
 * How many entity types one definition may carry its values to (feature 162).
 * Every source type of the registry offers at most two targets.
 */
export const CUSTOM_FIELD_CARRY_MAX_TARGETS = 2;

/**
 * The entity types a definition's values carry **to** when a record of such a
 * type is created from, or joins, a record of the definition's own type
 * (feature 162). Which pairs exist is the registry's `carryTargets` marker to
 * say ({@link customFieldEntityTypeInfoSchema}); "never the definition's own
 * type" is a server refusal, not a refine — the patch schema does not know
 * the type.
 */
export const customFieldCarryToSchema = z
  .array(supportedEntityTypeSchema)
  .max(CUSTOM_FIELD_CARRY_MAX_TARGETS)
  .refine((list) => new Set(list).size === list.length, 'Duplicate carry target');

/** A full custom-field definition, options embedded. */
export const customFieldDefinitionSchema = z.object({
  id: uuidSchema,
  entityType: supportedEntityTypeSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: localizedLabelSchema,
  labelDefault: z.string().min(1).max(200),
  valueType: customFieldValueTypeSchema,
  required: z.boolean(),
  /** See {@link customFieldAudienceSchema}. */
  audience: customFieldAudienceSchema,
  sortOrder: z.number().int(),
  // Opaque host-capability flags (FR-006). The generic core stores but never
  // interprets `config`; a host module reads its own flags from here.
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Whether the admin lists of the definition's entity type offer it as a
   * filter (feature 157). Settable only where the entity type's registry entry
   * offers the option ({@link customFieldEntityTypeInfoSchema}).
   */
  listFilter: z.boolean(),
  /** See {@link customFieldCarryToSchema} (feature 162). */
  carryTo: customFieldCarryToSchema,
  options: z.array(customFieldOptionSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomFieldDefinitionDto = z.infer<typeof customFieldDefinitionSchema>;

/** Create a definition. `entityType` + `key` are immutable after create. */
export const createCustomFieldDefinitionSchema = customFieldDefinitionSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  // A definition created without an audience is `internal`: values reach a
  // customer only where an administrator has said they may.
  // A definition created without `listFilter` is not a list filter; the
  // server reads the absence as `false` rather than the schema defaulting it.
  // A definition created without `carryTo` carries nothing (feature 162).
  .extend({
    audience: customFieldAudienceSchema.default('internal'),
    listFilter: z.boolean().optional(),
    carryTo: customFieldCarryToSchema.default([]),
  });
export type CreateCustomFieldDefinitionRequest = z.infer<typeof createCustomFieldDefinitionSchema>;

/** Patch a definition. `entityType` and `key` cannot change once records may hold values. */
export const updateCustomFieldDefinitionSchema = createCustomFieldDefinitionSchema
  .partial()
  .omit({ entityType: true, key: true })
  // Declared again without the create defaults: an absent key on a patch means
  // "leave it as it is". `.partial()` keeps a default, so without this a patch
  // naming only the audience would arrive carrying `config: {}` and erase the
  // definition's host-capability flags, and one naming only a label would make
  // the field internal.
  .extend({
    audience: customFieldAudienceSchema.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    listFilter: z.boolean().optional(),
    carryTo: customFieldCarryToSchema.optional(),
  });
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
  /** Whether definitions of this type may be marked as list filters (feature 157). */
  listFilter: z.boolean(),
  /**
   * The entity types definitions of this type may carry their values to
   * (feature 162), filtered to targets whose owner module is present.
   */
  carryTargets: z.array(supportedEntityTypeSchema).default([]),
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

// ---------------------------------------------------------------------------
// --- list filters (specs/157-custom-fields-list-filters/) -----------------
// ---------------------------------------------------------------------------

/** A bound of a number, as a decimal string. */
const filterDecimalBoundSchema = z.string().regex(/^-?\d{1,12}(\.\d{1,4})?$/, 'Not a decimal number');

/**
 * One custom field's filter: the operators of every value type in one object.
 * Which of them apply is the definition's value type to say
 * (`CUSTOM_FIELD_FILTER_OPERATORS`): the admin lists refuse any other with 400
 * `VALIDATION_FAILED` (`assertCustomFieldFilterOperators`), and only the CRM
 * board ignores it. The CRM board's field filter is this same object.
 */
export const customFieldFilterSchema = z
  .object({
    contains: z.string().trim().min(1).max(200).optional(),
    in: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
    is: z.boolean().optional(),
    min: filterDecimalBoundSchema.optional(),
    max: filterDecimalBoundSchema.optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .strict();
export type CustomFieldFilter = z.infer<typeof customFieldFilterSchema>;

/**
 * The operators each value type applies (FR-008). A filter carrying another
 * operator for its field is refused rather than ignored: a filter is never
 * silently dropped (FR-011).
 */
export const CUSTOM_FIELD_FILTER_OPERATORS: Readonly<
  Record<CustomFieldValueType, readonly (keyof CustomFieldFilter)[]>
> = {
  text: ['contains'],
  number: ['min', 'max'],
  boolean: ['is'],
  date: ['from', 'to'],
  select: ['in'],
  multiselect: ['in'],
  // Feature 172 — a Page Builder document is not a filterable value: every
  // operator on such a field is refused, never ignored.
  page_builder: [],
};

/**
 * Throws the `ZodError` naming every operator of `filters` that does not apply
 * to its field's value type, each at `[key, operator]` — answered 400
 * `VALIDATION_FAILED`, as any other malformed filter. A key `valueTypeOf`
 * does not know is not this check's to judge.
 */
export function assertCustomFieldFilterOperators(
  filters: CustomFieldFilters,
  valueTypeOf: (key: string) => CustomFieldValueType | undefined,
): void {
  const issues: Array<{ code: 'custom'; path: string[]; message: string; input: unknown }> = [];
  for (const key of Object.keys(filters)) {
    const filter = filters[key];
    const valueType = valueTypeOf(key);
    if (filter === undefined || valueType === undefined) continue;
    const allowed: readonly string[] = CUSTOM_FIELD_FILTER_OPERATORS[valueType];
    for (const operator of Object.keys(filter)) {
      if (filter[operator as keyof CustomFieldFilter] === undefined || allowed.includes(operator)) continue;
      issues.push({
        code: 'custom',
        path: [key, operator],
        message: `"${operator}" does not apply to a ${valueType} field`,
        input: filter[operator as keyof CustomFieldFilter],
      });
    }
  }
  if (issues.length > 0) throw new z.ZodError(issues as never);
}

/** Bounds the work one list request can ask of the database (keys per request). */
export const CUSTOM_FIELD_FILTERS_MAX_KEYS = 10;
/** Bounds the work one list request can ask of the database (`in` values summed over every key). */
export const CUSTOM_FIELD_FILTERS_MAX_IN_VALUES = 100;

/**
 * A list request's custom-field filters, keyed by definition key. The key
 * grammar is the definition's, so `__proto__` and anything with a dot, a colon
 * or markup is refused here. `constructor` matches it: a consumer looks keys up
 * through a `Map` or `Object.hasOwn`, never a plain-object index.
 */
const customFieldFiltersRecordSchema = z
  .record(customFieldDefinitionSchema.shape.key, customFieldFilterSchema)
  .refine(
    (filters) => Object.keys(filters).length <= CUSTOM_FIELD_FILTERS_MAX_KEYS,
    'Too many custom-field filters',
  )
  .refine(
    (filters) =>
      Object.values(filters).reduce((count, filter) => count + (filter.in?.length ?? 0), 0) <=
      CUSTOM_FIELD_FILTERS_MAX_IN_VALUES,
    'Too many custom-field filter values',
  );

export const customFieldFiltersSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    // Zod's record skips an own `__proto__` key without a word; refuse it, so
    // the request reads as refused rather than as a filter quietly dropped.
    if (typeof value === 'object' && value !== null && Object.hasOwn(value, '__proto__')) {
      ctx.addIssue({ code: 'custom', message: 'Invalid custom-field key', path: ['__proto__'] });
    }
  })
  .pipe(customFieldFiltersRecordSchema);
export type CustomFieldFilters = z.infer<typeof customFieldFiltersSchema>;

/**
 * The `customFieldFilters` query parameter: {@link customFieldFiltersSchema}
 * as JSON, at most 8000 characters.
 *
 * **Idempotent.** The route validator replaces `request.query` with its parsed
 * output and a handler may parse it again with the same query schema, so an
 * already-parsed object is validated rather than refused. A repeated parameter
 * (an array) matches neither branch and is refused.
 */
export const customFieldFiltersQueryParamSchema = z
  .union([z.string().max(8000), customFieldFiltersSchema])
  .optional()
  .transform((raw, ctx): CustomFieldFilters | undefined => {
    if (raw === undefined || raw === '') return undefined;
    if (typeof raw !== 'string') return raw;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'customFieldFilters is not JSON' });
      return z.NEVER;
    }
    const result = customFieldFiltersSchema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        // Relative to this parameter: the query schema names it already.
        ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
      }
      return z.NEVER;
    }
    return result.data;
  });

/**
 * One custom field an admin list offers as a filter. Deliberately narrow: no
 * `audience`, `required`, `config`, `listFilter`, `id` or `sortOrder`.
 */
export const customFieldListFilterFieldSchema = z
  .object({
    key: customFieldDefinitionSchema.shape.key,
    valueType: customFieldValueTypeSchema,
    label: localizedLabelSchema,
    labelDefault: z.string(),
    options: z.array(
      z.object({ value: z.string(), label: localizedLabelSchema, labelDefault: z.string() }),
    ),
  })
  .strict();
export type CustomFieldListFilterField = z.infer<typeof customFieldListFilterFieldSchema>;

export const customFieldListFilterFieldsResponseSchema = z.object({
  data: z.array(customFieldListFilterFieldSchema),
});
export type CustomFieldListFilterFieldsResponse = z.infer<
  typeof customFieldListFilterFieldsResponseSchema
>;

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
// MikroORM `EntityManager`, which may not appear in a `@endora-commerce/contracts`
// signature (FR-034) and which a branded stand-in would publish rather than
// remove. It is declared in `custom_fields`' own `ports/` directory, the file
// that becomes the package's `./ports` subpath (D-171), and its seventh
// method, `publishInvalidate`, stays with it because it is a step of that
// seam's post-commit protocol rather than a question any reader has.
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
// The definition **read** it used to carry alongside them is published, as
// `CustomFieldDefinitionReadPort.getById` below (feature 080, T053(b)): a read
// handed an `EntityManager` is a write seam re-opened to serve it (D-169), and
// the seam was answering that one with the owner's managed ORM entities.
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
  // Feature 157 — `listFilter` set on a definition whose entity type does not offer it.
  'list_filter_unsupported',
  // Feature 162 — a carry target turned on that cannot take the definition's values.
  'carry_incompatible',
  // Feature 172 — a value type the definition's entity type does not offer (`page_builder` off `product`).
  'value_type_unsupported',
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
  audience: CustomFieldAudience;
  sortOrder: number;
  config: Record<string, unknown>;
  listFilter: boolean;
  /** Feature 162 — see {@link customFieldCarryToSchema}. */
  carryTo: SupportedEntityType[];
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
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `custom_fields` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CustomFieldDefinitionReadPort {
  listForEntity(entityType: SupportedEntityType): Promise<CustomFieldDefinitionWithOptions[]>;
  /**
   * The same list, bypassing the per-entity cache and refreshing it for every
   * process.
   *
   * A consumer composing its own rows against these definitions can observe a
   * benign inconsistency: a just-committed definition Command may dispatch its
   * domain event before the post-commit invalidation runs, and the invalidation
   * is a Redis fan-out with a TTL fallback, so a second process holds a stale
   * entry no in-process sequencing can reach. Only the consumer can *detect*
   * that — it is the one that knows what its own rows say — and only this
   * module may *resolve* it, because the cache is its own. So the port answers
   * the question the consumer actually has ("give me definitions I can trust")
   * rather than exposing an instruction about somebody else's internals.
   *
   * **Required, not optional**, and D-97.3 makes that a rule for every port:
   * `lazyPort`'s proxy answers every property with a function, so
   * `if (port.maybe)` is always true and feature detection through a port is
   * impossible by construction. The one optional method that existed —
   * `catalog`'s `publishInvalidate?` widening — fired its recovery branch
   * unconditionally and turned a self-healing window into a 500.
   */
  listForEntityFresh(entityType: SupportedEntityType): Promise<CustomFieldDefinitionWithOptions[]>;
  /**
   * One definition by id, with its options, or `null`.
   *
   * The **committed** state, deliberately: `catalog`'s attribute Commands read
   * it to capture an audit "before" snapshot and to feed the guards a
   * definition change has to satisfy, and both questions are about the row as
   * it stands rather than about anything the caller's open transaction has
   * written. That is what makes it a read rather than a seventh member of the
   * apply seam — handing a read an `EntityManager` re-opens a write seam to
   * serve it (D-169).
   *
   * It is published here, rather than left on the apply seam it used to sit
   * beside, because the definition service answers it with its two **managed
   * ORM entities** while the one consumer typed the result as a record.
   * Nothing mutated them, so the leak was latent — but that is precisely the
   * ability D-77's first narrowing took away from every other apply-seam
   * return, and a consumer holding a managed entity can persist a change to it
   * on whatever transaction it happens to be holding.
   */
  getById(id: string): Promise<CustomFieldDefinitionWithOptions | null>;
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
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `custom_fields` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
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
  /**
   * The bag as a NON-administrator may read it: only the keys whose definition
   * is live and has the `customer` audience. A key with an `internal`
   * definition, or with no definition at all, is not returned.
   *
   * Every host that answers custom-field values to a buyer or to an external
   * (API-key) caller passes the stored bag through here, in its one
   * non-admin serialiser. Definitions are read from the module's per-entity
   * cache, so calling it once per row of a list costs no query per row.
   */
  projectForCustomer(
    entityType: SupportedEntityType,
    bag: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

// `CustomFieldValidationFailure` and `isCustomFieldValidationFailure` are
// declared once, above, beside the other D-77 structural guards. Two Phase-C
// cuts published them independently on the same afternoon — `quote_requests`
// and `organizations` — and both merged, which stopped `@endora-commerce/contracts`
// compiling at all. The surviving pair keeps the `name === 'CustomFieldValidation
// Error'` test rather than re-parsing every entry: it is the check that still
// works once each module is its own npm package (F4), which is the reason the
// guard exists, and it costs nothing on an error path.

/**
 * Container name: `customFieldListFilterPort`. Owner: `custom_fields`
 * (feature 157).
 *
 * The admin lists of `orders`, `quote_requests` and `crm` ask it which custom
 * fields they offer as filters, and turn a request's filters into one
 * server-side condition.
 */
export interface CustomFieldListFilterPort {
  /** The served definitions of the type with `listFilter` on; `[]` when the type offers none. */
  listFilterable(entityType: SupportedEntityType): Promise<CustomFieldListFilterField[]>;
  /**
   * The whole request's filters as **one** condition — one scan of the bound
   * host table, every predicate of every key ANDed in its WHERE — or `null`
   * when nothing applies. Throws a {@link CustomFieldFilterUnavailableFailure}
   * naming every key that is not offered.
   */
  condition(
    entityType: SupportedEntityType,
    filters: CustomFieldFilters | undefined,
  ): Promise<CustomFieldListFilterCondition | null>;
}

/**
 * `select t."id" from "<bound table>" t where (<p1>) and (<p2>) …` — every key
 * and value bound. A caller wraps it in a fresh raw fragment for every
 * statement it runs; a raw fragment is not reused.
 */
export interface CustomFieldListFilterCondition {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** What {@link CustomFieldListFilterPort.condition} throws for filters a list does not offer. */
export interface CustomFieldFilterUnavailableFailure extends Error {
  readonly name: 'CustomFieldFilterUnavailableError';
  readonly keys: readonly string[];
}

/**
 * Throws the `ZodError` naming every inverted range of `filters` — a minimum
 * above its maximum, a start date after its end — each at `[key, 'min']` or
 * `[key, 'from']`, answered 400 `VALIDATION_FAILED`. Such a filter could only
 * ever match nothing; refusing it says so instead of showing an empty list.
 */
export function assertCustomFieldFilterRanges(filters: CustomFieldFilters): void {
  const issues: Array<{ code: 'custom'; path: string[]; message: string; input: unknown }> = [];
  for (const key of Object.keys(filters)) {
    const filter = filters[key];
    if (filter === undefined) continue;
    if (filter.min !== undefined && filter.max !== undefined && Number(filter.min) > Number(filter.max)) {
      issues.push({ code: 'custom', path: [key, 'min'], message: 'The minimum is above the maximum', input: filter.min });
    }
    if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
      issues.push({ code: 'custom', path: [key, 'from'], message: 'The start date is after the end date', input: filter.from });
    }
  }
  if (issues.length > 0) throw new z.ZodError(issues as never);
}

/** A refused list filter naming `keys`, in the shape {@link isCustomFieldFilterUnavailableFailure} narrows. */
export function customFieldFilterUnavailable(
  keys: readonly string[],
  message = 'Custom-field filters are not available on this list.',
): CustomFieldFilterUnavailableFailure {
  return Object.assign(new Error(message), {
    name: 'CustomFieldFilterUnavailableError' as const,
    keys: [...keys],
  });
}

/** Whether `error` is a refused list filter, narrowed by shape (as the sibling guards above). */
export function isCustomFieldFilterUnavailableFailure(
  error: unknown,
): error is CustomFieldFilterUnavailableFailure {
  return (
    error instanceof Error &&
    error.name === 'CustomFieldFilterUnavailableError' &&
    Array.isArray((error as { keys?: unknown }).keys)
  );
}

// ---------------------------------------------------------------------------
// --- value carry-over (specs/162-custom-fields-value-carry/) ---------------
// ---------------------------------------------------------------------------

/** One side of a carry pair, as the compatibility rule reads it. */
export interface CustomFieldCarryParty {
  valueType: CustomFieldValueType;
  audience: CustomFieldAudience;
  options: ReadonlyArray<{ value: string }>;
}

/** Why a carry from one definition to the same-key definition of another type cannot work. */
export type CustomFieldCarryIncompatibility =
  | { reason: 'target_missing' }
  | {
      reason: 'value_type_mismatch';
      sourceValueType: CustomFieldValueType;
      targetValueType: CustomFieldValueType;
    }
  | { reason: 'options_missing'; missingOptionValues: string[] }
  | { reason: 'audience_mismatch' };

/**
 * The one compatibility rule of a carry pair (feature 162). The server refuses
 * turning a carry on with it, the admin marks drifted carries with it, and the
 * carry port applies its type and audience halves at conversion. Pure: no I/O.
 *
 * Every reason, in this order; `[]` means compatible:
 * - no target → `target_missing`, and nothing else;
 * - value types differ → `value_type_mismatch` — no widening, and the options
 *   question is not asked;
 * - `select` / `multiselect`: the source option values the target lacks, in
 *   source order (labels ignored, extra target options fine) → `options_missing`;
 * - an `internal` source into a `customer` target → `audience_mismatch`.
 */
export function assessCustomFieldCarry(
  source: CustomFieldCarryParty,
  target: CustomFieldCarryParty | null,
): CustomFieldCarryIncompatibility[] {
  if (target === null) return [{ reason: 'target_missing' }];
  const reasons: CustomFieldCarryIncompatibility[] = [];
  if (source.valueType !== target.valueType) {
    reasons.push({
      reason: 'value_type_mismatch',
      sourceValueType: source.valueType,
      targetValueType: target.valueType,
    });
  } else if (source.valueType === 'select' || source.valueType === 'multiselect') {
    const offered = new Set(target.options.map((option) => option.value));
    const missingOptionValues = source.options
      .map((option) => option.value)
      .filter((value) => !offered.has(value));
    if (missingOptionValues.length > 0) {
      reasons.push({ reason: 'options_missing', missingOptionValues });
    }
  }
  if (source.audience === 'internal' && target.audience === 'customer') {
    reasons.push({ reason: 'audience_mismatch' });
  }
  return reasons;
}

/**
 * Why one value was not carried at conversion. `value_invalid` is the
 * per-value twin of `options_missing`: the value itself does not satisfy the
 * target definition.
 */
export const customFieldCarrySkipReasonSchema = z.enum([
  'target_missing',
  'value_type_mismatch',
  'audience_mismatch',
  'value_invalid',
]);
export type CustomFieldCarrySkipReason = z.infer<typeof customFieldCarrySkipReasonSchema>;

/**
 * The longest string a skip's label snapshot holds — a definition's
 * `labelDefault` cap. `custom_fields` cuts the snapshot to it when it takes it,
 * since a definition's per-locale labels are not capped.
 */
export const CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX = 200;

/**
 * The skipped field's label as its **source** definition read when the value
 * was skipped (owner ruling 2026-10-21, V3): a history line names the field in
 * the reader's language without asking `custom_fields` for definitions, so an
 * administrator without `custom_fields:read` reads it too. A snapshot — a later
 * rename does not rewrite history. Each string is at most
 * {@link CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX} characters.
 */
export const customFieldCarrySkipLabelSchema = z.object({
  labelDefault: z.string().max(CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX),
  labels: z.record(z.string(), z.string().max(CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX)),
});
export type CustomFieldCarrySkipLabel = z.infer<typeof customFieldCarrySkipLabelSchema>;

/** `label` is absent on a skip recorded before the snapshot existed. */
export const customFieldCarrySkipSchema = z.object({
  key: z.string(),
  reason: customFieldCarrySkipReasonSchema,
  label: customFieldCarrySkipLabelSchema.optional(),
});

/** One key not carried, with its reason and the source field's label snapshot. */
export interface CustomFieldCarrySkip {
  readonly key: string;
  readonly reason: CustomFieldCarrySkipReason;
  readonly label?: CustomFieldCarrySkipLabel;
}

/**
 * A plain copy of a skip for a record to store: `key`, `reason` and — when the
 * skip has one — a copy of its label snapshot (`labelDefault` and `labels`).
 * **It strips every other field**: whatever else the value carries, on the skip
 * or on its label, is dropped and never reaches a stored record.
 */
export function customFieldCarrySkipRecord(
  skip: Omit<CustomFieldCarrySkip, 'label'> & { readonly label?: CustomFieldCarrySkipLabel | undefined },
): CustomFieldCarrySkip {
  const { key, reason, label } = skip;
  return label === undefined
    ? { key, reason }
    : { key, reason, label: { labelDefault: label.labelDefault, labels: { ...label.labels } } };
}

/**
 * What {@link CustomFieldCarryPort.plan} answers: `values` is the target bag to
 * persist — the target's own bag plus the carried keys, never a removed or
 * overwritten key — `carried` the keys added and `skipped` the keys not
 * carried, each with its reason.
 */
export interface CustomFieldCarryPlan {
  readonly values: Record<string, unknown>;
  readonly carried: readonly string[];
  readonly skipped: readonly CustomFieldCarrySkip[];
}

/**
 * Container name: `customFieldCarryPort`. Owner: `custom_fields` (feature 162).
 *
 * The host that owns a carry's **target** record asks it which source values
 * carry into its own current bag, and persists the answer in its own write.
 * Only source definitions whose `carryTo` names the target type and whose value
 * is non-empty are considered; a target key that already holds a value is kept
 * and neither carried nor skipped; unrelated target fields — required ones
 * included — are never consulted, so a host must not run `validateAndMerge`
 * over the answer. Either type's owner absent → an empty plan.
 *
 * It performs **no** database write, **no** audit and emits **no** event.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `custom_fields` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CustomFieldCarryPort {
  plan(input: {
    sourceType: SupportedEntityType;
    targetType: SupportedEntityType;
    sourceValues: Record<string, unknown>;
    targetValues: Record<string, unknown>;
  }): Promise<CustomFieldCarryPlan>;
}

/** What a receiver answers: `not-found` for a missing record and for another Organization's alike. */
export interface CustomFieldCarryReceipt {
  readonly outcome: 'applied' | 'not-found';
  readonly carried: readonly string[];
  readonly skipped: readonly CustomFieldCarrySkip[];
}

/**
 * Container name: `orderCustomFieldCarryPort`. Owner: `orders`.
 * Container name: `quoteRequestCustomFieldCarryPort`. Owner: `quote_requests`.
 * (Feature 162.)
 *
 * `crm` pushes a Sales Opportunity's values to the document created from it,
 * once its origin link is made; the document's owner carries them into empty
 * fields in one Command of its own and records what it skipped on the record.
 * `not-found` for a missing record **and** for a record of another
 * Organization — one answer, no existence leak; `applied` otherwise, even when
 * nothing was carried. A second call carries nothing more (fill-empty).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. `orders` is not deactivatable; for `quote_requests` the caller
 * decides presence first and does not call.
 */
export interface CustomFieldCarryReceiverPort {
  receiveCarriedValues(input: {
    recordId: string;
    organizationId: string;
    source: {
      entityType: 'opportunity';
      recordId: string;
      /** The source's business number, for the skip entry's sentence. */
      reference: string;
      values: Record<string, unknown>;
    };
  }): Promise<CustomFieldCarryReceipt>;
}
