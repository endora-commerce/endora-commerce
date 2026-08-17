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
//
// The schemas, the record and the read port moved to `customer-accounts.ts`
// with the entity (feature 076, D-79): a customer group describes the customer,
// and a price list merely refers to one by id. Nothing here imports them back —
// `PriceListAssignment` and the rule-target types carry a `customerGroupId`
// string, never the record.

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

/**
 * The buying organisation, as a line resolution reads it: the id, which is a
 * rule dimension and part of the cache key, and the group it belongs to, which
 * a customer's own group overrides. The same two fields the engine's own
 * `PricingOrganizationRef` names.
 */
export interface LinePriceOrganization {
  id: string;
  customerGroupId?: string | null;
}

/** What a resolved line price is, once the whole chain has run. */
export interface LinePriceResult {
  /** Decimal string — it lands verbatim on the cart line and then the order. */
  amount: string;
  currency: string;
  priceListId: string;
  isSale: boolean;
  bracketStartQuantity: number;
  displayMode: DisplayMode;
}

/**
 * The slice of the `pricingService` port a **line** resolution asks for —
 * `ListingPricePort`'s sibling, and declared here for the same reasons: one
 * wording for every caller, and a *shape* rather than an import of
 * `price_lists/services/pricing-service.interface.ts`, so a consumer does not
 * reach into the owning module (Principle I). The owner's
 * `PricingServiceContract` is a superset and satisfies it structurally.
 *
 * The difference from the listing slice is the *quantity* and the *buyer*: a
 * cart line is priced at its own quantity, against the buying organisation's
 * resolved list, so both are in the context and neither is optional in the way
 * an anonymous catalogue card's are.
 *
 * `null` is the resolver's own documented answer for "nothing applies", and it
 * is not the same thing as an absent `price_lists`. With the module off the
 * gate throws `ModuleDisabledError` — issue #124: a cart must refuse rather
 * than invent a figure, and the absent arm of {@link ListingPrice} carries no
 * `amount` for exactly the same reason.
 */
export interface LinePricePort {
  resolveLinePrice(input: {
    product: ListingPriceProduct;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: LinePriceOrganization | null;
      /** Feature 040 — a customer's direct group overrides the org's. */
      customerGroupId?: string | null;
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<LinePriceResult | null>;
}

// --- Settings keys (also exposed via the settings manifest) -----------------

export const PRICING_SETTING_CODES = {
  DEFAULT_DISPLAY_MODE: 'pricing.default_display_mode',
  UNAUTHENTICATED_DISPLAY_MODE: 'pricing.unauthenticated_display_mode',
} as const;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `price_lists` publishes to the eight modules that read
// it (feature 075, Phase P).
//
// `PricingServiceContract` is **not** here, and that is deliberate: it lives in
// `price_lists/services/pricing-service.interface.ts` because it is the target
// of the feature-057 overlay decoration, which is written against that file and
// whose assignability to it is the contract gate. Moving it would move the gate.
// ---------------------------------------------------------------------------

/** A price list as a module outside `price_lists` sees it. */
export interface PriceListRecord {
  id: string;
  code: string;
  name: string;
  currency: string;
  isDefault: boolean;
  priority: number;
  type: 'base' | 'sale';
  status: 'draft' | 'active' | 'scheduled' | 'expired';
  startsAt: Date | null;
  endsAt: Date | null;
  applicationRule: ApplicationRule;
  isSystem: boolean;
  modifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `priceListReadPort`. Owner: `price_lists`.
 *
 * `organizations` resolves which lists apply to an org, `product_feeds` reads
 * the list a feed prices from. Both read the row; neither should own the
 * question of what "active" means, which is why `listActive` is here rather
 * than a status filter in each caller.
 */
export interface PriceListReadPort {
  findById(id: string): Promise<PriceListRecord | null>;
  findByIds(ids: readonly string[]): Promise<PriceListRecord[]>;
  findByCode(code: string): Promise<PriceListRecord | null>;
  /** Every list, ordered by priority then code. */
  listAll(): Promise<PriceListRecord[]>;
  /** Only `status === 'active'`, ordered by priority then code. */
  listActive(): Promise<PriceListRecord[]>;
}

/**
 * One quantity bracket of a product's price on a list.
 *
 * `amount` is a decimal **string** — the storage shape on
 * `price_list_price_brackets`. A `number` cannot round-trip a price, and this
 * value comes in from a PIM import and goes out to a checkout.
 */
export interface PriceBracketInput {
  minQuantity: number;
  maxQuantity: number | null;
  amount: string;
}

/** One list's brackets for a product, as the admin summary renders them. */
export interface PriceListBracketSummary {
  list: {
    id: string;
    name: string;
    type: 'base' | 'sale';
    status: 'draft' | 'active' | 'scheduled' | 'expired';
    modifiedAt: Date;
  };
  summary: Array<{ currencyCode: string; summary: string }>;
  deepLinkPath: string;
}

/**
 * Container name: `priceListAdminPort`. Owner: `price_lists`.
 *
 * `pim_ergonode` writes prices as part of an import run: it resolves the list,
 * adds the product to it if it is not there, replaces the brackets, and reads
 * back the summary its field-protection rules compare against. That is the
 * whole of what it needs, and publishing more would be publishing the class.
 */
export interface PriceListAdminPort {
  getById(id: string): Promise<PriceListRecord>;
  listProducts(
    priceListId: string,
  ): Promise<Array<{ productId: string; bracketsByCurrency: Record<string, PriceBracketInput[]> }>>;
  addProduct(priceListId: string, productId: string): Promise<void>;
  replaceBrackets(
    priceListId: string,
    productId: string,
    bracketsByCurrency: Record<string, readonly PriceBracketInput[]>,
  ): Promise<Record<string, PriceBracketInput[]>>;
  summarizeBracketsForProduct(productId: string): Promise<PriceListBracketSummary[]>;
}

// --- the application-rule evaluator -----------------------------------------
//
// Relocated here from `price_lists/services/application-rule-evaluator.ts`
// (feature 075, Phase P, FR-013). It is a **pure function** over an
// `ApplicationRule` — which this file already declares — and a context of
// plain ids: switching `price_lists` off does not change whether a rule
// matches, so a gated port answering 503 would be a bug rather than a degrade.
//
// `organizations` evaluates the same rules to work out an organisation's
// effective price lists, and it has to reach the *same* answer as the resolver
// does: two copies that drifted would show an operator one set of lists on the
// organisation screen and price from another at checkout.

/** What a rule is evaluated against. */
export interface PriceListResolutionContext {
  organizationId: string | null;
  /**
   * Feature 056 — the acting org's inheritance chain, nearest-first
   * (`[orgId, ...ancestorIds]`). When present, the `organization` criterion
   * matches ANY org in the chain, and the resolver ranks by nearness so a list
   * naming a nearer org outranks one naming a farther ancestor (R5). When
   * absent, it defaults to `[organizationId]` (flat behaviour, byte-for-byte).
   */
  organizationChain?: readonly string[];
  customerGroupId: string | null;
  salesChannelId: string;
  currencyCode: string;
  productCategoryIds: ReadonlySet<string>;
}

export interface PriceListRuleEvaluation {
  matched: boolean;
  explicitOn: ReadonlySet<RuleCriterionType>;
  /**
   * Feature 056 — index of the NEAREST org (in the resolution chain) that this
   * rule explicitly names, or `undefined` when the rule names no org in the
   * chain. Lower = nearer = higher price-list priority within the
   * `organization` level (R5). A direct-org match (flat) is rank 0.
   */
  organizationRank?: number;
}

const NO_EXPLICIT: ReadonlySet<RuleCriterionType> = new Set();

/**
 * Pure rule evaluator (feature 011 / FR-022, FR-023, FR-026, FR-029).
 *
 * Walks the discriminated-union AST and returns:
 *   - `matched`: the overall AST truth value against the resolution context.
 *   - `explicitOn`: the criterion types that contributed to the match AND had
 *     non-empty value lists. The resolver's priority chain consults this to
 *     award the per-step boost (FR-026 steps 1..4).
 *
 * Notes:
 *   - The `category` criterion is product-driven (FR-029): it matches when the
 *     product belongs to any category named in the rule's value list.
 *   - The `currency` criterion never appears in the priority chain even when
 *     explicit; it is purely a matching criterion.
 *   - `{ kind: 'all' }` and any criterion with `values: []` are treated as
 *     always-true and contribute nothing to `explicitOn` (FR-022).
 */
export function evaluateApplicationRule(
  rule: ApplicationRule,
  ctx: PriceListResolutionContext,
): PriceListRuleEvaluation {
  if (rule.kind === 'all') {
    return { matched: true, explicitOn: NO_EXPLICIT };
  }

  if (rule.kind === 'criterion') {
    if (rule.values.length === 0) {
      return { matched: true, explicitOn: NO_EXPLICIT };
    }
    if (rule.type === 'organization') {
      const rank = organizationMatchRank(rule.values, ctx);
      if (rank === undefined) return { matched: false, explicitOn: NO_EXPLICIT };
      return { matched: true, explicitOn: new Set(['organization']), organizationRank: rank };
    }
    const matched = matchesCriterion(rule.type, rule.values, ctx);
    return {
      matched,
      explicitOn: matched ? new Set([rule.type]) : NO_EXPLICIT,
    };
  }

  // group node
  if (rule.children.length === 0) {
    // defensive — schema disallows, but evaluate as always-true (empty AND/OR)
    return { matched: true, explicitOn: NO_EXPLICIT };
  }
  const childEvaluations = rule.children.map((c) => evaluateApplicationRule(c, ctx));

  if (rule.op === 'AND') {
    const allMatch = childEvaluations.every((e) => e.matched);
    if (!allMatch) return { matched: false, explicitOn: NO_EXPLICIT };
    return {
      matched: true,
      explicitOn: unionExplicit(childEvaluations),
      ...withRank(minRank(childEvaluations)),
    };
  }

  // OR
  const matchingChildren = childEvaluations.filter((e) => e.matched);
  if (matchingChildren.length === 0) return { matched: false, explicitOn: NO_EXPLICIT };
  // Only matching children contribute to the explicit set + nearness rank.
  return {
    matched: true,
    explicitOn: unionExplicit(matchingChildren),
    ...withRank(minRank(matchingChildren)),
  };
}

/**
 * The nearness rank of the nearest org (in `ctx.organizationChain`, else
 * `[organizationId]`) named by `values`, or `undefined` when none match.
 */
function organizationMatchRank(
  values: readonly string[],
  ctx: PriceListResolutionContext,
): number | undefined {
  const chain =
    ctx.organizationChain && ctx.organizationChain.length > 0
      ? ctx.organizationChain
      : ctx.organizationId !== null
        ? [ctx.organizationId]
        : [];
  const valueSet = new Set(values);
  for (let i = 0; i < chain.length; i += 1) {
    if (valueSet.has(chain[i]!)) return i; // nearest-first → first hit is the nearest
  }
  return undefined;
}

function minRank(evaluations: readonly PriceListRuleEvaluation[]): number | undefined {
  let min: number | undefined;
  for (const e of evaluations) {
    if (e.organizationRank !== undefined && (min === undefined || e.organizationRank < min)) {
      min = e.organizationRank;
    }
  }
  return min;
}

function withRank(rank: number | undefined): { organizationRank?: number } {
  return rank === undefined ? {} : { organizationRank: rank };
}

function matchesCriterion(
  type: RuleCriterionType,
  values: readonly string[],
  ctx: PriceListResolutionContext,
): boolean {
  switch (type) {
    case 'salesChannel':
      return values.includes(ctx.salesChannelId);
    case 'organization':
      return organizationMatchRank(values, ctx) !== undefined;
    case 'customerGroup':
      return ctx.customerGroupId !== null && values.includes(ctx.customerGroupId);
    case 'category':
      return values.some((c) => ctx.productCategoryIds.has(c));
    case 'currency':
      return values.includes(ctx.currencyCode);
  }
}

function unionExplicit(
  evaluations: readonly PriceListRuleEvaluation[],
): ReadonlySet<RuleCriterionType> {
  const out = new Set<RuleCriterionType>();
  for (const e of evaluations) {
    for (const t of e.explicitOn) out.add(t);
  }
  return out;
}
