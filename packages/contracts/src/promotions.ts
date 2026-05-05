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
  kind: promotionKindSchema,
  value: z.number().finite().nonnegative(),
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
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Promotion = z.infer<typeof promotionSchema>;

export const upsertPromotionRequestSchema = z
  .object({
    code: z.string().min(1).max(64).nullable().optional(),
    name: z.string().min(1).max(160),
    kind: promotionKindSchema,
    value: z.number().finite().nonnegative(),
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
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'amount_off' && value.currency == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'amount_off promotions require a currency',
        path: ['currency'],
      });
    }
    if (value.kind === 'percentage_off' && (value.value < 0 || value.value > 100)) {
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
      kind: promotionKindSchema,
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
