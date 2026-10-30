/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/contracts/scoped-values-api.md`; research
 * R4–R8, R21) — the product editor's one read, one save, copy to channels and the editor scope
 * preference. Owner: `catalog`.
 *
 * Every scoped value is written in the one write encoding (`scoped-write-encoding.ts`): absent or
 * `""` = no change, `null` = empty override, `{ inherit: true }` = inherit, else the value. Field
 * paths and scope sets: `product-scope-model.ts`. Bounds (R21): every object is strict, record
 * keys are validated (and `__proto__` / `constructor` / `prototype` refused), lengths and the
 * changed-cell count are capped; the service reads the records into a `Map`.
 */

import { z } from 'zod';
import { isoDateTimeSchema, productVisibilitySchema, uuidSchema } from './common.js';
import { PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX, productStatusSchema, productTypeSchema } from './catalog.js';
import { ORDER_MINIMUM_MAX } from './order-minimums.js';
import { SCOPED_SOURCES, type ScopeRef, type ScopedSource } from './product-scope-model.js';
import { fieldPathSchema, scopeMissingValueSchema, scopeRequestSchema, scopeWarningSchema } from './product-scopes.js';
import { productSlugSchema, URL_KEY_TAKEOVER_MAX } from './product-url-keys.js';
import { scopedWrite } from './scoped-write-encoding.js';

// --- Bounds (R21) -----------------------------------------------------------------------------

/** The longest text attribute value at any scope. */
export const SCOPED_TEXT_ATTRIBUTE_MAX = 4000;
/** The most organisations one audience value names. */
export const SCOPED_AUDIENCE_ORGANIZATIONS_MAX = 500;
/** The most changed cells one save carries. */
export const SCOPED_SAVE_CELLS_MAX = 500;
/** Route body limits, in bytes. */
export const SCOPED_VALUES_BODY_LIMIT = 1024 * 1024;
export const SCOPED_VALUES_COPY_BODY_LIMIT = 64 * 1024;
/** A before / after audit cell longer than this is stored `{ truncated, length, sha256 }`. */
export const SCOPED_AUDIT_CELL_MAX_BYTES = 4096;
/** The most target channels one copy names. */
export const SCOPED_COPY_TARGETS_MAX = 64;

/** SEO field lengths (`contracts/seo-ports.md` §2). */
export const SEO_PRODUCT_META_MAX = {
  title: 160,
  description: 400,
  ogTitle: 160,
  ogDescription: 400,
  ogImageUrl: 2048,
} as const;

const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const uuidKeySchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'uuid key');
const attributeKeySchema = z
  .string()
  .regex(/^[a-z0-9_]{1,64}$/, 'attribute key')
  .refine((key) => !FORBIDDEN_RECORD_KEYS.has(key), 'reserved key');

/** An absolute `http:` / `https:` URL — the only image URLs product SEO accepts (R21). */
export const httpUrlSchema = z
  .string()
  .max(SEO_PRODUCT_META_MAX.ogImageUrl)
  .regex(/^https?:\/\/[^\s/?#\\]+[^\s\\]*$/i, 'http(s) URL');

// --- §1 Scope ---------------------------------------------------------------------------------

export const scopeRefSchema: z.ZodType<ScopeRef> = z.discriminatedUnion('level', [
  z.object({ level: z.literal('global') }),
  z.object({ level: z.literal('channel'), channelId: uuidSchema }),
  z.object({ level: z.literal('channel_language'), channelId: uuidSchema, languageCode: z.string().min(1).max(16) }),
]);

export { scopeRequestSchema };

// --- §2 Read ----------------------------------------------------------------------------------

export const scopedSourceSchema = z.enum(SCOPED_SOURCES as unknown as [ScopedSource, ...ScopedSource[]]);
export const scopeLevelShortSchema = z.enum(['G', 'C', 'CL']);

/** One field at the read's scope (FR-109). */
export function scopedFieldViewSchema<S extends z.ZodType>(valueSchema: S) {
  return z.object({
    /** The effective value; `null` when the source is `set_empty` or `absent`. */
    value: valueSchema.nullable(),
    source: scopedSourceSchema,
    /** Present when the source is `set` / `set_empty`: the value stored at this scope. */
    ownValue: valueSchema.nullable().optional(),
    levels: z.array(scopeLevelShortSchema),
    /** The scope's level is in `levels` (FR-082). */
    supportedHere: z.boolean(),
    /** Refuses an empty override (FR-062). */
    required: z.boolean(),
  });
}
export type ScopedFieldView<T> = {
  value: T | null;
  source: ScopedSource;
  ownValue?: T | null;
  levels: Array<'G' | 'C' | 'CL'>;
  supportedHere: boolean;
  required: boolean;
};

const windowValueSchema = z.object({ from: isoDateTimeSchema.nullable(), until: isoDateTimeSchema.nullable() }).strict();
const audienceValueSchema = z
  .object({
    visibility: productVisibilitySchema,
    allowedOrganizationIds: z.array(uuidSchema).max(SCOPED_AUDIENCE_ORGANIZATIONS_MAX),
  })
  .strict();
const galleryRolesView = z.object({
  base_image: scopedFieldViewSchema(uuidSchema),
  small_image: scopedFieldViewSchema(uuidSchema),
  thumbnail: scopedFieldViewSchema(uuidSchema),
});
const seoView = z.object({
  title: scopedFieldViewSchema(z.string()),
  description: scopedFieldViewSchema(z.string()),
  ogTitle: scopedFieldViewSchema(z.string()),
  ogDescription: scopedFieldViewSchema(z.string()),
  ogImageUrl: scopedFieldViewSchema(z.string()),
});

/** §2.1 — what the completeness gate reports at the read's scope (FR-097). */
export const completenessSummarySchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('channel_language'), missing: z.array(scopeMissingValueSchema) }),
  z.object({
    level: z.literal('channel'),
    missing: z.array(z.object({ field: scopeMissingValueSchema, languages: z.array(z.string()) })),
  }),
  z.object({ level: z.literal('global'), incompleteScopes: z.number().int().nonnegative() }),
]);
export type CompletenessSummary = z.infer<typeof completenessSummarySchema>;

export const scopedValuesDataSchema = z.object({
  scope: scopeRefSchema,
  /** `products.scope_version`, opaque (R7). */
  version: z.string(),
  validScopes: z.object({
    channels: z.array(
      z.object({
        channelId: uuidSchema,
        name: z.string(),
        languages: z.array(z.object({ code: z.string(), name: z.string() })),
      }),
    ),
  }),
  /** Global-only fields, always the Global value (FR-081). */
  product: z.object({
    sku: z.string(),
    type: productTypeSchema,
    attributeSetId: uuidSchema,
    categoryIds: z.array(uuidSchema),
    archivedAt: isoDateTimeSchema.nullable(),
    slugGlobal: z.string(),
    manageStock: z.boolean(),
    backorderEnabled: z.boolean(),
    lowStockThreshold: z.number().int().nullable(),
    lowStockThresholdMode: z.enum(['cumulative', 'per_warehouse']),
    fulfilmentStrategy: z.string().nullable(),
    fulfilmentStrategyWarehouseOrder: z.array(uuidSchema).nullable(),
    downloadAssetId: uuidSchema.nullable(),
    downloadUrl: z.string().nullable(),
    allowedOrganizationIds: z.array(uuidSchema),
  }),
  fields: z.object({
    name: scopedFieldViewSchema(z.string()),
    description: scopedFieldViewSchema(z.string()),
    status: scopedFieldViewSchema(productStatusSchema),
    window: scopedFieldViewSchema(windowValueSchema),
    audience: scopedFieldViewSchema(audienceValueSchema),
    minOrderQuantity: scopedFieldViewSchema(z.number().int()),
    returnable: scopedFieldViewSchema(z.boolean()),
    urlKey: scopedFieldViewSchema(z.string()),
  }),
  attributes: z.array(
    z.object({
      key: z.string(),
      label: z.record(z.string(), z.string()),
      valueType: z.string(),
      isRequired: z.boolean(),
      view: scopedFieldViewSchema(z.unknown()),
    }),
  ),
  gallery: z.object({
    items: z.array(
      z.object({
        id: uuidSchema,
        assetId: uuidSchema,
        url: z.string(),
        position: z.number().int().nonnegative(),
        altText: scopedFieldViewSchema(z.string()),
        hidden: scopedFieldViewSchema(z.boolean()),
        /** The asset's own alt text in the scope's language — the derived fallback. */
        assetAltText: z.string().nullable(),
      }),
    ),
    roles: galleryRolesView,
  }),
  attachments: z.array(
    z.object({
      id: uuidSchema,
      assetId: uuidSchema,
      typeId: uuidSchema,
      position: z.number().int().nonnegative(),
      fileName: z.string(),
      name: scopedFieldViewSchema(z.string()),
      description: scopedFieldViewSchema(z.string()),
      hidden: scopedFieldViewSchema(z.boolean()),
    }),
  ),
  packagingUnits: z.array(
    z.object({
      id: uuidSchema,
      baseQuantity: z.number().int().positive(),
      position: z.number().int().nonnegative(),
      isDefault: z.boolean(),
      minOrderUnits: z.number().int().positive().nullable(),
      name: scopedFieldViewSchema(z.string()),
    }),
  ),
  /** `null` when `seo` is not effectively present (FR-092). */
  seo: seoView.nullable(),
  completeness: completenessSummarySchema,
  /** Names for audience lists (163 U1). */
  organizations: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type ScopedValuesData = z.infer<typeof scopedValuesDataSchema>;

export const scopedValuesResponseSchema = z.object({ data: scopedValuesDataSchema });
export type ScopedValuesResponse = z.infer<typeof scopedValuesResponseSchema>;

/** `GET …/scoped-values` query: the scope (§1). */
export const scopedValuesQuerySchema = scopeRequestSchema;

// --- §3 Save ----------------------------------------------------------------------------------

const nameValue = z.string().min(1).max(PRODUCT_NAME_MAX);
const descriptionValue = z.string().max(PRODUCT_DESCRIPTION_MAX);
const textValue = (max: number) => z.string().max(max);

/** The Global-only product fields a save writes at Global (FR-081); elsewhere `GLOBAL_ONLY_FIELD`. */
export const globalOnlyProductFieldsSchema = z
  .object({
    sku: z.string().min(1).max(255),
    attributeSetId: uuidSchema,
    categoryIds: z.array(uuidSchema).max(500),
    manageStock: z.boolean(),
    backorderEnabled: z.boolean(),
    lowStockThreshold: z.number().int().nonnegative().nullable(),
    lowStockThresholdMode: z.enum(['cumulative', 'per_warehouse']),
    fulfilmentStrategy: z
      .enum(['any', 'default_first', 'lowest_stock_first', 'highest_stock_first', 'defined_order'])
      .nullable(),
    fulfilmentStrategyWarehouseOrder: z.array(uuidSchema).max(500).nullable(),
    downloadAssetId: uuidSchema.nullable(),
    downloadUrl: z.string().url().max(2048).nullable(),
  })
  .partial()
  .strict();
export type GlobalOnlyProductFields = z.infer<typeof globalOnlyProductFieldsSchema>;

/**
 * An attribute value: its schema is the attribute's value type, checked by the service against
 * the definition (scope set, type, options, the 4 000-character text cap).
 */
const attributeValue = z.union([
  z.string().max(SCOPED_TEXT_ATTRIBUTE_MAX),
  z.number(),
  z.boolean(),
  z.array(z.string().max(255)).max(500),
]);

export const scopedValueChangesSchema = z
  .object({
    product: globalOnlyProductFieldsSchema.optional(),
    name: scopedWrite(nameValue),
    description: scopedWrite(descriptionValue),
    status: scopedWrite(productStatusSchema),
    window: scopedWrite(windowValueSchema),
    audience: scopedWrite(audienceValueSchema),
    minOrderQuantity: scopedWrite(z.number().int().min(1).max(ORDER_MINIMUM_MAX)),
    returnable: scopedWrite(z.boolean()),
    urlKey: scopedWrite(z.string().transform((raw) => raw.normalize('NFC').toLowerCase()).pipe(productSlugSchema)),
    /** Honoured only by interactive `catalog:write` routes (163 FR-072). */
    confirmTakeover: z.array(productSlugSchema).max(URL_KEY_TAKEOVER_MAX).optional(),
    attributes: z.record(attributeKeySchema, scopedWrite(attributeValue)).optional(),
    gallery: z
      .object({
        items: z
          .record(
            uuidKeySchema,
            z.object({ altText: scopedWrite(textValue(255)), hidden: scopedWrite(z.boolean()) }).strict(),
          )
          .optional(),
        roles: z
          .object({
            base_image: scopedWrite(uuidSchema),
            small_image: scopedWrite(uuidSchema),
            thumbnail: scopedWrite(uuidSchema),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    attachments: z
      .record(
        uuidKeySchema,
        z
          .object({
            name: scopedWrite(z.string().min(1).max(160)),
            description: scopedWrite(textValue(4000)),
            hidden: scopedWrite(z.boolean()),
          })
          .strict(),
      )
      .optional(),
    packagingUnits: z.record(uuidKeySchema, z.object({ name: scopedWrite(z.string().min(1).max(160)) }).strict()).optional(),
    seo: z
      .object({
        title: scopedWrite(textValue(SEO_PRODUCT_META_MAX.title)),
        description: scopedWrite(textValue(SEO_PRODUCT_META_MAX.description)),
        ogTitle: scopedWrite(textValue(SEO_PRODUCT_META_MAX.ogTitle)),
        ogDescription: scopedWrite(textValue(SEO_PRODUCT_META_MAX.ogDescription)),
        ogImageUrl: scopedWrite(httpUrlSchema),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ScopedValueChanges = z.infer<typeof scopedValueChangesSchema>;

/** The number of changed cells in a `changes` body — the 500-cell cap counts these. */
export function countChangedCells(changes: ScopedValueChanges): number {
  let count = 0;
  const countObject = (value: object | undefined) => {
    if (value === undefined) return;
    for (const entry of Object.values(value)) if (entry !== undefined) count += 1;
  };
  for (const key of ['name', 'description', 'status', 'window', 'audience', 'minOrderQuantity', 'returnable', 'urlKey'] as const) {
    if (changes[key] !== undefined) count += 1;
  }
  countObject(changes.product);
  countObject(changes.attributes);
  for (const item of Object.values(changes.gallery?.items ?? {})) countObject(item);
  countObject(changes.gallery?.roles);
  for (const attachment of Object.values(changes.attachments ?? {})) countObject(attachment);
  for (const unit of Object.values(changes.packagingUnits ?? {})) countObject(unit);
  countObject(changes.seo);
  return count;
}

export const saveScopedValuesRequestSchema = z
  .object({
    scope: scopeRequestSchema,
    version: z.string().regex(/^\d{1,19}$/),
    changes: scopedValueChangesSchema,
  })
  .strict()
  .refine((body) => countChangedCells(body.changes) <= SCOPED_SAVE_CELLS_MAX, {
    message: `At most ${SCOPED_SAVE_CELLS_MAX} changed cells.`,
    path: ['changes'],
  });
export type SaveScopedValuesRequest = z.infer<typeof saveScopedValuesRequestSchema>;

export const saveScopedValuesResponseSchema = z.object({
  data: scopedValuesDataSchema,
  warnings: z.array(scopeWarningSchema),
});
export type SaveScopedValuesResponse = z.infer<typeof saveScopedValuesResponseSchema>;

// --- §4 Copy to channels ----------------------------------------------------------------------

export const copyScopedValueRequestSchema = z
  .object({
    field: fieldPathSchema,
    from: z.object({ channelId: uuidSchema, languageCode: z.string().min(1).max(16) }).strict(),
    toChannelIds: z.array(uuidSchema).min(1).max(SCOPED_COPY_TARGETS_MAX),
    version: z.string().regex(/^\d{1,19}$/),
    dryRun: z.boolean().optional(),
  })
  .strict();
export type CopyScopedValueRequest = z.infer<typeof copyScopedValueRequestSchema>;

export const copyScopedValueResponseSchema = z.object({
  data: z.object({
    /** Targets that hold an own value the copy overwrites. */
    overwrites: z.array(
      z.object({ channelId: uuidSchema, currentValue: z.union([z.object({ empty: z.literal(true) }), z.unknown()]) }),
    ),
    /** Cells written; 0 on a dry run. */
    applied: z.number().int().nonnegative(),
    version: z.string(),
  }),
});
export type CopyScopedValueResponse = z.infer<typeof copyScopedValueResponseSchema>;

// --- §5 Editor preference ---------------------------------------------------------------------
//
// `PUT` / `GET …/products/:id/editor-preference` keep the body of feature 022
// (`productEditorPreferenceRequestSchema` in `product-scope-overrides.ts`): `lastChannelId` `null`
// = Global, a channel without a language = Channel, both = Channel × language; a language without
// a channel is refused `422 VALIDATION_FAILED` by the route (data-model §10).

// --- Error details ----------------------------------------------------------------------------

/** `422 FIELD_NOT_AT_SCOPE` details. */
export const fieldNotAtScopeDetailsSchema = z.object({
  fields: z.array(z.object({ field: z.string(), levels: z.array(scopeLevelShortSchema) })),
});

/** `422 SCOPED_VALUE_INVALID` details. */
export const scopedValueInvalidDetailsSchema = z.object({
  fields: z.array(
    z.object({
      field: z.string(),
      scope: scopeRefSchema,
      reason: z.enum([
        'required_empty',
        'not_emptyable',
        'inherit_at_global',
        'source_inherits',
        'subject_not_found',
        'not_supported',
        'invalid',
      ]),
    }),
  ),
});
export type ScopedValueInvalidDetails = z.infer<typeof scopedValueInvalidDetailsSchema>;

/** `422 GLOBAL_ONLY_FIELD` details. */
export const globalOnlyFieldDetailsSchema = z.object({ fields: z.array(z.string()) });
