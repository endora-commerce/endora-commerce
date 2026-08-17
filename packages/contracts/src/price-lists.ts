import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Pricing contracts (feature 011 engine).
 *
 * Schemas: `priceListEngineSchema`, `applicationRuleSchema`,
 * `priceListBracketSchema`, `displayModeSchema`, etc. Model the B2B
 * pricing engine: multi-currency multi-bracket prices per product, an
 * Application Rule tree (AND/OR over SC/CG/Org/Cat/Currency criteria),
 * Base/Sale split, lifecycle status, and the four-level price-display
 * mode chain.
 *
 * Legacy feature-014 schemas (`priceListItemSchema`,
 * `priceListAssignmentSchema`, etc.) were retired by T011 alongside
 * their entity files and admin endpoints.
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

// --- Listing price (catalogue listing / search / compare / links) -----------

/**
 * What a catalogue listing may show as a product's price — issue #132.
 *
 * There is always one default price list, so the first arm is the path a
 * listing normally takes. The product ruling names the whole chain and this
 * union is that chain, one arm each:
 *
 *   `price_list` — an applicable list priced this product for this buyer;
 *   `product`    — no list applied, so the price assigned directly to the
 *                  Product stands in (the legacy `defaultPrice` attribute);
 *   `none`       — neither exists, and the listing renders no price.
 *
 * The `none` arm carries **no `amount` field**, following the `ResolvedTax`
 * precedent (issue #124): a listing showing nothing and a listing offering a
 * free product are different pages, so a caller has to narrow on `source`
 * before it can read a figure. A product priced at zero comes back as
 * `{ source: 'price_list' | 'product', amount: '0.00' }` and renders as zero —
 * `amount` is never a falsy sentinel for absence.
 *
 * As with `ResolvedTax`, "the `price_lists` module is absent" is deliberately
 * not an arm: absence is not a value, and the port gate throws
 * `MODULE_DISABLED` before a resolution runs.
 */
export const listingPriceSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('price_list'),
    amount: DECIMAL_STRING,
    currency: CURRENCY,
    priceListId: uuidSchema,
    isSale: z.boolean(),
  }),
  z.object({
    source: z.literal('product'),
    amount: DECIMAL_STRING,
    currency: CURRENCY,
  }),
  z.object({ source: z.literal('none') }),
]);
export type ListingPrice = z.infer<typeof listingPriceSchema>;

/**
 * The money a listing renders for one resolved chain answer, or `null` when the
 * chain ended in `none`.
 *
 * The narrowing is the point: `null` here means "there is no price", which the
 * `ProductSummary.price` wire field already spells `null`. A resolved `0` comes
 * back as `{ amount: 0 }` and survives every caller, because nothing on this
 * path tests an amount for truthiness.
 */
export function listingPriceMoney(
  price: ListingPrice,
): { amount: number; currency: string } | null {
  if (price.source === 'none') return null;
  const amount = Number(price.amount);
  return Number.isFinite(amount) ? { amount, currency: price.currency } : null;
}

/** The little of a Product a listing resolution reads. */
export interface ListingPriceProduct {
  id: string;
  attributeValues: Record<string, unknown>;
}

/**
 * The slice of the `pricingService` port a catalogue listing path resolves.
 *
 * Declared here rather than in each consumer so the catalogue, search,
 * comparisons and product links ask for the same thing in the same words, and
 * declared as a *shape* rather than imported from `price_lists` so none of them
 * reaches into the owning module (Principle I). The owner's
 * `PricingServiceContract` is a superset and satisfies it structurally.
 *
 * There is no organization in the context: these are anonymous surfaces — the
 * public catalogue routes resolve a sales channel and no customer — so a
 * listing quotes the channel's anonymous price, which is the same resolution
 * the storefront's own `getResolvedPrice` performs from a server component.
 */
export interface ListingPricePort {
  resolveListingPrices(input: {
    products: readonly ListingPriceProduct[];
    context: {
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<Map<string, ListingPrice>>;
}

// --- Settings keys (also exposed via the settings manifest) -----------------

export const PRICING_SETTING_CODES = {
  DEFAULT_DISPLAY_MODE: 'pricing.default_display_mode',
  UNAUTHENTICATED_DISPLAY_MODE: 'pricing.unauthenticated_display_mode',
} as const;
