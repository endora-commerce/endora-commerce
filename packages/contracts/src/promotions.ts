import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Promotion contracts (T129, T132 / FR-052).
 *
 * Three kinds shipped in this slice:
 *   - `percentage_off` — `value` is 0..100
 *   - `amount_off`     — `value` is money in `currency`
 *   - `free_delivery`  — `value` is ignored; the cart's delivery cost is zeroed
 *
 * Eligibility rules:
 *   - `code` (optional) — when present, only carts that present the code apply;
 *                          when null, the promotion applies automatically to
 *                          every eligible cart.
 *   - `minCartSubtotal`  — cart subtotal threshold (in promotion currency).
 *   - `validFrom` / `validUntil` — clock-bound validity window.
 *   - `organizationId` / `customerGroupId` — restrict to a single Customer / group.
 *   - `categoryId` / `productId` — restrict effect to lines in the chosen scope.
 *   - `criteria[]` (feature 012 / US8) — line-level discriminated criteria.
 *     Today only the `attribute` variant is meaningful; the union is shaped
 *     so the existing flat `categoryId`/`productId`/etc. fields can migrate
 *     into it incrementally without breaking the wire format.
 */

// --- Promotion criteria (feature 012 / US8) --------------------------------

/**
 * Attribute-key syntax: lowercase, must start with a letter, then letters,
 * digits, or underscore. Mirrors `isValidAttributeKey()` in the catalog
 * module so the picker and the schema reject the same invalid keys.
 */
export const attributeKeyRegex = /^[a-z][a-z0-9_]*$/;

const attributeCriterionSchema = z.object({
  type: z.literal('attribute'),
  attributeKey: z.string().regex(attributeKeyRegex, 'invalid_attribute_key'),
  op: z.enum(['equals', 'in', 'range']),
  /**
   * Per-`op` shape (re-validated server-side against the attribute's
   * resolved `valueType`):
   *
   *   - `equals`: single-element `[scalar]`
   *   - `in`:     non-empty `[scalar, ...]`
   *   - `range`:  exactly `[min, max]`, both numeric or both ISO date-time
   */
  values: z.array(z.unknown()).min(1),
});

const categoryCriterionSchema = z.object({
  type: z.literal('category'),
  categoryIds: z.array(uuidSchema).min(1),
});

const productCriterionSchema = z.object({
  type: z.literal('product'),
  productIds: z.array(uuidSchema).min(1),
});

const customerGroupCriterionSchema = z.object({
  type: z.literal('customerGroup'),
  customerGroupIds: z.array(uuidSchema).min(1),
});

const organizationCriterionSchema = z.object({
  type: z.literal('organization'),
  organizationIds: z.array(uuidSchema).min(1),
});

export const promotionCriterionSchema = z.discriminatedUnion('type', [
  attributeCriterionSchema,
  categoryCriterionSchema,
  productCriterionSchema,
  customerGroupCriterionSchema,
  organizationCriterionSchema,
]);
export type PromotionCriterion = z.infer<typeof promotionCriterionSchema>;
export type AttributePromotionCriterion = z.infer<typeof attributeCriterionSchema>;

// ============================================================================
// FEATURE 045 — promotions rules engine
// ============================================================================

// --- Rule AST (typed superset of the price-list application-rule AST) -------

/**
 * Operator vocabulary for a promotion rule condition. The admissible set
 * per field/value-type is enforced by the evaluator + write-time validation;
 * the schema accepts the full vocabulary structurally.
 */
export const promotionRuleOpSchema = z.enum([
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
]);
export type PromotionRuleOp = z.infer<typeof promotionRuleOpSchema>;

/** Built-in cart-context / relationship fields available to the Rule Builder. */
export const promotionRuleBuiltinFieldSchema = z.enum([
  'cartTotal',
  'paymentMethod',
  'deliveryMethod',
  'deliveryCountry',
  'deliveryPostalCode',
  'organization',
  'customerGroup',
  'category',
]);
export type PromotionRuleBuiltinField = z.infer<typeof promotionRuleBuiltinFieldSchema>;

/** A rule field is either a built-in key or a promo-eligible product attribute. */
export const promotionRuleFieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), key: promotionRuleBuiltinFieldSchema }),
  z.object({
    kind: z.literal('attribute'),
    attributeKey: z.string().regex(attributeKeyRegex, 'invalid_attribute_key'),
  }),
]);
export type PromotionRuleField = z.infer<typeof promotionRuleFieldSchema>;

export const promotionRuleValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type PromotionRuleValue = z.infer<typeof promotionRuleValueSchema>;

export type PromotionRuleAll = { kind: 'all' };
export type PromotionRuleCondition = {
  kind: 'condition';
  field: PromotionRuleField;
  op: PromotionRuleOp;
  values: PromotionRuleValue[];
};
export type PromotionRuleGroup = {
  kind: 'group';
  op: 'AND' | 'OR';
  children: PromotionRule[];
};
export type PromotionRule = PromotionRuleAll | PromotionRuleCondition | PromotionRuleGroup;

const promotionRuleAllNodeSchema = z.object({ kind: z.literal('all') });
const promotionRuleConditionNodeSchema = z.object({
  kind: z.literal('condition'),
  field: promotionRuleFieldSchema,
  op: promotionRuleOpSchema,
  values: z.array(promotionRuleValueSchema).max(1000),
});
const promotionRuleNodeSchema: z.ZodType<PromotionRule> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    promotionRuleAllNodeSchema,
    promotionRuleConditionNodeSchema,
    z.object({
      kind: z.literal('group'),
      op: z.enum(['AND', 'OR']),
      children: z.array(promotionRuleNodeSchema).min(1).max(20),
    }),
  ]),
);

/** Maximum nesting depth of a rule tree (mirrors the price-list guard). */
export function promotionRuleDepth(node: PromotionRule): number {
  if (node.kind !== 'group') return 0;
  return 1 + Math.max(0, ...node.children.map(promotionRuleDepth));
}

export const promotionRuleSchema = promotionRuleNodeSchema.refine(
  (node) => promotionRuleDepth(node) <= 5,
  { message: 'rule_depth_exceeds_5' },
);

// --- Action catalogue (discriminated by `type`) ----------------------------

const ACTION_CURRENCY = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217');
const ACTION_PERCENT = z.number().finite().min(0).max(100);
const ACTION_AMOUNT = z.number().finite().positive();
const ACTION_POSITIVE_INT = z.number().int().positive();
export const promotionGiftTargetSchema = z.enum(['cheapest', 'most_expensive']);
export type PromotionGiftTarget = z.infer<typeof promotionGiftTargetSchema>;

export const promotionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('free_delivery') }),
  z.object({ type: z.literal('percentage_off_cart'), percent: ACTION_PERCENT }),
  z.object({ type: z.literal('amount_off_cart'), amount: ACTION_AMOUNT, currency: ACTION_CURRENCY }),
  z.object({
    type: z.literal('buy_x_get_y_free'),
    buyQuantity: ACTION_POSITIVE_INT,
    freeQuantity: ACTION_POSITIVE_INT,
    target: promotionGiftTargetSchema,
  }),
  z.object({
    type: z.literal('spend_x_percent_off'),
    spendStep: ACTION_AMOUNT,
    percent: ACTION_PERCENT,
    currency: ACTION_CURRENCY,
  }),
  z.object({
    type: z.literal('spend_x_amount_off'),
    spendStep: ACTION_AMOUNT,
    amount: ACTION_AMOUNT,
    currency: ACTION_CURRENCY,
  }),
  z.object({
    type: z.literal('every_nth_product_percent_off'),
    nth: ACTION_POSITIVE_INT,
    percent: ACTION_PERCENT,
  }),
  z.object({
    type: z.literal('buy_x_units_y_free'),
    productId: uuidSchema,
    buyUnits: ACTION_POSITIVE_INT,
    freeUnits: ACTION_POSITIVE_INT,
  }),
  z.object({
    type: z.literal('buy_x_units_percent_off'),
    productId: uuidSchema,
    buyUnits: ACTION_POSITIVE_INT,
    percent: ACTION_PERCENT,
  }),
  z.object({
    type: z.literal('buy_x_units_amount_off'),
    productId: uuidSchema,
    buyUnits: ACTION_POSITIVE_INT,
    amount: ACTION_AMOUNT,
    currency: ACTION_CURRENCY,
  }),
]);
export type PromotionAction = z.infer<typeof promotionActionSchema>;

export const promotionActionTypeSchema = z.enum([
  'free_delivery',
  'percentage_off_cart',
  'amount_off_cart',
  'buy_x_get_y_free',
  'spend_x_percent_off',
  'spend_x_amount_off',
  'every_nth_product_percent_off',
  'buy_x_units_y_free',
  'buy_x_units_percent_off',
  'buy_x_units_amount_off',
]);
export type PromotionActionType = z.infer<typeof promotionActionTypeSchema>;


export const promotionKindSchema = z.enum([
  'percentage_off',
  'amount_off',
  'free_delivery',
]);
export type PromotionKind = z.infer<typeof promotionKindSchema>;

export const promotionSchema = z.object({
  id: uuidSchema,
  code: z.string().nullable(),
  name: z.string().min(1).max(160),
  /** Legacy effect kind — nullable on feature-045 action-based promotions. */
  kind: promotionKindSchema.nullable(),
  /** Legacy effect value — nullable on feature-045 action-based promotions. */
  value: z.number().finite().nonnegative().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217').nullable(),
  minCartSubtotal: z.number().finite().nonnegative().nullable(),
  validFrom: isoDateTimeSchema.nullable(),
  validUntil: isoDateTimeSchema.nullable(),
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  productId: uuidSchema.nullable(),
  /**
   * Feature 012 / US8 — optional line-level criteria evaluated alongside
   * the flat `categoryId`/`productId` scope. ANDed with the flat fields:
   * a line must satisfy both the legacy scope AND every criterion to be
   * included in the promotion's `lineBase`.
   */
  criteria: z.array(promotionCriterionSchema).default([]),
  isActive: z.boolean(),
  // --- Feature 045 — engine fields -----------------------------------------
  description: z.string().nullable().default(null),
  priority: z.number().int().default(0),
  stopFurther: z.boolean().default(false),
  /** Configured action (null on legacy kind/value promotions). */
  action: promotionActionSchema.nullable().default(null),
  /** Named rule reference (mutually exclusive with `rule`). */
  ruleId: uuidSchema.nullable().default(null),
  /** Inline rule definition (mutually exclusive with `ruleId`). */
  rule: promotionRuleSchema.nullable().default(null),
  usageLimitGlobal: z.number().int().positive().nullable().default(null),
  usageLimitPerOrganization: z.number().int().positive().nullable().default(null),
  usageLimitPerCustomer: z.number().int().positive().nullable().default(null),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Promotion = z.infer<typeof promotionSchema>;

export const upsertPromotionRequestSchema = z
  .object({
    code: z.string().min(1).max(64).nullable().optional(),
    name: z.string().min(1).max(160),
    /** Legacy effect — optional when a feature-045 `action` is provided. */
    kind: promotionKindSchema.optional(),
    value: z.number().finite().nonnegative().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    minCartSubtotal: z.number().finite().nonnegative().nullable().optional(),
    validFrom: isoDateTimeSchema.nullable().optional(),
    validUntil: isoDateTimeSchema.nullable().optional(),
    organizationId: uuidSchema.nullable().optional(),
    customerGroupId: uuidSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    productId: uuidSchema.nullable().optional(),
    criteria: z.array(promotionCriterionSchema).optional(),
    isActive: z.boolean().optional(),
    // --- Feature 045 — engine fields ---------------------------------------
    description: z.string().max(2000).nullable().optional(),
    priority: z.number().int().optional(),
    stopFurther: z.boolean().optional(),
    action: promotionActionSchema.optional(),
    ruleId: uuidSchema.nullable().optional(),
    rule: promotionRuleSchema.nullable().optional(),
    usageLimitGlobal: z.number().int().positive().nullable().optional(),
    usageLimitPerOrganization: z.number().int().positive().nullable().optional(),
    usageLimitPerCustomer: z.number().int().positive().nullable().optional(),
    /** Sales channels this promotion runs in (membership bridge). */
    salesChannelIds: z.array(uuidSchema).optional(),
  })
  .superRefine((value, ctx) => {
    // A promotion is driven by EITHER a feature-045 `action` OR the legacy
    // `kind` + `value` pair — exactly one source must be present.
    if (!value.action && !value.kind) {
      ctx.addIssue({
        code: 'custom',
        message: 'a promotion requires either an action or a legacy kind',
        path: ['action'],
      });
    }
    if (value.kind && value.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'legacy kind promotions require a value',
        path: ['value'],
      });
    }
    if (value.ruleId && value.rule) {
      ctx.addIssue({
        code: 'custom',
        message: 'rule_source_conflict: provide either ruleId or rule, not both',
        path: ['rule'],
      });
    }
    if (value.kind === 'amount_off' && value.currency == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'amount_off promotions require a currency',
        path: ['currency'],
      });
    }
    if (value.kind === 'percentage_off' && value.value !== undefined && (value.value < 0 || value.value > 100)) {
      ctx.addIssue({
        code: 'custom',
        message: 'percentage_off value must be between 0 and 100',
        path: ['value'],
      });
    }
    if (value.criteria) {
      value.criteria.forEach((c, idx) => {
        if (c.type !== 'attribute') return;
        if (c.op === 'equals' && c.values.length !== 1) {
          ctx.addIssue({
            code: 'custom',
            message: 'invalid_criterion_values: equals expects a single-element values array',
            path: ['criteria', idx, 'values'],
          });
        }
        if (c.op === 'range' && c.values.length !== 2) {
          ctx.addIssue({
            code: 'custom',
            message: 'invalid_criterion_values: range expects exactly [min, max]',
            path: ['criteria', idx, 'values'],
          });
        }
      });
    }
  });

// --- Named rules (US6) -----------------------------------------------------

export const promotionRuleRecordSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  description: z.string().nullable(),
  definition: promotionRuleSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PromotionRuleRecord = z.infer<typeof promotionRuleRecordSchema>;

export const upsertPromotionRuleRequestSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  definition: promotionRuleSchema,
});
export type UpsertPromotionRuleRequest = z.infer<typeof upsertPromotionRuleRequestSchema>;

// --- Coupons & generator (US3 / US4) ---------------------------------------

export const couponFormatSchema = z.enum(['alnum', 'digits', 'letters']);
export type CouponFormat = z.infer<typeof couponFormatSchema>;

export const couponLimitScopeSchema = z.enum(['per_coupon', 'shared_batch']);
export type CouponLimitScope = z.infer<typeof couponLimitScopeSchema>;

export const promotionCouponSchema = z.object({
  id: uuidSchema,
  promotionId: uuidSchema,
  batchId: uuidSchema.nullable(),
  code: z.string(),
  limitScope: couponLimitScopeSchema,
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type PromotionCouponDto = z.infer<typeof promotionCouponSchema>;

export const generateCouponsRequestSchema = z.object({
  count: z.number().int().positive().max(100_000),
  length: z.number().int().min(3).max(40),
  format: couponFormatSchema,
  prefix: z.string().max(32).nullable().optional(),
  suffix: z.string().max(32).nullable().optional(),
  /** Insert a dash every N characters of the generated body; 0/absent = none. */
  dashEvery: z.number().int().nonnegative().max(40).optional(),
  limitScope: couponLimitScopeSchema.default('per_coupon'),
});
export type GenerateCouponsRequest = z.infer<typeof generateCouponsRequestSchema>;

// --- Cart application ------------------------------------------------------

export const cartLineSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  categoryIds: z.array(uuidSchema),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  /**
   * Feature 012 / US8 — optional attribute snapshot for line-level
   * criterion evaluation. Callers MAY omit this field; when omitted, the
   * promotion service loads the values from the catalog read path. The
   * field is provided for callers that already have the snapshot in hand
   * (e.g. CartService building a preview) so the resolver doesn't have
   * to round-trip the database.
   */
  attributeValues: z.record(z.string(), z.unknown()).optional(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSnapshotSchema = z.object({
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(cartLineSchema),
  deliveryTotal: z.number().finite().nonnegative(),
  /** Promotion code presented at checkout, if any. */
  promotionCode: z.string().nullable().optional(),
  /**
   * Feature 045 — cart-context facts the promotion Rule Builder can target.
   * All optional so legacy callers (preview probes, older carts) keep working;
   * a rule condition over a field that is absent simply does not match.
   */
  salesChannelId: uuidSchema.nullable().optional(),
  customerAccountId: uuidSchema.nullable().optional(),
  paymentMethodCode: z.string().nullable().optional(),
  deliveryMethodCode: z.string().nullable().optional(),
  deliveryCountry: z.string().nullable().optional(),
  deliveryPostalCode: z.string().nullable().optional(),
});
export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;

export const promotionApplicationSchema = z.object({
  subtotal: z.number().finite().nonnegative(),
  discountTotal: z.number().finite().nonnegative(),
  deliveryTotal: z.number().finite().nonnegative(),
  total: z.number().finite().nonnegative(),
  appliedPromotions: z.array(
    z.object({
      promotionId: uuidSchema,
      /** Legacy effect kind — null for feature-045 action-based promotions. */
      kind: promotionKindSchema.nullable(),
      /** Feature 045 — action type when the promotion is action-based. */
      actionType: promotionActionTypeSchema.nullable().default(null),
      /** Feature 045 — coupon that gated this application, if any. */
      couponId: uuidSchema.nullable().default(null),
      amount: z.number().finite().nonnegative(),
    }),
  ),
});
export type PromotionApplication = z.infer<typeof promotionApplicationSchema>;

// --- Promotion-rule editor support (feature 012 / US8) ---------------------

/**
 * Picker payload returned by `GET /api/v1/admin/promotions/rule-targets/attributes`.
 * Lists every attribute carrying `isPromoRule = true`, with the option list
 * inline for select-style types so the editor can render the value picker
 * without an additional round-trip.
 */
export const promotionRuleAttributeOptionSchema = z.object({
  value: z.string(),
  label: z.record(z.string(), z.string()),
  labelDefault: z.string(),
});
export type PromotionRuleAttributeOption = z.infer<typeof promotionRuleAttributeOptionSchema>;

export const promotionRuleAttributeSchema = z.object({
  id: uuidSchema,
  key: z.string().regex(attributeKeyRegex),
  label: z.record(z.string(), z.string()),
  labelDefault: z.string(),
  valueType: z.enum([
    'string',
    'number',
    'boolean',
    'date',
    'enum',
    'select',
    'multiselect',
    'price',
  ]),
  options: z.array(promotionRuleAttributeOptionSchema).optional(),
});
export type PromotionRuleAttribute = z.infer<typeof promotionRuleAttributeSchema>;

export const promotionRuleAttributesResponseSchema = z.object({
  data: z.object({
    items: z.array(promotionRuleAttributeSchema),
  }),
});
export type PromotionRuleAttributesResponse = z.infer<
  typeof promotionRuleAttributesResponseSchema
>;
