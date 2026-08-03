// Product Feed module — feature 067 contract surface.
// Single file with logical sections (matching the convention used by every
// other module in @b2b/contracts):
//   (1) Enumerations (provider, output format, granularity, run status, …).
//   (2) Scheduling primitives (cron expression, IANA timezone, schedule).
//   (3) The product-selection rule AST.
//   (4) Feed Template and template-field DTOs.
//   (5) Draft evaluation — template preview and selection match count.
//   (6) Product Feed DTOs (binding, schedule, token).
//   (7) Runs, issues and artefacts.
//   (8) Provider taxonomies and category mappings.
//   (9) The template portability envelope.
//  (10) Module error codes.
//  (11) Settings codes (Settings module, group `product_feeds`).

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { collectionEnvelope, dataEnvelope } from './envelopes.js';
import { listQuerySchema } from './pagination.js';

// ---------------------------------------------------------------------------
// (1) Enumerations
// ---------------------------------------------------------------------------

/** Providers the module knows how to shape output for. `custom` is operator-authored. */
export const feedProviderCodeSchema = z.enum([
  'google_merchant',
  'meta',
  'amazon',
  'ebay',
  'allegro',
  'custom',
]);
export type FeedProviderCode = z.infer<typeof feedProviderCodeSchema>;

/** Only Google and Meta publish a category taxonomy the module bundles (FR-077). */
export const taxonomyProviderCodeSchema = z.enum(['google_merchant', 'meta']);
export type TaxonomyProviderCode = z.infer<typeof taxonomyProviderCodeSchema>;

export const feedOutputFormatSchema = z.enum(['xml', 'csv', 'tsv']);
export type FeedOutputFormat = z.infer<typeof feedOutputFormatSchema>;

export const feedItemGranularitySchema = z.enum(['product', 'variant']);
export type FeedItemGranularity = z.infer<typeof feedItemGranularitySchema>;

export const feedPricePresentationSchema = z.enum(['net', 'gross']);
export type FeedPricePresentation = z.infer<typeof feedPricePresentationSchema>;

/**
 * Closed catalogue of value sources a template field may bind to (FR-003).
 *
 * `attribute` and `custom_field` are two names for one registry: since feature
 * 061 a product attribute IS a product-host Custom Field definition carrying a
 * catalog extension. Both are accepted so a document exported from either
 * vocabulary imports cleanly; both resolve through the same definitions read.
 */
export const feedFieldSourceKindSchema = z.enum([
  'product_id',
  'sku',
  'name',
  'description',
  'slug',
  'product_type',
  'brand',
  'attribute',
  'custom_field',
  'price',
  'sale_price',
  'availability',
  'stock_quantity',
  'link',
  'image_link',
  'additional_image_link',
  'category_path',
  'provider_category',
  'grouping_id',
  'constant',
]);
export type FeedFieldSourceKind = z.infer<typeof feedFieldSourceKindSchema>;

/** Closed transform list — deliberately not an expression language (FR-067). */
export const feedFieldTransformSchema = z.enum([
  'none',
  'upper',
  'lower',
  'trim',
  'truncate',
  'strip_html',
  'absolute_url',
]);
export type FeedFieldTransform = z.infer<typeof feedFieldTransformSchema>;

export const feedRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'completed_with_warnings',
  'empty',
  'failed',
  'skipped',
]);
export type FeedRunStatus = z.infer<typeof feedRunStatusSchema>;

export const feedRunTriggerSchema = z.enum(['manual', 'scheduled']);
export type FeedRunTrigger = z.infer<typeof feedRunTriggerSchema>;

/** Enumerated run-issue reasons (FR-054). Operator-facing labels come from i18n. */
export const feedRunIssueReasonSchema = z.enum([
  'missing_price',
  'missing_image',
  'private_image_asset',
  'missing_required_field',
  'missing_translation',
  'unresolvable_link',
  'unmapped_provider_category',
  'stale_provider_category_mapping',
  'unsupported_product_type',
  'zero_tax_rate_on_gross_feed',
]);
export type FeedRunIssueReason = z.infer<typeof feedRunIssueReasonSchema>;

export const feedRunFailureCodeSchema = z.enum([
  'unbound_template_fields',
  'unknown_attribute',
  'channel_unavailable',
  'price_list_unavailable',
  'language_unavailable',
  'skip_threshold_exceeded',
  'storage_unavailable',
  'worker_lost',
  'internal_error',
]);
export type FeedRunFailureCode = z.infer<typeof feedRunFailureCodeSchema>;

// ---------------------------------------------------------------------------
// (2) Scheduling primitives
// ---------------------------------------------------------------------------

/**
 * 5-field cron with minute granularity (FR-031). Validated here rather than by
 * a round-trip through Redis, so a bad expression never reaches the scheduler.
 * The runtime evaluation (next occurrence, DST) is BullMQ's, via the
 * `cron-parser` it already bundles — see research §R5.
 */
const CRON_FIELD = String.raw`(\*|[0-9]+|\*\/[0-9]+|[0-9]+(-[0-9]+)?(\/[0-9]+)?)(,([0-9]+|[0-9]+-[0-9]+)(\/[0-9]+)?)*`;
export const cronExpressionSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^${CRON_FIELD}( ${CRON_FIELD}){4}$`), 'invalid_cron_expression')
  .max(64);

/**
 * IANA timezone. Validated against the runtime's own tz database rather than a
 * hard-coded list, so it cannot drift from what the scheduler will accept.
 */
export const timezoneSchema = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'invalid_timezone' },
  );

export const feedScheduleSchema = z
  .object({
    cron: cronExpressionSchema,
    timezone: timezoneSchema,
  })
  .nullable();
export type FeedSchedule = z.infer<typeof feedScheduleSchema>;

// ---------------------------------------------------------------------------
// (2b) Cron helpers shared by the backend and the admin
//
// These live here, next to `cronExpressionSchema`, rather than inside the
// backend module because both sides need exactly them and duplicating them
// would guarantee drift: the backend refuses an out-of-range expression at save
// time, and the admin renders the live plain-language echo under the *Custom*
// input from the same grammar (FR-031, ux-design §2.2).
//
// Nothing here evaluates cron. There is no `cron-parser` import — it is a
// transitive dependency of BullMQ and not resolvable from `backend/` under
// pnpm, and hand-rolled next-occurrence arithmetic is the classic way to break
// a scheduler across a DST transition. Next-occurrence is BullMQ's, read back
// from `getJobSchedulers()` (research §R5, §R5.5).
// ---------------------------------------------------------------------------

/** Inclusive value range of each cron field, in field order. */
const FIELD_RANGES: ReadonlyArray<{ name: string; min: number; max: number }> = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  // 0 and 7 both mean Sunday, which is why the ceiling is 7 and not 6.
  { name: 'dayOfWeek', min: 0, max: 7 },
];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export interface SchedulePreset {
  id: string;
  cron: string;
}

/**
 * The presets the admin `Select` offers (ux-design §2.2 — "never make a
 * merchandiser write cron"). Short on purpose: a preset list long enough to
 * need scanning is a cron field with extra steps. Anything else is *Custom*.
 */
export const SCHEDULE_PRESETS: ReadonlyArray<SchedulePreset> = [
  { id: 'hourly', cron: '0 * * * *' },
  { id: 'every4Hours', cron: '0 */4 * * *' },
  { id: 'daily', cron: '0 3 * * *' },
];

/** The preset a cron expression corresponds to, or null when it is custom. */
export function presetForCron(cron: string): string | null {
  const normalized = cron.trim().replace(/\s+/g, ' ');
  return SCHEDULE_PRESETS.find((preset) => preset.cron === normalized)?.id ?? null;
}

export function isValidTimezone(timezone: string): boolean {
  return timezoneSchema.safeParse(timezone).success && timezone.trim() !== '';
}

/**
 * Grammar (the contract's regex) **and** field ranges. Both, because a
 * grammatically valid expression that can never fire is the worse failure: the
 * operator sees a saved schedule and no runs.
 */
export function isValidCronExpression(expression: string): boolean {
  if (!cronExpressionSchema.safeParse(expression).success) return false;
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== FIELD_RANGES.length) return false;
  return fields.every((field, index) => fieldInRange(field, FIELD_RANGES[index]!));
}

function fieldInRange(field: string, range: { min: number; max: number }): boolean {
  for (const term of field.split(',')) {
    // `*`, `a`, `a-b`, `*/n`, `a/n`, `a-b/n` — the grammar the contract accepts.
    const [values, step] = term.split('/');
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) === 0)) return false;
    if (values === '*' || values === undefined) continue;
    const bounds = values.split('-');
    if (bounds.length > 2) return false;
    for (const bound of bounds) {
      if (!/^\d+$/.test(bound)) return false;
      const value = Number(bound);
      if (value < range.min || value > range.max) return false;
    }
    if (bounds.length === 2 && Number(bounds[0]) > Number(bounds[1]!)) return false;
  }
  return true;
}

/**
 * The sentence rendered live under the *Custom* input (ux-design §2.2).
 *
 * Returns `null` for an invalid expression so the caller shows
 * `feeds.schedule.invalid` instead — an echo and an error must never be on
 * screen at once. For a valid expression it always returns *something*: the
 * shapes the presets produce get real prose, and anything else gets the
 * expression back verbatim. Echoing the input is honest; an empty line under a
 * valid expression reads like a rejection.
 */
export function describeCronExpression(expression: string): string | null {
  if (!isValidCronExpression(expression)) return null;
  const normalized = expression.trim().replace(/\s+/g, ' ');
  const [minute, hour, dayOfMonth, month, dayOfWeek] = normalized.split(' ') as [
    string,
    string,
    string,
    string,
    string,
  ];

  const everyDay = dayOfMonth === '*' && month === '*';
  const dayClause = describeDayOfWeek(dayOfWeek);

  const everyNMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyNMinutes && hour === '*' && everyDay && dayClause === null) {
    return `Every ${everyNMinutes[1]} minutes`;
  }

  const everyNHours = /^\*\/(\d+)$/.exec(hour);
  if (everyNHours && /^\d+$/.test(minute) && everyDay && dayClause === null) {
    return `Every ${everyNHours[1]} hours, at minute ${Number(minute)}`;
  }

  if (hour === '*' && /^\d+$/.test(minute) && everyDay && dayClause === null) {
    return `Every hour, at minute ${Number(minute)}`;
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && everyDay) {
    const at = `${pad(Number(hour))}:${pad(Number(minute))}`;
    return dayClause === null ? `Every day at ${at}` : `At ${at}, ${dayClause}`;
  }

  return normalized;
}

/** `null` means "every day", which the callers phrase themselves. */
function describeDayOfWeek(field: string): string | null {
  if (field === '*') return null;
  const range = /^(\d)-(\d)$/.exec(field);
  if (range) {
    return `${DAY_NAMES[Number(range[1])]} to ${DAY_NAMES[Number(range[2])]}`;
  }
  if (/^\d$/.test(field)) return `on ${DAY_NAMES[Number(field)]}`;
  // A list (`1,3,5`) has no short natural phrasing that stays unambiguous, so
  // the caller falls back to echoing the whole expression.
  return field;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// (3) Product-selection rule AST
//
// Same node shape as the promotion rule AST (`all | condition | group`, depth
// <= 5) but over a PRODUCT field catalogue. Deliberately a separate schema:
// reusing `promotionRuleSchema` would offer `cartTotal` / `paymentMethod` as
// product filters, which is meaningless to the operator and unenforceable
// server-side. See research §R9.
// ---------------------------------------------------------------------------

export const productSelectionOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'isSet',
  'isNotSet',
]);
export type ProductSelectionOp = z.infer<typeof productSelectionOpSchema>;

/** Built-in, product-context fields the criteria builder offers (FR-025). */
export const productSelectionBuiltinFieldSchema = z.enum([
  'category',
  'productType',
  'status',
  'stockState',
  'price',
  'brand',
  'createdAt',
  'updatedAt',
]);
export type ProductSelectionBuiltinField = z.infer<typeof productSelectionBuiltinFieldSchema>;

const definitionKeyRe = /^[a-z][a-z0-9_]{0,63}$/;

export const productSelectionFieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), key: productSelectionBuiltinFieldSchema }),
  z.object({
    kind: z.literal('attribute'),
    attributeKey: z.string().regex(definitionKeyRe, 'invalid_attribute_key'),
  }),
  z.object({
    kind: z.literal('customField'),
    fieldKey: z.string().regex(definitionKeyRe, 'invalid_custom_field_key'),
  }),
]);
export type ProductSelectionField = z.infer<typeof productSelectionFieldSchema>;

export const productSelectionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ProductSelectionValue = z.infer<typeof productSelectionValueSchema>;

export type ProductSelectionAll = { kind: 'all' };
export type ProductSelectionCondition = {
  kind: 'condition';
  field: ProductSelectionField;
  op: ProductSelectionOp;
  values: ProductSelectionValue[];
};
export type ProductSelectionGroup = {
  kind: 'group';
  op: 'AND' | 'OR';
  children: ProductSelectionRule[];
};
export type ProductSelectionRule =
  | ProductSelectionAll
  | ProductSelectionCondition
  | ProductSelectionGroup;

const productSelectionNodeSchema: z.ZodType<ProductSelectionRule> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({
      kind: z.literal('condition'),
      field: productSelectionFieldSchema,
      op: productSelectionOpSchema,
      values: z.array(productSelectionValueSchema).max(1000),
    }),
    z.object({
      kind: z.literal('group'),
      op: z.enum(['AND', 'OR']),
      children: z.array(productSelectionNodeSchema).min(1).max(20),
    }),
  ]),
);

export function productSelectionDepth(node: ProductSelectionRule): number {
  if (node.kind !== 'group') return 0;
  return 1 + Math.max(0, ...node.children.map(productSelectionDepth));
}

/** `{ kind: 'all' }` is the canonical "whole channel catalogue" (FR-024). */
export const productSelectionRuleSchema = productSelectionNodeSchema.refine(
  (node) => productSelectionDepth(node) <= 5,
  { message: 'rule_depth_exceeds_5' },
);

// ---------------------------------------------------------------------------
// (4) Feed Template
// ---------------------------------------------------------------------------

export const feedTemplateFieldSchema = z.object({
  id: uuidSchema,
  outputName: z.string().min(1).max(128),
  sourceKind: feedFieldSourceKindSchema,
  sourceKey: z.string().max(128).nullable(),
  constantValue: z.string().max(2048).nullable(),
  fallbackValue: z.string().max(2048).nullable(),
  providerRequired: z.boolean(),
  transform: feedFieldTransformSchema.nullable(),
  transformArg: z.string().max(64).nullable(),
  sortOrder: z.number().int().nonnegative(),
  /**
   * Optional translation key for the one-sentence "gloss" the editor shows under
   * the output name (ux-design §3.3, SC-013). Resolved in the `product_feeds`
   * i18n namespace, so it ships in `en` + `pl` like every other operator string.
   *
   * Only the predefined templates set it — the platform explains `availability`
   * and `gtin`, and must NOT invent meaning for an operator's own field name.
   * A duplicate of a system template inherits it, which is the common path into
   * the editor.
   */
  helpKey: z.string().max(128).nullable(),
  /** True when an import could not resolve `sourceKey` locally (FR-015). Blocks generation (FR-016). */
  unbound: z.boolean(),
});
export type FeedTemplateField = z.infer<typeof feedTemplateFieldSchema>;

const feedTemplateFieldWriteObject = z.object({
  outputName: z.string().trim().min(1).max(128),
  sourceKind: feedFieldSourceKindSchema,
  sourceKey: z.string().max(128).nullable().optional(),
  constantValue: z.string().max(2048).nullable().optional(),
  fallbackValue: z.string().max(2048).nullable().optional(),
  providerRequired: z.boolean().optional(),
  transform: feedFieldTransformSchema.nullable().optional(),
  transformArg: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  helpKey: z.string().max(128).nullable().optional(),
});

/** Cross-field rules that FR-009 requires to be refused at save time. */
export const feedTemplateFieldWriteSchema = feedTemplateFieldWriteObject
  .refine((f) => (f.sourceKind === 'constant') === (f.constantValue != null), {
    message: 'constant_value_required_for_constant_source',
    path: ['constantValue'],
  })
  .refine(
    (f) => !['attribute', 'custom_field'].includes(f.sourceKind) || (f.sourceKey ?? '') !== '',
    { message: 'source_key_required', path: ['sourceKey'] },
  );
export type FeedTemplateFieldWrite = z.infer<typeof feedTemplateFieldWriteSchema>;

export const feedTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  providerCode: feedProviderCodeSchema,
  outputFormat: feedOutputFormatSchema,
  itemGranularity: feedItemGranularitySchema,
  taxonomyProviderCode: taxonomyProviderCodeSchema.nullable(),
  /** Predefined templates are read-only; the admin offers duplication instead (FR-008). */
  isSystem: z.boolean(),
  systemCode: z.string().max(32).nullable(),
  fields: z.array(feedTemplateFieldSchema),
  /** Number of feeds referencing this template — drives the delete refusal message (FR-010). */
  usedByFeedCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FeedTemplate = z.infer<typeof feedTemplateSchema>;

export const createFeedTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  providerCode: feedProviderCodeSchema.default('custom'),
  outputFormat: feedOutputFormatSchema.default('xml'),
  itemGranularity: feedItemGranularitySchema.default('product'),
  taxonomyProviderCode: taxonomyProviderCodeSchema.nullable().optional(),
  fields: z.array(feedTemplateFieldWriteSchema).max(200).default([]),
});
export type CreateFeedTemplateRequest = z.infer<typeof createFeedTemplateRequestSchema>;

/**
 * Full replacement of the field list — the structure editor saves the whole
 * ordered list, so reordering, renaming, adding and removing are one atomic,
 * single-audit-entry operation rather than a burst of per-field PATCHes.
 *
 * The four defaulted keys are re-declared without their defaults for the same
 * reason `updateProductFeedRequestSchema` does: `z.object().partial()` makes a
 * key optional but does **not** remove its `.default()`. A save that only
 * renamed a template would otherwise arrive carrying `providerCode: 'custom'`,
 * `outputFormat: 'xml'`, `itemGranularity: 'product'` and an empty `fields`
 * array — silently rewriting a Google per-variant XML template into a custom
 * per-product one, and emptying its field list.
 */
export const updateFeedTemplateRequestSchema = createFeedTemplateRequestSchema
  .omit({
    providerCode: true,
    outputFormat: true,
    itemGranularity: true,
    fields: true,
  })
  .partial()
  .extend({
    providerCode: feedProviderCodeSchema.optional(),
    outputFormat: feedOutputFormatSchema.optional(),
    itemGranularity: feedItemGranularitySchema.optional(),
    fields: z.array(feedTemplateFieldWriteSchema).max(200).optional(),
  });
export type UpdateFeedTemplateRequest = z.infer<typeof updateFeedTemplateRequestSchema>;

export const duplicateFeedTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type DuplicateFeedTemplateRequest = z.infer<typeof duplicateFeedTemplateRequestSchema>;

export const feedTemplateResponseSchema = dataEnvelope(feedTemplateSchema);
export const feedTemplateListResponseSchema = collectionEnvelope(
  feedTemplateSchema.omit({ fields: true }),
);

// ---------------------------------------------------------------------------
// (4b) Guided binding catalogue (FR-070)
//
// The editor's source picker renders EXACTLY this. It is a server-built list of
// what exists on THIS installation, which is what lets the operator choose a
// source instead of typing an internal key, a column name or a path.
// ---------------------------------------------------------------------------

/** Why a group exists, so the editor can order and head the picker's sections. */
export const feedFieldSourceGroupKindSchema = z.enum([
  'product_property',
  'price_and_stock',
  'attribute',
  'custom_field',
  'computed',
  'constant',
]);
export type FeedFieldSourceGroupKind = z.infer<typeof feedFieldSourceGroupKindSchema>;

export const feedFieldSourceSchema = z.object({
  sourceKind: feedFieldSourceKindSchema,
  /** Set only for `attribute` / `custom_field`; the definition key, never a uuid. */
  sourceKey: z.string().max(128).nullable().default(null),
  /** Platform-owned sources are labelled from the module bundle… */
  labelKey: z.string().max(128).nullable().default(null),
  /** …operator-owned ones carry the definition's own label, already localized. */
  label: z.string().max(200).nullable().default(null),
  description: z.string().max(500).nullable().default(null),
  /** Definition value type, so the editor can hint at what a binding will produce. */
  valueType: z.string().max(32).nullable().default(null),
  /**
   * True for `provider_category`: a template declaring no taxonomy must not
   * offer it (FR-082). The editor renders it disabled WITH the reason rather
   * than hiding it, so the operator learns the rule instead of wondering.
   */
  requiresTaxonomy: z.boolean().default(false),
  /**
   * Some sources cannot be expressed in every output format (repeated values in
   * a single CSV column). Carried per source so the editor explains rather than
   * filters (ux-design §3.2).
   */
  unsupportedInFormats: z.array(feedOutputFormatSchema).default([]),
});
export type FeedFieldSource = z.infer<typeof feedFieldSourceSchema>;

export const feedFieldSourceCatalogueSchema = z.object({
  groups: z.array(
    z.object({
      kind: feedFieldSourceGroupKindSchema,
      sources: z.array(feedFieldSourceSchema),
    }),
  ),
});
export type FeedFieldSourceCatalogue = z.infer<typeof feedFieldSourceCatalogueSchema>;

export const feedFieldSourceCatalogueResponseSchema = dataEnvelope(feedFieldSourceCatalogueSchema);

// ---------------------------------------------------------------------------
// (5) Draft evaluation — template preview and selection match count
//
// BOTH endpoints evaluate an UNSAVED, in-editor body. Resolving a preview by a
// persisted template id would force the operator to save broken intermediate
// states just to see a value, which puts SC-013 ("a working template in under
// 15 minutes, unaided") out of reach. The draft is the input; a persisted
// record is at most an optional base. Both are strictly side-effect-free: no
// run row, no issue row, no artefact, no audit entry.
// ---------------------------------------------------------------------------

/** The template exactly as it stands on screen — no id, possibly invalid. */
export const feedTemplateDraftSchema = z.object({
  providerCode: feedProviderCodeSchema,
  outputFormat: feedOutputFormatSchema,
  itemGranularity: feedItemGranularitySchema,
  taxonomyProviderCode: taxonomyProviderCodeSchema.nullable(),
  fields: z.array(feedTemplateFieldWriteSchema).max(200),
});
export type FeedTemplateDraft = z.infer<typeof feedTemplateDraftSchema>;

/** The resolution context. Every part is optional; the server fills the rest. */
export const feedPreviewContextSchema = z.object({
  /** Prefill everything from an existing feed (the editor's default when one exists). */
  productFeedId: uuidSchema.optional(),
  salesChannelId: uuidSchema.optional(),
  languageCode: z.string().max(12).optional(),
  currencyCode: z.string().length(3).optional(),
  priceListId: uuidSchema.nullable().optional(),
  pricePresentation: feedPricePresentationSchema.optional(),
  taxCountry: z.string().length(2).optional(),
});
export type FeedPreviewContext = z.infer<typeof feedPreviewContextSchema>;

export const feedTemplatePreviewRequestSchema = z.object({
  /**
   * Optional persisted template the draft was derived from. Used ONLY to
   * inherit settings the draft omits and to resolve `helpKey`s; the draft's
   * own values always win. Absent for a never-saved template.
   */
  baseTemplateId: uuidSchema.optional(),
  draft: feedTemplateDraftSchema,
  context: feedPreviewContextSchema.default({}),
  /** The sample product (and optionally variant) the operator picked. */
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
});
export type FeedTemplatePreviewRequest = z.infer<typeof feedTemplatePreviewRequestSchema>;

export const feedTemplatePreviewFieldSchema = z.object({
  outputName: z.string(),
  /** Null means the field would be absent from the emitted item. */
  value: z.string().nullable(),
  /** How the value was obtained, so the operator can see a fallback doing the work. */
  resolvedFrom: z.enum(['source', 'fallback', 'omitted']),
  /** Set when this field alone would cause the item to be skipped (FR-072). */
  wouldSkipItem: z.boolean(),
  issueReason: feedRunIssueReasonSchema.nullable(),
  /**
   * A draft may reference an attribute or custom field that does not exist —
   * the operator is mid-edit, or imported a template (FR-015). The preview
   * reports it as a field-level fact; it is never a request failure.
   */
  unbound: z.boolean(),
  /** Gloss key for this field, from the draft or inherited from `baseTemplateId`. */
  helpKey: z.string().nullable(),
});

export const feedTemplatePreviewResponseSchema = dataEnvelope(
  z.object({
    fields: z.array(feedTemplatePreviewFieldSchema),
    wouldEmitItem: z.boolean(),
    /** Populates the verdict banner: why this product would be left out. */
    skipReason: feedRunIssueReasonSchema.nullable(),
    /** The serialized item exactly as it would appear in the file. */
    renderedItem: z.string(),
    /** The context actually used, after server-side defaulting — the editor shows it. */
    resolvedContext: z.object({
      salesChannelId: uuidSchema,
      languageCode: z.string(),
      currencyCode: z.string(),
      priceListId: uuidSchema.nullable(),
      pricePresentation: feedPricePresentationSchema,
      taxCountry: z.string().nullable(),
    }),
  }),
);

// ---------------------------------------------------------------------------
// (6) Product Feed
// ---------------------------------------------------------------------------

export const productFeedTokenSchema = z.object({
  /** Non-secret display fragment. The plaintext is returned ONCE, on create/rotate. */
  prefix: z.string().max(12).nullable(),
  rotatedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  /** Fully-qualified public URL, or null when revoked (FR-047). */
  url: z.string().url().nullable(),
});

export const productFeedRunSummarySchema = z.object({
  id: uuidSchema,
  status: feedRunStatusSchema,
  trigger: feedRunTriggerSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  emittedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  failureCode: feedRunFailureCodeSchema.nullable(),
});
export type ProductFeedRunSummary = z.infer<typeof productFeedRunSummarySchema>;

export const productFeedSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(160),
  feedTemplateId: uuidSchema,
  feedTemplateName: z.string(),
  salesChannelId: uuidSchema,
  salesChannelCode: z.string(),
  languageCode: z.string().max(12),
  currencyCode: z.string().length(3),
  priceListId: uuidSchema.nullable(),
  pricePresentation: feedPricePresentationSchema,
  taxCountry: z.string().length(2).nullable(),
  selectionRule: productSelectionRuleSchema,
  schedule: feedScheduleSchema,
  enabled: z.boolean(),
  token: productFeedTokenSchema,
  lastRun: productFeedRunSummarySchema.nullable(),
  nextRunAt: isoDateTimeSchema.nullable(),
  publishedArtefactId: uuidSchema.nullable(),
  publishedItemCount: z.number().int().nonnegative().nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  /** True while a run holds the claim — the admin disables "Generate" on it (FR-033). */
  isRunning: z.boolean(),
  /** Set when the rolling average run duration exceeds half the schedule interval. */
  scheduleTooTightWarning: z.boolean(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ProductFeed = z.infer<typeof productFeedSchema>;

const productFeedWriteObject = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'invalid_slug')
    .max(160),
  feedTemplateId: uuidSchema,
  salesChannelId: uuidSchema,
  languageCode: z.string().min(2).max(12),
  currencyCode: z.string().length(3),
  priceListId: uuidSchema.nullable().optional(),
  pricePresentation: feedPricePresentationSchema.default('gross'),
  taxCountry: z.string().length(2).nullable().optional(),
  selectionRule: productSelectionRuleSchema.default({ kind: 'all' }),
  schedule: feedScheduleSchema.default(null),
  enabled: z.boolean().default(true),
});

export const createProductFeedRequestSchema = productFeedWriteObject.refine(
  (f) => f.pricePresentation !== 'gross' || (f.taxCountry ?? '') !== '',
  { message: 'tax_country_required_for_gross_prices', path: ['taxCountry'] },
);
export type CreateProductFeedRequest = z.infer<typeof createProductFeedRequestSchema>;

/**
 * A PATCH carries only what the operator changed.
 *
 * The defaulted keys are re-declared without their defaults on purpose:
 * `z.object().partial()` makes a key optional but does **not** remove its
 * `.default()`, so a plain `.partial()` would inject `pricePresentation:
 * 'gross'`, `selectionRule: {kind:'all'}`, `schedule: null` and `enabled: true`
 * into every PATCH body. Renaming a feed would then silently flip it to gross
 * prices (and fail cross-field validation for want of a `taxCountry`), reset
 * its criteria and drop its schedule.
 */
export const updateProductFeedRequestSchema = productFeedWriteObject
  .omit({
    pricePresentation: true,
    selectionRule: true,
    schedule: true,
    enabled: true,
  })
  .partial()
  .extend({
    pricePresentation: feedPricePresentationSchema.optional(),
    selectionRule: productSelectionRuleSchema.optional(),
    schedule: feedScheduleSchema.optional(),
    enabled: z.boolean().optional(),
  });
export type UpdateProductFeedRequest = z.infer<typeof updateProductFeedRequestSchema>;

export const duplicateProductFeedRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(160),
  languageCode: z.string().min(2).max(12).optional(),
  currencyCode: z.string().length(3).optional(),
});
export type DuplicateProductFeedRequest = z.infer<typeof duplicateProductFeedRequestSchema>;

export const productFeedResponseSchema = dataEnvelope(productFeedSchema);
export const productFeedListResponseSchema = collectionEnvelope(productFeedSchema);

/** Returned exactly once, on create and on rotate. Never re-readable (FR-047). */
export const productFeedTokenIssuedResponseSchema = dataEnvelope(
  z.object({
    token: z.string(),
    url: z.string().url(),
    prefix: z.string(),
    rotatedAt: isoDateTimeSchema,
  }),
);

/**
 * Match count for a criteria set **before saving** (FR-028).
 *
 * Draft-shaped by construction: it takes a channel and a rule, never a feed id,
 * so the count works on `/product-feeds/new` where no feed exists yet and on an
 * edited-but-unsaved criteria panel. Side-effect-free.
 */
export const productSelectionPreviewRequestSchema = z.object({
  salesChannelId: uuidSchema,
  selectionRule: productSelectionRuleSchema,
});
export const productSelectionPreviewResponseSchema = dataEnvelope(
  z.object({
    matchedCount: z.number().int().nonnegative(),
    /** A handful of matched products so the operator can sanity-check the rule. */
    sample: z.array(z.object({ id: uuidSchema, sku: z.string(), name: z.string() })).max(10),
  }),
);

// ---------------------------------------------------------------------------
// (7) Runs, issues, artefacts
// ---------------------------------------------------------------------------

export const feedRunIssueSchema = z.object({
  id: uuidSchema,
  severity: z.enum(['skip', 'warning']),
  reason: feedRunIssueReasonSchema,
  productId: uuidSchema.nullable(),
  variantId: uuidSchema.nullable(),
  sku: z.string().max(64).nullable(),
  outputName: z.string().max(128).nullable(),
  detail: z.string().max(255).nullable(),
});
export type FeedRunIssue = z.infer<typeof feedRunIssueSchema>;

export const feedRunSchema = productFeedRunSummarySchema.extend({
  productFeedId: uuidSchema,
  triggeredByAdminUserId: uuidSchema.nullable(),
  consideredCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  failureDetail: z.string().nullable(),
  skipReason: z.enum(['already_running', 'feed_disabled']).nullable(),
  issueOverflow: z.boolean(),
  artefact: z
    .object({
      id: uuidSchema,
      byteSize: z.number().int().nonnegative(),
      itemCount: z.number().int().nonnegative(),
      contentType: z.string(),
      producedAt: isoDateTimeSchema,
      isPublished: z.boolean(),
    })
    .nullable(),
  createdAt: isoDateTimeSchema,
});
export type FeedRun = z.infer<typeof feedRunSchema>;

export const feedRunResponseSchema = dataEnvelope(feedRunSchema);
export const feedRunListResponseSchema = collectionEnvelope(feedRunSchema);
export const feedRunIssueListResponseSchema = collectionEnvelope(feedRunIssueSchema);

export const feedRunListQuerySchema = listQuerySchema.extend({
  status: feedRunStatusSchema.optional(),
});

/** Accepted-and-enqueued acknowledgement; the work never runs inline (FR-032). */
export const startFeedRunResponseSchema = dataEnvelope(
  z.object({
    runId: uuidSchema,
    status: z.literal('queued'),
  }),
);

// ---------------------------------------------------------------------------
// (8) Provider taxonomies and category mappings
// ---------------------------------------------------------------------------

export const feedTaxonomySchema = z.object({
  providerCode: taxonomyProviderCodeSchema,
  revision: z.string().max(32),
  nodeCount: z.number().int().nonnegative(),
  installedAt: isoDateTimeSchema,
});
export type FeedTaxonomy = z.infer<typeof feedTaxonomySchema>;

export const feedTaxonomyNodeSchema = z.object({
  externalId: z.string().max(32),
  parentExternalId: z.string().max(32).nullable(),
  label: z.string(),
  fullPath: z.string(),
  depth: z.number().int().nonnegative(),
});
export type FeedTaxonomyNode = z.infer<typeof feedTaxonomyNodeSchema>;

export const feedTaxonomyNodeSearchQuerySchema = listQuerySchema.extend({
  providerCode: taxonomyProviderCodeSchema,
  /** Free-text over the localized full path. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Label language; defaults to the administrator's admin language. */
  lang: z.string().min(2).max(12).optional(),
});

export const feedTaxonomyMappingSchema = z.object({
  categoryId: uuidSchema,
  categoryName: z.string(),
  categoryDepth: z.number().int().nonnegative(),
  /** Null when neither this category nor any ancestor is mapped (FR-080). */
  nodeExternalId: z.string().max(32).nullable(),
  nodeFullPath: z.string().nullable(),
  /** Where the value came from — 'explicit' | 'inherited' | 'none' (FR-080). */
  origin: z.enum(['explicit', 'inherited', 'none']),
  /** For 'inherited', the ancestor the value came from. */
  inheritedFromCategoryId: uuidSchema.nullable(),
  inheritedFromCategoryName: z.string().nullable(),
  /** The mapped node vanished in the installed revision; kept, flagged (FR-085). */
  stale: z.boolean(),
});
export type FeedTaxonomyMapping = z.infer<typeof feedTaxonomyMappingSchema>;

export const setFeedTaxonomyMappingRequestSchema = z.object({
  providerCode: taxonomyProviderCodeSchema,
  categoryId: uuidSchema,
  /** Null clears the explicit mapping so the category inherits again. */
  nodeExternalId: z.string().max(32).nullable(),
});
export type SetFeedTaxonomyMappingRequest = z.infer<typeof setFeedTaxonomyMappingRequestSchema>;

export const feedTaxonomyMappingListResponseSchema = collectionEnvelope(feedTaxonomyMappingSchema);

/** Coverage summary shown above the mapping surface (FR-079). */
export const feedTaxonomyCoverageResponseSchema = dataEnvelope(
  z.object({
    providerCode: taxonomyProviderCodeSchema,
    revision: z.string(),
    totalCategories: z.number().int().nonnegative(),
    explicitlyMapped: z.number().int().nonnegative(),
    coveredByInheritance: z.number().int().nonnegative(),
    uncovered: z.number().int().nonnegative(),
    staleMappings: z.number().int().nonnegative(),
  }),
);

// ---------------------------------------------------------------------------
// (9) Template portability envelope (FR-012 – FR-018)
// ---------------------------------------------------------------------------

export const FEED_TEMPLATE_DOCUMENT_FORMAT_VERSION = 1;

/**
 * Deliberately carries NO uuid, NO timestamp, NO feed binding and NO secret, so
 * two exports of an unchanged template are byte-identical (FR-013). Bindings
 * travel as stable definition KEYS, which is what makes cross-installation
 * import resolvable at all.
 */
export const feedTemplateDocumentSchema = z.object({
  formatVersion: z.literal(FEED_TEMPLATE_DOCUMENT_FORMAT_VERSION),
  template: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    providerCode: feedProviderCodeSchema,
    outputFormat: feedOutputFormatSchema,
    itemGranularity: feedItemGranularitySchema,
    taxonomyProviderCode: taxonomyProviderCodeSchema.nullable(),
    /**
     * Bounded by the same ceiling as `createFeedTemplateRequestSchema.fields`.
     * A document is untrusted input from another installation, so the size of
     * what an import may insert in one transaction is decided here, before any
     * of it is read.
     */
    fields: z
      .array(
        z.object({
          outputName: z.string().min(1).max(128),
          sourceKind: feedFieldSourceKindSchema,
          sourceKey: z.string().max(128).nullable(),
          constantValue: z.string().max(2048).nullable(),
          fallbackValue: z.string().max(2048).nullable(),
          providerRequired: z.boolean(),
          transform: feedFieldTransformSchema.nullable(),
          transformArg: z.string().max(64).nullable(),
          sortOrder: z.number().int().nonnegative(),
          /**
           * Travels with the document: it is a key into the `product_feeds` i18n
           * namespace, which ships with the module on every installation, so a
           * Google-derived template keeps its glosses after a cross-installation
           * import. An unknown key renders as no gloss, never as a raw key.
           */
          helpKey: z.string().max(128).nullable(),
        }),
      )
      .max(200),
  }),
});
export type FeedTemplateDocument = z.infer<typeof feedTemplateDocumentSchema>;

export const importFeedTemplateRequestSchema = z.object({
  document: feedTemplateDocumentSchema,
  /** Required when the name collides with an existing template (FR-017). */
  onNameConflict: z.enum(['create_copy', 'replace']).optional(),
});
export type ImportFeedTemplateRequest = z.infer<typeof importFeedTemplateRequestSchema>;

export const importFeedTemplateResponseSchema = dataEnvelope(
  z.object({
    template: feedTemplateSchema,
    /** Fields whose source key does not exist locally; imported as unbound (FR-015). */
    unresolvedBindings: z.array(
      z.object({
        outputName: z.string(),
        sourceKind: feedFieldSourceKindSchema,
        sourceKey: z.string(),
      }),
    ),
  }),
);

// ---------------------------------------------------------------------------
// (10) Module error codes
// ---------------------------------------------------------------------------

export const PRODUCT_FEED_ERROR_CODES = {
  TEMPLATE_IS_SYSTEM: 'template_is_system',
  TEMPLATE_IN_USE: 'template_in_use',
  DUPLICATE_OUTPUT_NAME: 'duplicate_output_name',
  UNBOUND_TEMPLATE_FIELDS: 'unbound_template_fields',
  TAXONOMY_REQUIRED_FOR_PROVIDER_CATEGORY: 'taxonomy_required_for_provider_category',
  GROUPING_FIELD_REQUIRED_FOR_VARIANT_GRANULARITY:
    'grouping_field_required_for_variant_granularity',
  FEED_ALREADY_RUNNING: 'feed_already_running',
  FEED_DISABLED: 'feed_disabled',
  TOKEN_REVOKED: 'token_revoked',
  TEMPLATE_NAME_CONFLICT: 'template_name_conflict',
  INVALID_TEMPLATE_DOCUMENT: 'invalid_template_document',
  UNKNOWN_TAXONOMY_NODE: 'unknown_taxonomy_node',
} as const;
export type ProductFeedErrorCode =
  (typeof PRODUCT_FEED_ERROR_CODES)[keyof typeof PRODUCT_FEED_ERROR_CODES];

// ---------------------------------------------------------------------------
// (11) Settings codes (Settings module, group `product_feeds`)
// ---------------------------------------------------------------------------

export const PRODUCT_FEED_SETTING_CODES = {
  ARTEFACT_RETENTION_COUNT: 'product_feeds.artefact_retention_count',
  MAX_CONCURRENT_RUNS: 'product_feeds.max_concurrent_runs',
  SKIP_SHARE_FAILURE_THRESHOLD: 'product_feeds.skip_share_failure_threshold',
  STALE_CLAIM_TIMEOUT_MINUTES: 'product_feeds.stale_claim_timeout_minutes',
  RUN_ISSUE_CAP: 'product_feeds.run_issue_cap',
  PUBLIC_FETCH_RATE_LIMIT_PER_MINUTE: 'product_feeds.public_fetch_rate_limit_per_minute',
  /** Above this many shop categories the mapping surface switches from tree to paged flat list. */
  CATEGORY_MAPPING_TREE_LIMIT: 'product_feeds.category_mapping_tree_limit',
} as const;
