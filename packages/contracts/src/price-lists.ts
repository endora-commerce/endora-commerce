import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Pricing contracts.
 *
 * The shape evolved across two iterations. The legacy schemas
 * (`priceListItemSchema`, `priceListAssignmentSchema`,
 * `createPriceListItemRequestSchema`, `createPriceListAssignmentRequestSchema`,
 * `upsertPriceListRequestSchema`) come from feature 014 and are kept until
 * every consumer migrates to the feature-011 engine.
 *
 * The feature-011 schemas (`priceListEngineSchema`, `applicationRuleSchema`,
 * `priceListBracketSchema`, etc.) model the B2B pricing engine: multi-currency
 * multi-bracket prices per product, an Application Rule tree (AND/OR over
 * SC/CG/Org/Cat/Currency criteria), Base/Sale split, lifecycle status, and the
 * four-level price-display mode.
 */

const CURRENCY = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
const POSITIVE_INT = z.number().int().positive();
const DECIMAL_STRING = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'decimal as string with up to 4 fractional digits');

// --- Customer Group ---------------------------------------------------------

export const customerGroupSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomerGroup = z.infer<typeof customerGroupSchema>;

export const upsertCustomerGroupRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
});

// =============================================================================
// LEGACY (feature 014) — kept until every reader migrates to the engine schemas.
// =============================================================================

/** @deprecated Feature 014 shape. Migrate to `priceListEngineSchema`. */
export const priceListSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  currency: CURRENCY,
  isDefault: z.boolean(),
  priority: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PriceList = z.infer<typeof priceListSchema>;

/** @deprecated Feature 014. */
export const upsertPriceListRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  currency: CURRENCY,
  isDefault: z.boolean().optional(),
  priority: z.number().int().optional(),
});

/** @deprecated Feature 014. */
export const priceListItemModeSchema = z.enum([
  'fixed_unit',
  'percentage_off',
  'amount_off',
]);
export type PriceListItemMode = z.infer<typeof priceListItemModeSchema>;

/** @deprecated Feature 014. */
export const priceListItemSchema = z.object({
  id: uuidSchema,
  priceListId: uuidSchema,
  mode: priceListItemModeSchema,
  productId: uuidSchema.nullable(),
  variantId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  minQuantity: POSITIVE_INT,
  unitPrice: z.number().finite().nonnegative().nullable(),
  adjustmentValue: z.number().finite().nonnegative().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PriceListItem = z.infer<typeof priceListItemSchema>;

/** @deprecated Feature 014. */
export const createPriceListItemRequestSchema = z
  .object({
    mode: priceListItemModeSchema,
    productId: uuidSchema.nullable().optional(),
    variantId: uuidSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    minQuantity: POSITIVE_INT.optional(),
    unitPrice: z.number().finite().nonnegative().nullable().optional(),
    adjustmentValue: z.number().finite().nonnegative().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'fixed_unit') {
      if (value.productId == null) {
        ctx.addIssue({ code: 'custom', message: 'fixed_unit items require productId', path: ['productId'] });
      }
      if (value.unitPrice == null) {
        ctx.addIssue({ code: 'custom', message: 'fixed_unit items require unitPrice', path: ['unitPrice'] });
      }
    } else {
      if (value.categoryId == null) {
        ctx.addIssue({ code: 'custom', message: 'percentage_off / amount_off items require categoryId', path: ['categoryId'] });
      }
      if (value.adjustmentValue == null) {
        ctx.addIssue({ code: 'custom', message: 'percentage_off / amount_off items require adjustmentValue', path: ['adjustmentValue'] });
      }
      if (value.mode === 'percentage_off' && value.adjustmentValue != null) {
        if (value.adjustmentValue < 0 || value.adjustmentValue > 100) {
          ctx.addIssue({ code: 'custom', message: 'percentage_off adjustmentValue must be between 0 and 100', path: ['adjustmentValue'] });
        }
      }
    }
  });

/** @deprecated Feature 014. */
export const priceListAssignmentSchema = z.object({
  id: uuidSchema,
  priceListId: uuidSchema,
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  salesChannelId: uuidSchema.nullable(),
  isDefault: z.boolean(),
  priority: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PriceListAssignment = z.infer<typeof priceListAssignmentSchema>;

/** @deprecated Feature 014. */
export const createPriceListAssignmentRequestSchema = z
  .object({
    organizationId: uuidSchema.nullable().optional(),
    customerGroupId: uuidSchema.nullable().optional(),
    salesChannelId: uuidSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
    priority: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    const targets = [
      value.organizationId ? 'organizationId' : null,
      value.customerGroupId ? 'customerGroupId' : null,
      value.isDefault ? 'isDefault' : null,
    ].filter((t): t is string => t !== null);
    if (targets.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one of organizationId, customerGroupId, or isDefault=true must be set',
        path: ['organizationId'],
      });
    }
  });

// =============================================================================
// FEATURE 011 — pricing-engine schemas
// =============================================================================

// --- Application Rule AST ---------------------------------------------------

export const ruleCriterionTypeSchema = z.enum([
  'salesChannel',
  'customerGroup',
  'organization',
  'category',
  'currency',
]);
export type RuleCriterionType = z.infer<typeof ruleCriterionTypeSchema>;

const ruleCriterionNodeSchema = z.object({
  kind: z.literal('criterion'),
  type: ruleCriterionTypeSchema,
  values: z.array(z.string()).max(1000),
});

const ruleAllNodeSchema = z.object({ kind: z.literal('all') });

export type RuleAllNode = { kind: 'all' };
export type RuleCriterionNode = {
  kind: 'criterion';
  type: RuleCriterionType;
  values: string[];
};
export type RuleGroupNode = {
  kind: 'group';
  op: 'AND' | 'OR';
  children: ApplicationRule[];
};
export type ApplicationRule = RuleAllNode | RuleCriterionNode | RuleGroupNode;

const ruleNodeSchema: z.ZodType<ApplicationRule> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    ruleAllNodeSchema,
    ruleCriterionNodeSchema,
    z.object({
      kind: z.literal('group'),
      op: z.enum(['AND', 'OR']),
      children: z.array(ruleNodeSchema).min(1).max(20),
    }),
  ]),
);

function ruleDepth(node: ApplicationRule): number {
  if (node.kind !== 'group') return 0;
  return 1 + Math.max(...node.children.map(ruleDepth));
}

export const applicationRuleSchema = ruleNodeSchema.refine(
  (node) => ruleDepth(node) <= 5,
  { message: 'rule_depth_exceeds_5' },
);

// --- Price list (engine shape) ---------------------------------------------

export const priceListTypeSchema = z.enum(['base', 'sale']);
export type PriceListType = z.infer<typeof priceListTypeSchema>;

export const priceListStatusSchema = z.enum([
  'draft',
  'active',
  'scheduled',
  'expired',
]);
export type PriceListStatus = z.infer<typeof priceListStatusSchema>;

export const priceListEngineSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  type: priceListTypeSchema,
  status: priceListStatusSchema,
  startsAt: isoDateTimeSchema.nullable(),
  endsAt: isoDateTimeSchema.nullable(),
  applicationRule: applicationRuleSchema,
  isSystem: z.boolean(),
  modifiedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type PriceListEngine = z.infer<typeof priceListEngineSchema>;

export const createPriceListEngineRequestSchema = z.object({
  name: z.string().min(1).max(200),
  type: priceListTypeSchema,
  startsAt: isoDateTimeSchema.nullable().optional(),
  endsAt: isoDateTimeSchema.nullable().optional(),
  applicationRule: applicationRuleSchema.optional(),
});

export const patchPriceListEngineRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: priceListTypeSchema.optional(),
    startsAt: isoDateTimeSchema.nullable().optional(),
    endsAt: isoDateTimeSchema.nullable().optional(),
    applicationRule: applicationRuleSchema.optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    { message: 'patch_body_empty' },
  );

// --- Price brackets ---------------------------------------------------------

export const priceListBracketSchema = z.object({
  priceListId: uuidSchema,
  productId: uuidSchema,
  currencyCode: CURRENCY,
  minQuantity: POSITIVE_INT,
  maxQuantity: POSITIVE_INT.nullable(),
  amount: DECIMAL_STRING,
});
export type PriceListBracket = z.infer<typeof priceListBracketSchema>;

export const replaceBracketsRequestSchema = z.object({
  bracketsByCurrency: z.record(
    CURRENCY,
    z.array(
      z.object({
        minQuantity: POSITIVE_INT,
        maxQuantity: POSITIVE_INT.nullable(),
        amount: DECIMAL_STRING,
      }),
    ),
  ),
});

export const productAssignmentSchema = z.object({
  priceListId: uuidSchema,
  productId: uuidSchema,
  bracketsByCurrency: z.record(CURRENCY, z.array(priceListBracketSchema)),
});
export type ProductAssignment = z.infer<typeof productAssignmentSchema>;

export const replaceProductsRequestSchema = z.object({
  productIds: z.array(uuidSchema),
});

// --- Display modes ----------------------------------------------------------

export const displayModeSchema = z.enum([
  'gross_only',
  'net_only',
  'both',
  'none',
]);
export type DisplayMode = z.infer<typeof displayModeSchema>;

export const displayModeOverrideScopeSchema = z.enum([
  'organization',
  'category',
  'product',
]);
export type DisplayModeOverrideScope = z.infer<typeof displayModeOverrideScopeSchema>;

export const displayModeOverrideSchema = z.object({
  scope: displayModeOverrideScopeSchema,
  targetId: uuidSchema,
  mode: displayModeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DisplayModeOverride = z.infer<typeof displayModeOverrideSchema>;

export const upsertDisplayModeOverrideRequestSchema = z.object({
  mode: displayModeSchema.or(z.literal('inherit')),
});

// --- Resolved price (storefront/cart consumer) ------------------------------

/** @deprecated Feature 014 shape. Migrate to `resolvedPriceEngineSchema`. */
export const resolvedPriceSchema = z.object({
  unitPrice: moneySchema,
  basePrice: moneySchema,
  source: z.enum(['list', 'base']),
  priceListId: uuidSchema.nullable(),
  appliedItemId: uuidSchema.nullable(),
});
export type ResolvedPrice = z.infer<typeof resolvedPriceSchema>;

export const resolvedPriceEngineSchema = z.object({
  baseListId: uuidSchema,
  basePrice: moneySchema,
  saleListId: uuidSchema.nullable(),
  salePrice: moneySchema.nullable(),
  displayMode: displayModeSchema,
  currencyCode: CURRENCY,
  quantityBracket: z.object({
    minQuantity: POSITIVE_INT,
    maxQuantity: POSITIVE_INT.nullable(),
  }),
});
export type ResolvedPriceEngine = z.infer<typeof resolvedPriceEngineSchema>;

// --- Settings keys (also exposed via the settings manifest) -----------------

export const PRICING_SETTING_CODES = {
  DEFAULT_DISPLAY_MODE: 'pricing.default_display_mode',
  UNAUTHENTICATED_DISPLAY_MODE: 'pricing.unauthenticated_display_mode',
} as const;
