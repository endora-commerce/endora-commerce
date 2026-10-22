import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Price books — feature 160, D-287 P1 (`specs/160-pricing-model-v2/`).
 *
 * A price book is a header that fixes one currency, a set of sales channels and
 * an audience set of one kind (everyone, a set of customer groups or a set of
 * organizations), and rows that price a **selection** — a variant, a product,
 * a category ∩ attribute value, a category, an attribute value or every product
 * — for a quantity window, as a fixed amount, a signed percentage or a signed
 * amount adjustment of a reference price (`specs/pricing/decision-record.md`
 * §5.1). The semantics are D-287's and are not restated here; these are the
 * shapes, defined before any route (Principle II).
 *
 * The rows are stored in `price_list_matrix_entries` and the header in
 * `price_lists`, both owned by `price_lists`: a book is the evolved price list,
 * which is why the database keeps the old names (research R3).
 */

const CURRENCY = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
const POSITIVE_INT = z.number().int().positive();

/** A non-negative amount with at most four fractional digits. */
export const PRICE_BOOK_AMOUNT = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,4})?$/, 'non-negative decimal with up to 4 fractional digits');
/** A signed amount adjustment with at most four fractional digits. */
export const PRICE_BOOK_SIGNED_AMOUNT = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,4})?$/, 'signed decimal with up to 4 fractional digits');

/** The bounds of a signed percentage (owner ruling N9): a free line to an elevenfold price. */
export const PRICE_BOOK_PERCENT_MIN = -100;
export const PRICE_BOOK_PERCENT_MAX = 1000;

/** A signed percentage with at most two fractional digits, within the N9 bounds. */
export const PRICE_BOOK_PERCENT = z.string().superRefine((value, ctx) => {
  if (!/^-?\d{1,4}(\.\d{1,2})?$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'signed percentage with up to 2 fractional digits' });
    return;
  }
  const n = Number(value);
  if (n < PRICE_BOOK_PERCENT_MIN || n > PRICE_BOOK_PERCENT_MAX) {
    ctx.addIssue({
      code: 'custom',
      message: `percentage must be between ${PRICE_BOOK_PERCENT_MIN} and ${PRICE_BOOK_PERCENT_MAX}`,
    });
  }
});

// --- Header ------------------------------------------------------------------

/** `regular` prices the catalogue and buyer tiers; `sale` is charged only when lower. */
export const priceBookTypeSchema = z.enum(['regular', 'sale']);
export type PriceBookType = z.infer<typeof priceBookTypeSchema>;

export const priceBookStatusSchema = z.enum(['draft', 'scheduled', 'active', 'expired']);
export type PriceBookStatus = z.infer<typeof priceBookStatusSchema>;

export const priceBookAudienceKindSchema = z.enum(['everyone', 'customer_groups', 'organizations']);
export type PriceBookAudienceKind = z.infer<typeof priceBookAudienceKindSchema>;

/** Most members one audience set may name. */
export const PRICE_BOOK_MAX_MEMBERS = 1000;
/** Most channels one channel set may name. */
export const PRICE_BOOK_MAX_CHANNELS = 100;

/**
 * The audience set (owner ruling Q1): one kind, never mixed. `everyone` names
 * no member; the other two kinds name ids of that kind, which the service
 * checks exist and are of the kind (FR-002, A4). A draft may name none; a book
 * of those kinds needs at least one member to be activated.
 */
export const priceBookAudienceSchema = z
  .object({
    kind: priceBookAudienceKindSchema,
    memberIds: z.array(uuidSchema).max(PRICE_BOOK_MAX_MEMBERS).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'everyone' && value.memberIds.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['memberIds'], message: 'An everyone audience names no member.' });
    }
    if (new Set(value.memberIds).size !== value.memberIds.length) {
      ctx.addIssue({ code: 'custom', path: ['memberIds'], message: 'A member is named twice.' });
    }
  });
export type PriceBookAudience = z.infer<typeof priceBookAudienceSchema>;

export const priceBookChannelIdsSchema = z
  .array(uuidSchema)
  .max(PRICE_BOOK_MAX_CHANNELS)
  .refine((ids) => new Set(ids).size === ids.length, 'A channel is named twice.');

const datesRefinement = (
  value: { startsAt?: string | null | undefined; endsAt?: string | null | undefined },
  ctx: z.RefinementCtx,
) => {
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt must be after startsAt.' });
  }
};

/** Body of `POST /api/v1/admin/price-books` (FR-001). The book is created as a draft. */
export const priceBookCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: priceBookTypeSchema,
    currencyCode: CURRENCY,
    channelIds: priceBookChannelIdsSchema.default([]),
    audience: priceBookAudienceSchema,
    priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    startsAt: isoDateTimeSchema.nullable().optional(),
    endsAt: isoDateTimeSchema.nullable().optional(),
  })
  .superRefine(datesRefinement);
export type PriceBookCreate = z.infer<typeof priceBookCreateSchema>;

/**
 * Body of `PATCH /api/v1/admin/price-books/:id`. The currency is not here: it is
 * immutable (FR-004). The audience kind may change only while the book has
 * never been active, which the service decides.
 */
export const priceBookPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    startsAt: isoDateTimeSchema.nullable().optional(),
    endsAt: isoDateTimeSchema.nullable().optional(),
    channelIds: priceBookChannelIdsSchema.optional(),
    audience: priceBookAudienceSchema.optional(),
  })
  .superRefine(datesRefinement);
export type PriceBookPatch = z.infer<typeof priceBookPatchSchema>;

// --- Rows --------------------------------------------------------------------

/** Derived from which selection coordinates are set; never stored. */
export const priceBookSelectionKindSchema = z.enum([
  'variant',
  'product',
  'category_attribute',
  'category',
  'attribute',
  'all',
]);
export type PriceBookSelectionKind = z.infer<typeof priceBookSelectionKindSchema>;

export const priceBookAttributeSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(255),
});
export type PriceBookAttribute = z.infer<typeof priceBookAttributeSchema>;

export const priceBookSelectionSchema = z.object({
  variantId: uuidSchema.nullable().optional(),
  productId: uuidSchema.nullable().optional(),
  categoryId: uuidSchema.nullable().optional(),
  attribute: priceBookAttributeSchema.nullable().optional(),
});
export type PriceBookSelection = z.infer<typeof priceBookSelectionSchema>;

/** `selectionKind` of a selection: variant > product > category ∩ attribute > category > attribute > all. */
export function priceBookSelectionKind(selection: {
  variantId?: string | null | undefined;
  productId?: string | null | undefined;
  categoryId?: string | null | undefined;
  attribute?: { key: string; value: string } | null | undefined;
}): PriceBookSelectionKind {
  if (selection.variantId) return 'variant';
  if (selection.productId) return 'product';
  if (selection.categoryId && selection.attribute) return 'category_attribute';
  if (selection.categoryId) return 'category';
  if (selection.attribute) return 'attribute';
  return 'all';
}

export const priceBookRowPriceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), amount: PRICE_BOOK_AMOUNT }),
  z.object({ type: z.literal('percent'), percent: PRICE_BOOK_PERCENT }),
  z.object({ type: z.literal('amount'), amount: PRICE_BOOK_SIGNED_AMOUNT }),
]);
export type PriceBookRowPrice = z.infer<typeof priceBookRowPriceSchema>;

/**
 * The cross-field rules of a row (FR-005, FR-006): the CHECK constraints of
 * `price_list_matrix_entries` that one field cannot express. One function so
 * the request schema and the service's merge-then-validate apply the same rules.
 */
export function priceBookRowShapeIssues(row: {
  selection: PriceBookSelection;
  minQuantity: number;
  maxQuantity: number | null;
  price: PriceBookRowPrice;
}): Array<{ path: string[]; message: string }> {
  const out: Array<{ path: string[]; message: string }> = [];
  const { selection } = row;
  const named = (selection.variantId ?? null) !== null || (selection.productId ?? null) !== null;
  if (named && ((selection.categoryId ?? null) !== null || (selection.attribute ?? null) !== null)) {
    out.push({
      path: ['selection'],
      message: 'A product or variant selection cannot be combined with a category or an attribute.',
    });
  }
  if (row.maxQuantity !== null && row.maxQuantity < row.minQuantity) {
    out.push({ path: ['maxQuantity'], message: 'maxQuantity must be at least minQuantity.' });
  }
  if (row.price.type === 'fixed' && priceBookSelectionKind(selection) === 'all') {
    out.push({ path: ['price', 'type'], message: 'A fixed price needs a selection other than all products.' });
  }
  return out;
}

export const priceBookRowInputSchema = z
  .object({
    id: uuidSchema.optional(),
    selection: priceBookSelectionSchema,
    minQuantity: POSITIVE_INT,
    maxQuantity: POSITIVE_INT.nullable().default(null),
    price: priceBookRowPriceSchema,
  })
  .superRefine((value, ctx) => {
    for (const issue of priceBookRowShapeIssues(value)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
export type PriceBookRowInput = z.infer<typeof priceBookRowInputSchema>;

/** At most this many rows per book, and per batch call (unchanged from feature 148). */
export const PRICE_BOOK_MAX_ROWS = 5000;
export const PRICE_BOOK_MAX_ROWS_PER_BATCH = 5000;

/** Body of `PUT /api/v1/admin/price-books/:id/rows` — one audited command (FR-035). */
export const priceBookRowBatchSchema = z
  .object({
    upsert: z.array(priceBookRowInputSchema).default([]),
    delete: z.array(uuidSchema).default([]),
  })
  .refine(
    (value) => value.upsert.length + value.delete.length <= PRICE_BOOK_MAX_ROWS_PER_BATCH,
    `A batch carries at most ${PRICE_BOOK_MAX_ROWS_PER_BATCH} rows.`,
  );
export type PriceBookRowBatch = z.infer<typeof priceBookRowBatchSchema>;

// --- Base prices (FR-009) -----------------------------------------------------

export const basePriceTierSchema = z.object({
  minQuantity: POSITIVE_INT,
  maxQuantity: POSITIVE_INT.nullable().default(null),
  amount: PRICE_BOOK_AMOUNT,
});
export type BasePriceTier = z.infer<typeof basePriceTierSchema>;

/**
 * A variant's base row: its own tiers, or a percentage or amount adjustment of
 * its product's base price at the same quantity (#377's three cases). `null`
 * in a write means "inherits the product's base".
 */
export const variantBaseRowSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), tiers: z.array(basePriceTierSchema).min(1).max(50) }),
  z.object({ type: z.literal('percent'), percent: PRICE_BOOK_PERCENT }),
  z.object({ type: z.literal('amount'), amount: PRICE_BOOK_SIGNED_AMOUNT }),
]);
export type VariantBaseRow = z.infer<typeof variantBaseRowSchema>;

export const basePricesForCurrencySchema = z.object({
  product: z.array(basePriceTierSchema).max(50),
  variants: z.record(uuidSchema, variantBaseRowSchema.nullable()).default({}),
});
export type BasePricesForCurrency = z.infer<typeof basePricesForCurrencySchema>;

/** Body of `PUT /api/v1/admin/price-books/base-prices/:productId` — one command across currencies. */
export const basePricesWriteSchema = z.object({
  byCurrency: z.record(CURRENCY, basePricesForCurrencySchema),
});
export type BasePricesWrite = z.infer<typeof basePricesWriteSchema>;

// --- Resolution: source, cells, explanation (FR-020) ----------------------------

/** Which tier priced a line (FR-030). */
export const priceSourceSchema = z.enum(['base', 'catalogue', 'buyer', 'sale']);
export type PriceSource = z.infer<typeof priceSourceSchema>;

/** What a cart or order line records about its unit price: a tier, or an agreed price. */
export const linePriceSourceSchema = z.enum(['agreed', 'base', 'catalogue', 'buyer', 'sale']);
export type LinePriceSource = z.infer<typeof linePriceSourceSchema>;

/** The twelve buyer cells: audience kind × selection kind (decision-record §5.6). */
export const PRICE_BOOK_CELL_CODES = [
  'org.variant',
  'org.product',
  'org.category_attribute',
  'org.category',
  'org.attribute',
  'org.all',
  'group.variant',
  'group.product',
  'group.category_attribute',
  'group.category',
  'group.attribute',
  'group.all',
] as const;
export const priceBookCellCodeSchema = z.enum(PRICE_BOOK_CELL_CODES);
export type PriceBookCellCode = z.infer<typeof priceBookCellCodeSchema>;

/** Most runner-up candidates an explanation lists. */
export const PRICE_BOOK_MAX_EXPLANATION_CANDIDATES = 10;

export const priceBookExplanationCandidateSchema = z.object({
  cell: priceBookCellCodeSchema.nullable(),
  bookId: uuidSchema,
  rowId: uuidSchema,
  amount: z.string(),
});

export const priceBookExplanationSchema = z.object({
  tier: priceSourceSchema.nullable(),
  cell: priceBookCellCodeSchema.nullable().optional(),
  bookId: uuidSchema.nullable().optional(),
  bookName: z.string().nullable().optional(),
  rowId: uuidSchema.nullable().optional(),
  /** The reference a percentage or adjustment was taken off, when one was. */
  reference: z.string().nullable().optional(),
  precedenceVersion: z.number().int().positive(),
  candidates: z
    .array(priceBookExplanationCandidateSchema)
    .max(PRICE_BOOK_MAX_EXPLANATION_CANDIDATES)
    .optional(),
});
export type PriceBookExplanation = z.infer<typeof priceBookExplanationSchema>;

// --- Precedence (FR-021–FR-023) -----------------------------------------------

export const precedenceDepthModeSchema = z.enum(['within_cell', 'nearest_organization_first']);
export type PrecedenceDepthMode = z.infer<typeof precedenceDepthModeSchema>;

export const precedencePresetNameSchema = z.enum(['AF', 'SF', 'HY', 'AF-N']);
export type PrecedencePresetName = z.infer<typeof precedencePresetNameSchema>;

/**
 * A precedence configuration: the order of the twelve buyer cells, the
 * category-before-attribute toggle and the depth mode. The shape is checked
 * here; the invariants I1–I5 are the pure `validatePrecedence` of
 * `price_lists`, which the resolver and the (P3) write path share.
 */
export const precedenceConfigSchema = z.object({
  cells: z
    .array(priceBookCellCodeSchema)
    .length(PRICE_BOOK_CELL_CODES.length)
    .refine((cells) => new Set(cells).size === cells.length, 'Every cell is named exactly once.'),
  categoryBeforeAttribute: z.boolean(),
  depthMode: precedenceDepthModeSchema,
});
export type PrecedenceConfigShape = z.infer<typeof precedenceConfigSchema>;

// --- Admin API (US7, `contracts/admin-price-books-api.md`) ---------------------

/** A channel binding of a book; `dormant` while the channel does not offer the book's currency (FR-011). */
export const priceBookChannelBindingSchema = z.object({
  channelId: uuidSchema,
  dormant: z.boolean(),
});
export type PriceBookChannelBinding = z.infer<typeof priceBookChannelBindingSchema>;

/**
 * A book as the admin reads it. `version` moves on every write to the book —
 * header, channel set, members, rows — and a write that names an older one is
 * refused `409 PRICE_BOOK_STALE` (G5). `tierStarts` is every `minQuantity` a
 * row of the book uses, ascending (G4): the grid's columns.
 */
export const priceBookSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: priceBookTypeSchema,
  status: priceBookStatusSchema,
  currencyCode: CURRENCY,
  audience: z.object({ kind: priceBookAudienceKindSchema, memberIds: z.array(uuidSchema) }),
  priority: z.number().int(),
  startsAt: isoDateTimeSchema.nullable(),
  endsAt: isoDateTimeSchema.nullable(),
  isSystem: z.boolean(),
  /** Whether the book was ever activated: the audience kind is fixed from then on (FR-004). */
  everActivated: z.boolean(),
  version: z.number().int().positive(),
  tierStarts: z.array(POSITIVE_INT),
  channels: z.array(priceBookChannelBindingSchema),
  rowCount: z.number().int().nonnegative(),
});
export type PriceBook = z.infer<typeof priceBookSchema>;

/** A row of a book that prices the product a book list was filtered by (G1). */
export const priceBookRowMatchSchema = z.object({
  rowId: uuidSchema,
  selectionKind: priceBookSelectionKindSchema,
  minQuantity: POSITIVE_INT,
  maxQuantity: POSITIVE_INT.nullable(),
  price: priceBookRowPriceSchema,
});
export type PriceBookRowMatch = z.infer<typeof priceBookRowMatchSchema>;

/** One line of the book list. */
export const priceBookSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: priceBookTypeSchema,
  status: priceBookStatusSchema,
  currencyCode: CURRENCY,
  audienceKind: priceBookAudienceKindSchema,
  priority: z.number().int(),
  startsAt: isoDateTimeSchema.nullable(),
  endsAt: isoDateTimeSchema.nullable(),
  isSystem: z.boolean(),
  version: z.number().int().positive(),
  tierStarts: z.array(POSITIVE_INT),
  channelCount: z.number().int().nonnegative(),
  memberCount: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  /** A book of organizations or customer groups that names no member. */
  appliesToNoOne: z.boolean(),
  /** A non-base book with no channel binding that is not dormant. */
  appliesNowhere: z.boolean(),
  /** Only on a list filtered by `productId`: the rows of this book that price it directly (G1). */
  matches: z.array(priceBookRowMatchSchema).optional(),
});
export type PriceBookSummary = z.infer<typeof priceBookSummarySchema>;

const PAGE = z.coerce.number().int().positive().default(1);
const PAGE_SIZE = z.coerce.number().int().positive().max(200).default(25);
const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(item).optional());

/**
 * `GET /api/v1/admin/price-books`. With `productId` (and optionally
 * `variantId`) the list holds only books with a row naming that product or
 * variant directly, each carrying its `matches` (G1).
 */
export const priceBookListQuerySchema = z.object({
  type: oneOrMany(priceBookTypeSchema),
  status: oneOrMany(priceBookStatusSchema),
  currency: CURRENCY.optional(),
  channelId: uuidSchema.optional(),
  audienceKind: priceBookAudienceKindSchema.optional(),
  memberId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  productId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  page: PAGE,
  pageSize: PAGE_SIZE,
});
export type PriceBookListQuery = z.infer<typeof priceBookListQuerySchema>;

export const pageMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
});

export const priceBookListResponseSchema = z.object({
  data: z.array(priceBookSummarySchema),
  meta: pageMetaSchema,
});
export type PriceBookListResponse = z.infer<typeof priceBookListResponseSchema>;

/** Body of `PATCH /api/v1/admin/price-books/:id`: the patch and the version it was made against (G5). */
export const priceBookPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    startsAt: isoDateTimeSchema.nullable().optional(),
    endsAt: isoDateTimeSchema.nullable().optional(),
    channelIds: priceBookChannelIdsSchema.optional(),
    audience: priceBookAudienceSchema.optional(),
    /** Required here or as an `If-Match` header. */
    expectedVersion: POSITIVE_INT.optional(),
  })
  .superRefine(datesRefinement);
export type PriceBookPatchRequest = z.infer<typeof priceBookPatchRequestSchema>;

/** Body of `POST /api/v1/admin/price-books/:id/duplicate` (FR-036). */
export const priceBookDuplicateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  channelIds: priceBookChannelIdsSchema.default([]),
  currencyCode: CURRENCY,
  audience: priceBookAudienceSchema,
  /** Fixed and amount rows are multiplied, half-up to 4 dp; percentages are copied verbatim. */
  amountMultiplier: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,6})?$/, 'non-negative decimal')
    .refine((v) => Number(v) > 0, 'The multiplier must be greater than zero.')
    .default('1'),
});
export type PriceBookDuplicate = z.infer<typeof priceBookDuplicateSchema>;

// --- Rows (admin) ---------------------------------------------------------------

/** Why a stored row prices nothing now (FR-016 of 161). */
export const priceBookRowInactiveReasonSchema = z.enum([
  'attribute_not_price_rule',
  'attribute_deleted',
  'target_deleted',
]);
export type PriceBookRowInactiveReason = z.infer<typeof priceBookRowInactiveReasonSchema>;

/**
 * The natural key of a row's selection (G10): what a CSV file names instead of
 * ids. `categoryPath` is the category's slugs from the root, joined by `/`;
 * `attribute.valueCode` is the option code stored on the row.
 */
export const priceBookNaturalKeySchema = z.object({
  productSku: z.string().trim().min(1).max(255).optional(),
  variantSku: z.string().trim().min(1).max(255).optional(),
  categoryPath: z.string().trim().min(1).max(2000).optional(),
  attribute: z.object({ key: z.string().min(1).max(64), valueCode: z.string().min(1).max(255) }).optional(),
});
export type PriceBookNaturalKey = z.infer<typeof priceBookNaturalKeySchema>;

/** Human labels of a row's selection, resolved in batch for the grid (G2). */
export const priceBookRowLabelsSchema = z.object({
  productName: z.string().nullable(),
  productSku: z.string().nullable(),
  variantLabel: z.string().nullable(),
  variantSku: z.string().nullable(),
  /** Category names from the root, joined by ` › `. */
  categoryPath: z.string().nullable(),
  attributeLabel: z.string().nullable(),
  attributeValueLabel: z.string().nullable(),
});
export type PriceBookRowLabels = z.infer<typeof priceBookRowLabelsSchema>;

export const priceBookRowSchema = z.object({
  id: uuidSchema,
  selectionKind: priceBookSelectionKindSchema,
  selection: z.object({
    variantId: uuidSchema.nullable(),
    productId: uuidSchema.nullable(),
    categoryId: uuidSchema.nullable(),
    attribute: priceBookAttributeSchema.nullable(),
  }),
  minQuantity: POSITIVE_INT,
  maxQuantity: POSITIVE_INT.nullable(),
  price: priceBookRowPriceSchema,
  inactiveReason: priceBookRowInactiveReasonSchema.nullable(),
  /** The product, variant or category the row names no longer exists (G2). */
  targetDeleted: z.boolean(),
  labels: priceBookRowLabelsSchema,
  naturalKey: priceBookNaturalKeySchema,
});
export type PriceBookRow = z.infer<typeof priceBookRowSchema>;

/** `GET /api/v1/admin/price-books/:id/rows`; `search` matches the labels and SKUs (G3). */
export const priceBookRowsQuerySchema = z.object({
  selectionKind: oneOrMany(priceBookSelectionKindSchema),
  productId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  attributeKey: z.string().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: PAGE,
  pageSize: z.coerce.number().int().positive().max(1000).default(200),
});
export type PriceBookRowsQuery = z.infer<typeof priceBookRowsQuerySchema>;

/**
 * One row of an admin batch: by ids (`selection`, the grid) or by natural key
 * (`key`, a CSV import) — exactly one of the two (G10). A row without an `id`
 * whose selection and `minQuantity` equal a stored row's replaces that row.
 */
export const priceBookBatchRowInputSchema = z
  .object({
    id: uuidSchema.optional(),
    selection: priceBookSelectionSchema.optional(),
    key: priceBookNaturalKeySchema.optional(),
    minQuantity: POSITIVE_INT,
    maxQuantity: POSITIVE_INT.nullable().default(null),
    price: priceBookRowPriceSchema,
  })
  .superRefine((value, ctx) => {
    if ((value.selection === undefined) === (value.key === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['selection'], message: 'A row names its selection by ids or by key, exactly one.' });
    }
  });
export type PriceBookBatchRowInput = z.infer<typeof priceBookBatchRowInputSchema>;

/**
 * Body of `PUT /api/v1/admin/price-books/:id/rows` (and of its `?dryRun=true`
 * preview, G10). `merge` (default) upserts the rows and deletes `delete`;
 * `replace` makes the book's rows exactly `upsert` (`delete` must be empty).
 */
export const priceBookRowsWriteSchema = z
  .object({
    expectedVersion: POSITIVE_INT.optional(),
    mode: z.enum(['merge', 'replace']).default('merge'),
    upsert: z.array(z.unknown()).max(PRICE_BOOK_MAX_ROWS_PER_BATCH).default([]),
    delete: z.array(uuidSchema).max(PRICE_BOOK_MAX_ROWS_PER_BATCH).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.upsert.length + value.delete.length > PRICE_BOOK_MAX_ROWS_PER_BATCH) {
      ctx.addIssue({ code: 'custom', path: ['upsert'], message: `A batch carries at most ${PRICE_BOOK_MAX_ROWS_PER_BATCH} rows.` });
    }
    if (value.mode === 'replace' && value.delete.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['delete'], message: 'A replace names no row to delete: every row not in the batch goes.' });
    }
  });
export type PriceBookRowsWrite = z.infer<typeof priceBookRowsWriteSchema>;

/**
 * Why one row of a batch was refused (G6). `index` is the row's position in
 * `upsert` (for an import, the file line the client maps it to); `rowId` names
 * a stored row (an overlap partner, a delete of a missing row).
 */
export const PRICE_BOOK_ROW_ERROR_CODES = [
  'PRICE_BOOK_ROW_SHAPE',
  'PRICE_BOOK_ROW_OVERLAP',
  'PRICE_BOOK_ROW_TARGET',
  'PRICE_BOOK_ROW_LIMIT',
] as const;
export const priceBookRowErrorSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  rowId: uuidSchema.optional(),
  field: z.string(),
  code: z.enum(PRICE_BOOK_ROW_ERROR_CODES),
  message: z.string(),
});
export type PriceBookRowError = z.infer<typeof priceBookRowErrorSchema>;

/** A stored or resolved row in a diff (no labels). */
export const priceBookDiffRowSchema = z.object({
  id: uuidSchema.optional(),
  selectionKind: priceBookSelectionKindSchema,
  selection: priceBookRowSchema.shape.selection,
  naturalKey: priceBookNaturalKeySchema,
  minQuantity: POSITIVE_INT,
  maxQuantity: POSITIVE_INT.nullable(),
  price: priceBookRowPriceSchema,
});
export type PriceBookDiffRow = z.infer<typeof priceBookDiffRowSchema>;

/** The answer of `PUT …/rows?dryRun=true` (G10): what the same body would write, writing nothing. */
export const priceBookRowsDryRunSchema = z.object({
  version: z.number().int().positive(),
  /** Each `upsert` row with its selection resolved to ids (`null` where it could not be). */
  resolved: z.array(priceBookDiffRowSchema.nullable()),
  diff: z.object({
    added: z.array(priceBookDiffRowSchema),
    changed: z.array(z.object({ before: priceBookDiffRowSchema, after: priceBookDiffRowSchema })),
    removed: z.array(priceBookDiffRowSchema),
    unchangedCount: z.number().int().nonnegative(),
  }),
  errors: z.array(priceBookRowErrorSchema),
});
export type PriceBookRowsDryRun = z.infer<typeof priceBookRowsDryRunSchema>;

/** The answer of a committed `PUT …/rows`. */
export const priceBookRowsWriteResultSchema = z.object({
  version: z.number().int().positive(),
  rows: z.array(priceBookDiffRowSchema),
});
export type PriceBookRowsWriteResult = z.infer<typeof priceBookRowsWriteResultSchema>;

// --- Explanation (FR-020, FR-038) ----------------------------------------------

export const PRICE_BOOK_MAX_RESOLVE_LINES = 200;

export const priceBookResolveRequestSchema = z.object({
  /** Absent: the system default channel, as the probe this replaces. */
  salesChannelId: uuidSchema.optional(),
  currencyCode: CURRENCY.optional(),
  buyer: z
    .object({
      organizationId: uuidSchema.optional(),
      customerAccountId: uuidSchema.optional(),
    })
    .default({}),
  lines: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        productId: uuidSchema,
        variantId: uuidSchema.optional(),
        quantity: POSITIVE_INT.default(1),
      }),
    )
    .min(1)
    .max(PRICE_BOOK_MAX_RESOLVE_LINES),
});
export type PriceBookResolveRequest = z.infer<typeof priceBookResolveRequestSchema>;

export const priceBookResolvedLineSchema = z.object({
  key: z.string(),
  price: z
    .object({
      amount: z.string(),
      currency: CURRENCY,
      source: priceSourceSchema,
      compareAt: z.string().nullable().optional(),
    })
    .nullable(),
  explanation: priceBookExplanationSchema,
});
export type PriceBookResolvedLine = z.infer<typeof priceBookResolvedLineSchema>;

// --- Precedence (read only until P3) --------------------------------------------

export const precedenceViewSchema = precedenceConfigSchema.extend({
  version: z.number().int().positive(),
  preset: precedencePresetNameSchema.nullable(),
});
export type PrecedenceView = z.infer<typeof precedenceViewSchema>;

// --- Settings (G8) ---------------------------------------------------------------

/** Setting code: show the catalogue price beside a lower buyer price (owner ruling Q8a, N4). */
export const SHOW_LIST_PRICE_SETTING_CODE = 'pricing.show_list_price';

/** Body of `PUT /api/v1/admin/price-books/settings/show-list-price`. */
export const showListPriceWriteSchema = z.object({ value: z.boolean() });
export type ShowListPriceWrite = z.infer<typeof showListPriceWriteSchema>;
