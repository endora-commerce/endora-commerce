import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeReadPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CatalogProductVariantRecord,
  DisplayMode,
  ListingPrice,
  ListingPriceDetail,
  PinnedPriceBookPublishability,
} from '@endora-commerce/contracts';
import { displayModeWithholdsAmounts } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { buildEligibleAttributes, type EligibleAttribute } from './attribute-eligibility.js';
import {
  createBookResolver,
  type BookPriceType,
  type BookResolution,
  type BookRow,
  type ResolverBook,
} from './book-resolver.js';
import type { PricingCache, ProfilePricingCacheKey } from './pricing-cache.js';
import {
  PricingProfileResolver,
  profileKey,
  type ProfileVectorEntry,
  type ApplicableBookRow,
  type ApplicableBooksQuery,
  type PricingProfile,
  type ProfileMemoKey,
} from './pricing-profile.js';
import { PrecedenceStore, type ActivePrecedence, type CellCode } from './precedence.js';
import type {
  PricedProductRef,
  PricingEngineResult,
  PricingLineRequest,
  PricingLineResult,
} from './pricing-service.interface.js';
import { compareDecimal } from './matrix-decimal.js';
import { pgArray } from './sql-array.js';

/** A listing card's answer: the lowest variant's (or the product's) resolution, and the range. */
export interface ListingAnswer {
  answer: BookLineAnswer | null;
  maxAmount: string | null;
  variesByVariant: boolean;
}

/** A profile's listing answer as the price surface stores it: no display mode (`BookPricing.resolveProfileListing`). */
export interface ProfileListingAnswer {
  resolution: BookResolution | null;
  maxAmount: string | null;
  variesByVariant: boolean;
}

/**
 * Which line answers a listing card, and the range beside it: the product's
 * own line when it has no variants; otherwise the lowest-priced variant's
 * ("from"), the highest variant price, and whether the variants differ.
 */
function rangeOverVariants(
  productId: string,
  variants: readonly CatalogProductVariantRecord[],
  resolutionOf: (key: string) => BookResolution | null,
): { key: string | null; maxAmount: string | null; variesByVariant: boolean } {
  if (variants.length === 0) return { key: productId, maxAmount: null, variesByVariant: false };
  let lowest: { key: string; amount: string } | null = null;
  let highest: string | null = null;
  const distinct = new Set<string>();
  for (const v of variants) {
    const key = `${productId}|${v.id}`;
    const amount = resolutionOf(key)?.price?.amount;
    if (amount === undefined) continue;
    distinct.add(amount);
    if (!lowest || compareDecimal(amount, lowest.amount) < 0) lowest = { key, amount };
    if (highest === null || compareDecimal(amount, highest) > 0) highest = amount;
  }
  return { key: lowest?.key ?? null, maxAmount: highest, variesByVariant: distinct.size > 1 };
}

/** The product's attribute values overlaid by the line's variant's axis values (FR-016). */
function effectiveAttributes(
  line: PricingLineRequest,
  variants: ReadonlyMap<string, CatalogProductVariantRecord>,
): Record<string, unknown> {
  const own = line.product.attributeValues ?? {};
  const variant = line.variantId ? variants.get(line.variantId) : undefined;
  if (!variant || variant.parentProductId !== line.product.id) return own;
  return { ...own, ...variant.variantAttributeValues };
}

/**
 * The price-book engine behind the batched entry points — feature 160,
 * `specs/160-pricing-model-v2/contracts/pricing-resolution-v2.md`.
 *
 * One batch costs a constant number of statements whatever the number of lines
 * (§3, the P0 budget): the channel's currencies, the applicable books with the
 * members the buyer can meet (one statement — the profile), their rows for the
 * batch's products and variants (one), the category assignments and the
 * eligible attributes through `catalog`'s ports (one call each, only when a row
 * needs them), and the display-mode chain (unchanged). Everything else is the
 * pure {@link createBookResolver}.
 *
 * **Tenancy (Principle XI).** No book id comes from a caller: the applicable
 * books are only those whose audience is everyone, a member of the buyer's own
 * organization chain or the buyer's effective group, and that is the `where`
 * clause of the one statement that reads them.
 *
 * **Channels (Principle XII).** A book applies on a channel of its set only
 * while that channel offers the book's currency; the set is read through the
 * registered bridge's sanctioned subquery
 * (`SalesChannelMembershipService.entityIdsInChannelSubquery`), never by naming
 * the table. A currency the channel does not offer prices nothing — base
 * included (K3.2): the guard fails closed.
 *
 * **Dates (FR-047).** A book applies while `status ∈ {active, scheduled}` and
 * `starts_at ≤ now < ends_at`, evaluated in the statement, so a start or an end
 * takes effect at its instant rather than at the next status sweep.
 */

export interface ChannelBridgeSubquery {
  entityIdsInChannelSubquery(channelId: string, entityType: 'price-list'): { sql: string; params: string[] };
}

/** What one resolved line is, for the viewer who asked. */
export interface BookLineAnswer {
  resolution: BookResolution;
  displayMode: DisplayMode;
  currencyCode: string;
}

/**
 * What one resolved line is, as the engine caches it under the pricing
 * profile: everything the profile decides, and **nothing the viewer does**.
 *
 * The profile is shared by every buyer who meets the same books — a guest and
 * an organization with no buyer book share the everyone profile — while the
 * display mode's tail is the viewer's own: the organization's override, and
 * which settings key answers (guest or signed-in). So only the product and
 * category steps of the chain, which no viewer moves, are cached
 * (`productDisplayMode`, `null` when neither decides); the tail is applied per
 * request (review finding 1 of release 0.108.0). The currency is not stored
 * either: the profile key carries it, so it is always the request's.
 */
export interface CachedBookLine {
  resolution: BookResolution;
  productDisplayMode: DisplayMode | null;
}

export interface BookPricingViewer {
  organizationId: string | null;
  customerGroupId: string | null;
  signedIn: boolean;
  salesChannelId: string;
  currencyCode: string;
}

export interface BookPricingDeps {
  emFactory: () => EntityManager;
  channelBridge: ChannelBridgeSubquery;
  resolveOrgChain?: (orgId: string) => Promise<readonly string[]>;
  categoryRead: () => CatalogCategoryReadPort;
  attributeRead: () => CatalogAttributeReadPort;
  /** `catalog`'s variants, for a variant's axis values (FR-016) and a listing's variant range (FR-024). */
  variantRead: () => Pick<CatalogProductReadPort, 'listVariantsByProductIds'>;
  /**
   * The display-mode chain's product and category steps (FR-039): the mode of
   * each product one of them decides; a product neither decides is absent.
   * Viewer-independent, so cached with the price.
   */
  productDisplayModes: (input: {
    productIds: readonly string[];
    categoryIdsByProduct: ReadonlyMap<string, ReadonlySet<string>>;
  }) => Promise<Map<string, DisplayMode>>;
  /**
   * Issue #491 — whether any product or category override is `none`: the only
   * way a product's own step can withhold it from every viewer. The price
   * surface's worker asks it once per chunk before it reads the product step,
   * which it otherwise does not need (issue #416). Absent, the step is read.
   */
  anyProductStepWithholds?: () => Promise<boolean>;
  /** The chain's tail — organization override, then settings — for the viewer. Never cached here. */
  viewerDisplayMode: (input: {
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
  }) => Promise<DisplayMode>;
  cache?: PricingCache<CachedBookLine, ProfilePricingCacheKey>;
  profileMemo?: PricingCache<PricingProfile, ProfileMemoKey>;
  /**
   * The viewer's tail, memoised under the pricing generation (review 2,
   * finding 4): see {@link ViewerModeKey}. Absent, the tail is read per call.
   * Its owner clears it on a bump; the generation in the key is the guard
   * against a write that commits while the tail is read.
   */
  viewerModeMemo?: PricingCache<DisplayMode, ViewerModeKey>;
}

/**
 * What the display-mode chain's tail (`PriceListService.resolvePageDisplayMode`)
 * depends on, and nothing else: the channel (its settings value), guest or
 * signed-in (which settings key answers) and — for a signed-in viewer only —
 * the organization (its override). A guest's organization is never read, so it
 * is not part of a guest's key.
 *
 * `generation` is the answer cache's generation when the tail was read. Every
 * write that can move the tail bumps it — an organization override
 * (`upsertDisplayModeOverride`), `setSettingsDisplayMode`, and a settings write
 * of either `pricing.*` display-mode key (the `settings.value_changed`
 * subscription in `index.ts`) — and the bump also clears the memo, so the key
 * is the second of two independent guards. Between processes the bump travels
 * over Redis; the memo's TTL, the cache's, bounds a lost announcement.
 */
export interface ViewerModeKey {
  generation: number;
  salesChannelId: string;
  customerKind: 'guest' | 'signed_in';
  organizationId: string | null;
}

/**
 * Whether a channel offers a currency: its `currencies`, and its default
 * currency, which is one of them by the channel's own invariant (read
 * defensively, so a channel row whose list was never filled still offers its
 * default). A channel that does not exist offers nothing.
 */
export async function channelOffers(em: EntityManager, channelId: string, currencyCode: string): Promise<boolean> {
  const channel = await em.findOne(SalesChannel, { id: channelId }, { fields: ['currencies', 'defaultCurrency'] });
  if (!channel) return false;
  const offered = [...(channel.currencies ?? []), channel.defaultCurrency]
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.toUpperCase());
  return offered.includes(currencyCode.toUpperCase());
}

/** The profile of a channel and currency that is not offered: no book applies. */
function emptyProfile(channelId: string, currencyCode: string, precedenceVersion: number): PricingProfile {
  return { key: `not-offered:${channelId}:${currencyCode}`, channelId, currencyCode, precedenceVersion, vector: [], books: [] };
}

/** A stable uuid-shaped id for a row the engine synthesises (the reference row of a named book read). */
function bracketRowId(productId: string, currencyCode: string, minQuantity: number): string {
  const hex = createHash('sha1').update(`${productId}|${currencyCode}|${minQuantity}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface MatrixRowRecord {
  id: string;
  price_list_id: string;
  variant_id: string | null;
  product_id: string | null;
  category_id: string | null;
  attribute_key: string | null;
  attribute_value: string | null;
  min_quantity: number;
  max_quantity: number | null;
  price_type: BookPriceType;
  amount: string | null;
  percent: string | null;
}

export class BookPricing {
  readonly precedence: PrecedenceStore;
  readonly profiles: PricingProfileResolver;

  constructor(private readonly deps: BookPricingDeps) {
    const cache = deps.cache;
    // The precedence memo follows the price cache: on while the cache is on,
    // dropped with it by the pricing generation.
    this.precedence = new PrecedenceStore(
      () => this.#loadPrecedence(),
      () => (cache?.enabled ? cache.generation : Number.NaN),
    );
    this.profiles = new PricingProfileResolver((query) => this.#loadApplicableBooks(query), deps.profileMemo);
  }

  /**
   * Drop every in-process layer this engine holds — its precedence memo. The
   * layers it is handed (`cache`, `profileMemo`, `viewerModeMemo`) are cleared
   * by their owner, the plugin's pricing generation, once per bump (review 3
   * of release 0.108.0, B2).
   */
  invalidateAll(): void {
    this.precedence.invalidateAll();
  }

  /**
   * The answer for every line, keyed by the line's key; `null` when nothing prices it.
   *
   * A resolution of a `fixedProfile` — the price surface's worker building a
   * profile with no buyer in hand, a feed's catalogue reference — neither
   * reads nor writes the cache: it is not a viewer's request, so it must not
   * seed what viewers are served, nor evict it (review finding 1). Nor does an
   * `explain` resolution, the only one that lists every runner-up: a cached
   * line carries the capped list, and the full one is not worth a place in the
   * shared cache (review 3, B1).
   */
  async resolve(
    lines: readonly PricingLineRequest[],
    viewer: BookPricingViewer,
    prefetchedVariants?: ReadonlyMap<string, CatalogProductVariantRecord>,
    /** A profile already resolved (the price surface builds a profile, not a buyer). */
    fixedProfile?: PricingProfile,
    /** `explain`: list every ranked runner-up (`BookExplanation.candidates`), uncached. */
    options: { explain?: boolean } = {},
  ): Promise<Map<string, BookLineAnswer | null>> {
    const out = new Map<string, BookLineAnswer | null>();
    if (lines.length === 0) return out;
    const { currencyCode, answered } = await this.#resolveLines(lines, viewer, prefetchedVariants, {
      kind: 'viewer',
      fixedProfile,
      explain: options.explain === true,
    });

    // The viewer's tail of the display-mode chain, once for the batch, and
    // only when a product step left a line undecided.
    const viewerMode = answered.some((a) => a.cached.productDisplayMode === null)
      ? await this.#viewerMode(viewer)
      : null;
    for (const { cached, keys } of answered) {
      const answer: BookLineAnswer = {
        resolution: cached.resolution,
        displayMode: cached.productDisplayMode ?? viewerMode ?? 'gross_only',
        currencyCode,
      };
      for (const key of keys) out.set(key, answer);
    }
    return out;
  }

  /**
   * The resolutions of a batch — what {@link resolve} answers before it applies
   * the viewer's tail of the display-mode chain, and what the price surface's
   * worker stores (issue #416). One switch says which:
   *
   * - `viewer` — a resolution for someone looking: each line carries the
   *   product step of its display-mode chain, and the line is cached unless it
   *   is a fixed profile's or an explanation;
   * - `surface` — the surface's worker resolving a whole profile: nothing
   *   read from or written to the cache, and of the display mode only the
   *   product step, and only while some product or category override is
   *   `none` ({@link BookPricingDeps.anyProductStepWithholds}) — a product that
   *   step withholds from every viewer is left out of the surface (issue #491);
   *   otherwise `productDisplayMode` is `null` on every line.
   */
  async #resolveLines(
    lines: readonly PricingLineRequest[],
    viewer: BookPricingViewer,
    prefetchedVariants: ReadonlyMap<string, CatalogProductVariantRecord> | undefined,
    mode: { kind: 'viewer'; fixedProfile: PricingProfile | undefined; explain: boolean } | { kind: 'surface'; profile: PricingProfile },
  ): Promise<{ currencyCode: string; answered: Array<{ cached: CachedBookLine; keys: string[] }> }> {
    const fixedProfile = mode.kind === 'surface' ? mode.profile : mode.fixedProfile;
    const explain = mode.kind === 'viewer' && mode.explain;
    const currencyCode = viewer.currencyCode.toUpperCase();
    const em = this.deps.emFactory();
    // Read before the first statement (`pricing-cache.ts`): a write that
    // commits while this resolution reads the channel, the precedence or the
    // profile invalidates, and the answer built on what was read before it is
    // then not stored (review finding 6 of release 0.108.0).
    const cache = mode.kind === 'viewer' && !fixedProfile && !explain ? this.deps.cache : undefined;
    const generation = cache?.generation;

    // K3.2 — a currency the channel does not offer prices nothing (the lines
    // still carry the viewer's display mode). A channel that does not exist
    // offers nothing either.
    const offered = await channelOffers(em, viewer.salesChannelId, currencyCode);

    const precedence = await this.precedence.active();
    const profile = !offered
      ? emptyProfile(viewer.salesChannelId, currencyCode, precedence.version)
      : (fixedProfile ?? (await this.#profileOf(viewer, currencyCode, precedence.version)));
    const keyOf = (line: PricingLineRequest): ProfilePricingCacheKey => ({
      profileKey: profile.key,
      productId: line.product.id,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
    });

    // One resolution per distinct (product, variant, quantity).
    const items = new Map<string, { line: PricingLineRequest; keys: string[] }>();
    for (const line of lines) {
      const id = `${line.product.id}|${line.variantId ?? ''}|${line.quantity}`;
      const item = items.get(id);
      if (item) item.keys.push(line.key);
      else items.set(id, { line, keys: [line.key] });
    }
    const answered: Array<{ cached: CachedBookLine; keys: string[] }> = [];
    const pending: Array<{ line: PricingLineRequest; keys: string[] }> = [];
    for (const item of items.values()) {
      const cached = cache?.get(keyOf(item.line));
      if (cached) answered.push({ cached, keys: item.keys });
      else pending.push(item);
    }

    if (pending.length > 0) {
      const productIds = [...new Set(pending.map((p) => p.line.product.id))];
      const variantIds = [
        ...new Set(pending.map((p) => p.line.variantId).filter((v): v is string => typeof v === 'string')),
      ];
      const books = [...profile.books];
      const rows = await this.#loadRows(
        em,
        books.map((b) => b.id),
        productIds,
        variantIds,
      );
      const categoryIdsByProduct = await this.#categoryMemberships(productIds);
      // FR-016 — a variant line matches attribute rows on the product's values
      // overlaid by the variant's axis values: one read of the batch's variants.
      let variants = prefetchedVariants ?? new Map<string, CatalogProductVariantRecord>();
      if (!prefetchedVariants && variantIds.length > 0) {
        const withVariant = [...new Set(pending.filter((p) => p.line.variantId).map((p) => p.line.product.id))];
        variants = new Map(
          (await this.deps.variantRead().listVariantsByProductIds(withVariant)).map((v) => [v.id, v]),
        );
      }
      let eligibleAttributes: ReadonlyMap<string, EligibleAttribute> = new Map();
      if (rows.some((r) => r.attributeKey !== null)) {
        eligibleAttributes = buildEligibleAttributes(await this.deps.attributeRead().listByFlag('isPriceRule'));
      }
      const resolver = createBookResolver({ books, rows, precedence, eligibleAttributes, explain });
      const productModes =
        mode.kind === 'viewer' || (await this.#productStepMayWithhold())
          ? await this.deps.productDisplayModes({ productIds, categoryIdsByProduct })
          : new Map<string, DisplayMode | null>();

      for (const { line, keys } of pending) {
        const resolution = resolver.resolve({
          productId: line.product.id,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
          categoryIds: categoryIdsByProduct.get(line.product.id) ?? new Set<string>(),
          attributes: effectiveAttributes(line, variants),
        });
        const cached: CachedBookLine = {
          resolution,
          productDisplayMode: productModes.get(line.product.id) ?? null,
        };
        cache?.set(keyOf(line), cached, generation);
        answered.push({ cached, keys });
      }
    }
    return { currencyCode, answered };
  }

  /** Whether a product's own display-mode step may withhold it — see {@link BookPricingDeps.anyProductStepWithholds}. */
  async #productStepMayWithhold(): Promise<boolean> {
    return this.deps.anyProductStepWithholds ? this.deps.anyProductStepWithholds() : true;
  }

  /**
   * The chain's tail for the viewer, read once per pricing generation and
   * viewer key ({@link ViewerModeKey}) rather than once per resolve: it costs up
   * to three statements, and a warm resolve whose every line is a hit issues
   * none otherwise. Memoised only while the answer cache is on (the harness
   * turns it off to read its own writes back at once).
   */
  async #viewerMode(viewer: BookPricingViewer): Promise<DisplayMode> {
    const customerKind = viewer.signedIn ? 'signed_in' : 'guest';
    const input = {
      organizationId: viewer.signedIn ? viewer.organizationId : null,
      salesChannelId: viewer.salesChannelId,
      customerKind,
    } as const;
    const memo = this.deps.cache?.enabled ? this.deps.viewerModeMemo : undefined;
    if (!memo) return this.deps.viewerDisplayMode(input);
    // Both read before the statements, so a write committing meanwhile leaves
    // the pre-write answer unstored (`pricing-cache.ts`).
    const key: ViewerModeKey = { generation: this.deps.cache!.generation, ...input };
    const memoGeneration = memo.generation;
    const memoised = memo.get(key);
    if (memoised !== undefined) return memoised;
    const mode = await this.deps.viewerDisplayMode(input);
    memo.set(key, mode, memoGeneration);
    return mode;
  }

  async #profileOf(viewer: BookPricingViewer, currencyCode: string, precedenceVersion: number): Promise<PricingProfile> {
    const organizationChain =
      viewer.organizationId === null
        ? []
        : this.deps.resolveOrgChain
          ? await this.deps.resolveOrgChain(viewer.organizationId)
          : [viewer.organizationId];
    return this.profiles.profileFor({
      channelId: viewer.salesChannelId,
      currencyCode,
      precedenceVersion,
      organizationChain,
      effectiveGroupId: viewer.customerGroupId,
    });
  }

  /**
   * The viewer's pricing profile and the everyone profile of its channel and
   * currency — what the price surface keys on — or `null` when the channel does
   * not offer the currency (K3.2: nothing is priced, so nothing is ordered).
   */
  async profilesFor(
    viewer: BookPricingViewer,
  ): Promise<{ buyer: PricingProfile; everyone: PricingProfile; precedenceVersion: number } | null> {
    const currencyCode = viewer.currencyCode.toUpperCase();
    const em = this.deps.emFactory();
    if (!(await channelOffers(em, viewer.salesChannelId, currencyCode))) return null;
    const precedence = await this.precedence.active();
    const buyer = await this.#profileOf(viewer, currencyCode, precedence.version);
    const everyone =
      buyer.vector.length === 0
        ? buyer
        : await this.#profileOf(
            { ...viewer, organizationId: null, customerGroupId: null, signedIn: false },
            currencyCode,
            precedence.version,
          );
    return { buyer, everyone, precedenceVersion: precedence.version };
  }

  /**
   * A profile rebuilt from its stored book vector (the surface worker builds a
   * profile with no buyer in hand): the vector's books at their audiences and
   * depths, beside the channel's everyone books and the currency's base book.
   * One statement. Books of the vector that no longer apply are left out.
   */
  async profileFromVector(input: {
    channelId: string;
    currencyCode: string;
    precedenceVersion: number;
    vector: readonly ProfileVectorEntry[];
  }): Promise<PricingProfile> {
    const em = this.deps.emFactory();
    const bridge = this.deps.channelBridge.entityIdsInChannelSubquery(input.channelId, 'price-list');
    const rows = await em.execute<
      Array<{ id: string; name: string; type: string; audience_kind: string; priority: number; is_system: boolean }>
    >(
      `select l."id", l."name", l."type", l."audience_kind", l."priority", l."is_system"
         from "price_lists" l
        where l."currency_code" = ?
          and (l."is_system" = true
               or (l."status" in ('active', 'scheduled')
                   and (l."starts_at" is null or l."starts_at" <= now())
                   and (l."ends_at" is null or l."ends_at" > now())
                   and l."id" in (${bridge.sql})
                   and (l."audience_kind" = 'everyone' or l."id" = any(?::uuid[]))))`,
      [input.currencyCode, ...bridge.params, pgArray(input.vector.map((v) => v.bookId))],
    );
    const entries = new Map(input.vector.map((v) => [v.bookId, v]));
    const books: ResolverBook[] = [];
    for (const r of rows) {
      const entry = entries.get(r.id);
      const audience: ResolverBook['audience'] =
        r.is_system || r.audience_kind === 'everyone'
          ? { kind: 'everyone' }
          : entry?.audienceKind === 'organizations'
            ? { kind: 'organizations', depth: entry.depth ?? 0 }
            : { kind: 'customer_groups' };
      books.push({
        id: r.id,
        name: r.name,
        type: r.type === 'sale' ? 'sale' : 'regular',
        isSystem: r.is_system,
        priority: Number(r.priority),
        audience,
      });
    }
    return {
      key: profileKey(input),
      channelId: input.channelId,
      currencyCode: input.currencyCode,
      precedenceVersion: input.precedenceVersion,
      vector: [...input.vector],
      books,
    };
  }

  /**
   * A listing at quantity 1 (FR-024): a product with variants is priced by
   * resolving every variant — the card shows the lowest ("from"), with the
   * highest beside it — and a product without variants by itself. One read of
   * the page's variants, then one batch.
   */
  async resolveListing(
    products: readonly PricedProductRef[],
    viewer: BookPricingViewer,
    fixedProfile?: PricingProfile,
  ): Promise<Map<string, ListingAnswer>> {
    const out = new Map<string, ListingAnswer>();
    if (products.length === 0) return out;
    const { lines, records, variantsByProduct } = await this.#listingLines(products);
    const answers = await this.resolve(lines, viewer, new Map(records.map((v) => [v.id, v])), fixedProfile);
    for (const product of products) {
      const ranged = rangeOverVariants(product.id, variantsByProduct.get(product.id) ?? [], (key) => answers.get(key)?.resolution ?? null);
      out.set(product.id, { answer: ranged.key === null ? null : (answers.get(ranged.key) ?? null), maxAmount: ranged.maxAmount, variesByVariant: ranged.variesByVariant });
    }
    return out;
  }

  /**
   * The listing of a fixed profile as the price surface stores it (issue
   * #416): the resolutions {@link resolveListing} answers for the profile's
   * guest viewer on its channel and currency — the same lines, the same
   * variant ranging — without the viewer's tail of the display-mode chain,
   * which the surface does not store. Uncached, like every fixed-profile
   * resolution.
   *
   * Issue #491 — a product whose own step of the chain (its override, else its
   * category's) is `none` answers `null`: it is withheld from every viewer, so
   * it has no place in a price order or a price range, and the catalogue walks
   * it in the unpriced tail. The step is read only while some product or
   * category override is `none` — otherwise it cannot withhold anything, and
   * reading it cost a whole build about 7 % of its time (issue #416).
   */
  async resolveProfileListing(
    products: readonly PricedProductRef[],
    profile: PricingProfile,
  ): Promise<Map<string, ProfileListingAnswer>> {
    const out = new Map<string, ProfileListingAnswer>();
    if (products.length === 0) return out;
    const { lines, records, variantsByProduct } = await this.#listingLines(products);
    const viewer: BookPricingViewer = {
      organizationId: null,
      customerGroupId: null,
      signedIn: false,
      salesChannelId: profile.channelId,
      currencyCode: profile.currencyCode,
    };
    const { answered } = await this.#resolveLines(lines, viewer, new Map(records.map((v) => [v.id, v])), { kind: 'surface', profile });
    const resolutions = new Map<string, BookResolution>();
    for (const { cached, keys } of answered) {
      if (cached.productDisplayMode !== null && displayModeWithholdsAmounts(cached.productDisplayMode)) continue;
      for (const key of keys) resolutions.set(key, cached.resolution);
    }
    for (const product of products) {
      const ranged = rangeOverVariants(product.id, variantsByProduct.get(product.id) ?? [], (key) => resolutions.get(key) ?? null);
      out.set(product.id, {
        resolution: ranged.key === null ? null : (resolutions.get(ranged.key) ?? null),
        maxAmount: ranged.maxAmount,
        variesByVariant: ranged.variesByVariant,
      });
    }
    return out;
  }

  /** A listing's lines: one per product without variants, one per variant otherwise — one read of the variants. */
  async #listingLines(products: readonly PricedProductRef[]): Promise<{
    lines: PricingLineRequest[];
    records: CatalogProductVariantRecord[];
    variantsByProduct: Map<string, CatalogProductVariantRecord[]>;
  }> {
    const variantsByProduct = new Map<string, CatalogProductVariantRecord[]>();
    const records = await this.deps.variantRead().listVariantsByProductIds(products.map((p) => p.id));
    for (const v of records) {
      const list = variantsByProduct.get(v.parentProductId);
      if (list) list.push(v);
      else variantsByProduct.set(v.parentProductId, [v]);
    }
    const lines: PricingLineRequest[] = [];
    for (const product of products) {
      const variants = variantsByProduct.get(product.id) ?? [];
      if (variants.length === 0) lines.push({ key: product.id, product, quantity: 1 });
      for (const v of variants) lines.push({ key: `${product.id}|${v.id}`, product, variantId: v.id, quantity: 1 });
    }
    return { lines, records, variantsByProduct };
  }

  /**
   * FR-029, owner ruling 2026-10-23 — whether a book pinned to a feed on this
   * channel and currency publishes prices now, and why not. A feed is fetched
   * by a provider, which is nobody's buyer: the book must price an anonymous
   * buyer on the channel now — `active` or `scheduled` inside its window
   * (FR-047, evaluated now, not at the status sweep), bound to the channel with
   * the channel offering the currency (the bridge's sanctioned subquery,
   * Principle XII; a base book is channel-independent), and for everyone (an
   * organization's or a group's prices never reach an anonymous file,
   * Principle XI). One statement, plus the channel's currencies.
   */
  async namedBookPublishability(input: {
    bookId: string;
    salesChannelId: string;
    currencyCode: string;
  }): Promise<PinnedPriceBookPublishability> {
    const em = this.deps.emFactory();
    const bridge = this.deps.channelBridge.entityIdsInChannelSubquery(input.salesChannelId, 'price-list');
    const [book] = await em.execute<
      Array<{
        currency_code: string;
        is_system: boolean;
        status: string;
        in_window: boolean;
        on_channel: boolean;
        audience_kind: string;
      }>
    >(
      `select l."currency_code", l."is_system", l."status", l."audience_kind",
              ((l."starts_at" is null or l."starts_at" <= now()) and (l."ends_at" is null or l."ends_at" > now())) as "in_window",
              (l."id" in (${bridge.sql})) as "on_channel"
         from "price_lists" l where l."id" = ?`,
      [...bridge.params, input.bookId],
    );
    const no = (reason: Extract<PinnedPriceBookPublishability, { publishable: false }>['reason']): PinnedPriceBookPublishability => ({
      publishable: false,
      reason,
    });
    if (!book) return no('not_found');
    const currencyCode = input.currencyCode.toUpperCase();
    if (book.currency_code.trim().toUpperCase() !== currencyCode) return no('currency_mismatch');
    if (book.is_system) return { publishable: true };
    if (book.status !== 'active' && book.status !== 'scheduled') return no('not_active');
    if (!book.in_window) return no('outside_schedule');
    if (!book.on_channel || !(await channelOffers(em, input.salesChannelId, currencyCode))) return no('not_on_channel');
    if (book.audience_kind !== 'everyone') return no('audience_restricted');
    return { publishable: true };
  }

  /**
   * FR-029 — what a feed pinned to one book reads: the book's rows at quantity 1
   * over the catalogue price of the channel and currency (what a guest's
   * catalogue tier answers **without the pinned book**, so a pinned catalogue
   * book's percentage is taken off the price it would otherwise replace, never
   * off itself), ranked as the book's own selections rank. A product the book
   * does not price is absent. The base book answers its base prices. Nothing at
   * all while the book does not publish ({@link namedBookPublishability}).
   * Two resolutions' worth of statements for the whole batch.
   */
  async namedBookPrices(input: {
    bookId: string;
    salesChannelId: string;
    currencyCode: string;
    products: readonly PricedProductRef[];
  }): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (input.products.length === 0) return out;
    if (!(await this.namedBookPublishability(input)).publishable) return out;
    const em = this.deps.emFactory();
    const currencyCode = input.currencyCode.toUpperCase();
    const [header] = await em.execute<Array<{ id: string; name: string; is_system: boolean; currency_code: string }>>(
      `select "id", "name", "is_system", "currency_code" from "price_lists" where "id" = ?`,
      [input.bookId],
    );
    if (!header) return out;
    const guestViewer: BookPricingViewer = {
      organizationId: null,
      customerGroupId: null,
      signedIn: false,
      salesChannelId: input.salesChannelId,
      currencyCode,
    };
    const precedence = await this.precedence.active();
    const guestProfile = await this.#profileOf(guestViewer, currencyCode, precedence.version);
    const withoutBook: PricingProfile = header.is_system
      ? guestProfile
      : {
          ...guestProfile,
          key: `${guestProfile.key}:without:${header.id}`,
          books: guestProfile.books.filter((b) => b.id !== header.id),
        };
    const guest = await this.resolve(
      input.products.map((product) => ({ key: product.id, product, quantity: 1 })),
      guestViewer,
      undefined,
      withoutBook,
    );
    if (header.is_system) {
      for (const product of input.products) {
        const base = guest.get(product.id)?.resolution.base?.amount;
        if (base !== undefined) out.set(product.id, base);
      }
      return out;
    }
    const productIds = input.products.map((p) => p.id);
    const rows = (await this.#loadRows(em, [input.bookId], productIds, [])).filter((r) => r.variantId === null);
    // The catalogue price stands as the base the book's rows are taken off.
    const reference: BookRow[] = [];
    for (const product of input.products) {
      const answer = guest.get(product.id);
      const catalogue = answer?.resolution.catalogue?.amount ?? answer?.resolution.base?.amount;
      if (catalogue === undefined) continue;
      reference.push({
        id: bracketRowId(product.id, `${currencyCode}:reference`, 1),
        bookId: '__reference__',
        variantId: null,
        productId: product.id,
        categoryId: null,
        attributeKey: null,
        attributeValue: null,
        minQuantity: 1,
        maxQuantity: null,
        priceType: 'fixed',
        amount: catalogue,
        percent: null,
      });
    }
    const categoryIdsByProduct = await this.#categoryMemberships(productIds);
    const eligibleAttributes = rows.some((r) => r.attributeKey !== null)
      ? buildEligibleAttributes(await this.deps.attributeRead().listByFlag('isPriceRule'))
      : new Map<string, EligibleAttribute>();
    const resolver = createBookResolver({
      books: [
        { id: '__reference__', name: 'reference', type: 'regular', isSystem: true, priority: 0, audience: { kind: 'everyone' } },
        { id: header.id, name: header.name, type: 'regular', isSystem: false, priority: 0, audience: { kind: 'everyone' } },
      ],
      rows: [...reference, ...rows],
      precedence,
      eligibleAttributes,
    });
    for (const product of input.products) {
      const resolution = resolver.resolve({
        productId: product.id,
        variantId: null,
        quantity: 1,
        categoryIds: categoryIdsByProduct.get(product.id) ?? new Set<string>(),
        attributes: product.attributeValues ?? {},
      });
      if (resolution.catalogue) out.set(product.id, resolution.catalogue.amount);
    }
    return out;
  }

  async #loadPrecedence(): Promise<ActivePrecedence | null> {
    const em = this.deps.emFactory();
    const rows = await em.execute<
      Array<{ version: number; cells: CellCode[]; category_before_attribute: boolean; depth_mode: string }>
    >(
      `select "version", "cells", "category_before_attribute", "depth_mode"
         from "price_list_precedence" where "state" = 'active' limit 1`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      version: Number(row.version),
      config: {
        cells: row.cells,
        categoryBeforeAttribute: row.category_before_attribute,
        depthMode: row.depth_mode === 'nearest_organization_first' ? 'nearest_organization_first' : 'within_cell',
      },
    };
  }

  /**
   * The applicable books of a (channel, currency) for one buyer, with the
   * members of the buyer's chain or group that matched — one statement. The
   * base book of the currency is always among them (channel-independent by
   * D-287 §5.1).
   */
  async #loadApplicableBooks(query: ApplicableBooksQuery): Promise<ApplicableBookRow[]> {
    const em = this.deps.emFactory();
    const bridge = this.deps.channelBridge.entityIdsInChannelSubquery(query.channelId, 'price-list');
    const rows = await em.execute<
      Array<{
        id: string;
        name: string;
        type: 'base' | 'regular' | 'sale';
        audience_kind: ApplicableBookRow['audienceKind'];
        priority: number;
        is_system: boolean;
        member_organization_id: string | null;
        member_customer_group_id: string | null;
      }>
    >(
      `select l."id", l."name", l."type", l."audience_kind", l."priority", l."is_system",
              m."organization_id" as "member_organization_id",
              m."customer_group_id" as "member_customer_group_id"
         from "price_lists" l
         left join "price_list_audience_members" m
           on m."price_list_id" = l."id"
          and (m."organization_id" = any(?::uuid[]) or m."customer_group_id" = ?::uuid)
        where l."currency_code" = ?
          and (
            l."is_system" = true
            or (
              l."status" in ('active', 'scheduled')
              and (l."starts_at" is null or l."starts_at" <= now())
              and (l."ends_at" is null or l."ends_at" > now())
              and l."id" in (${bridge.sql})
              and (l."audience_kind" = 'everyone' or m."id" is not null)
            )
          )`,
      [pgArray(query.organizationIds), query.customerGroupId, query.currencyCode, ...bridge.params],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      audienceKind: r.audience_kind,
      priority: Number(r.priority),
      isSystem: r.is_system,
      memberOrganizationId: r.member_organization_id,
      memberCustomerGroupId: r.member_customer_group_id,
    }));
  }

  /** The rows of the applicable books a batch can meet — one statement. */
  async #loadRows(
    em: EntityManager,
    bookIds: readonly string[],
    productIds: readonly string[],
    variantIds: readonly string[],
  ): Promise<BookRow[]> {
    if (bookIds.length === 0) return [];
    const rows = await em.execute<MatrixRowRecord[]>(
      `select "id", "price_list_id", "variant_id", "product_id", "category_id", "attribute_key",
              "attribute_value", "min_quantity", "max_quantity", "price_type", "amount", "percent"
         from "price_list_matrix_entries"
        where "price_list_id" = any(?::uuid[])
          and "price_type" in ('fixed', 'percent', 'amount')
          and ("product_id" is null or "product_id" = any(?::uuid[]))
          and ("variant_id" is null or "variant_id" = any(?::uuid[]))`,
      [pgArray(bookIds), pgArray(productIds), pgArray(variantIds)],
    );
    return rows.map((r) => ({
      id: r.id,
      bookId: r.price_list_id,
      variantId: r.variant_id,
      productId: r.product_id,
      categoryId: r.category_id,
      attributeKey: r.attribute_key,
      attributeValue: r.attribute_value,
      minQuantity: Number(r.min_quantity),
      maxQuantity: r.max_quantity === null ? null : Number(r.max_quantity),
      priceType: r.price_type,
      amount: r.amount === null ? null : String(r.amount),
      percent: r.percent === null ? null : String(r.percent),
    }));
  }

  /** `(product, category)` memberships for the batch, through `catalog`'s port — one call. */
  async #categoryMemberships(productIds: readonly string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (const id of productIds) out.set(id, new Set<string>());
    if (productIds.length === 0) return out;
    for (const assignment of await this.deps.categoryRead().listAssignmentsForProducts(productIds)) {
      out.get(assignment.productId)?.add(assignment.categoryId);
    }
    return out;
  }
}

// ---- Mapping onto the published result shapes --------------------------------
//
// Issue #491 — the one place display mode `none` withholds amounts: a listing
// (`listingPriceFromBook`, `listingDetailFromBook`) and an engine answer
// (`engineFromBook`) resolved to `none` for the viewer carry no amount, no
// book and no tier, whatever the books priced; the display mode stays, so the
// storefront says "price on request". Every catalogue surface — the listing,
// the product page, the home page, search hits and suggestions, comparisons,
// product links and the resolved-price endpoint — reads these, and none of
// them restates the rule. A line (`lineFromBook`) keeps its amount: it is the
// charging path, whose consumers refuse `none` as quote-only.

/** Whether the answer is withheld from its viewer (issue #491). */
function withheld(answer: BookLineAnswer | null): boolean {
  return answer !== null && displayModeWithholdsAmounts(answer.displayMode);
}

/**
 * The charged line, as `resolveLinePrice(s)` answers it — amount included under
 * display mode `none`, which the cart and order intake refuse as quote-only by
 * the mode beside it. A consumer that publishes it to a viewer withholds it
 * first (`displayModeWithholdsAmounts`).
 */
export function lineFromBook(answer: BookLineAnswer | null): PricingLineResult | null {
  const price = answer?.resolution.price ?? null;
  if (!answer || !price) return null;
  return {
    amount: price.amount,
    currency: answer.currencyCode,
    priceListId: price.bookId,
    isSale: price.source === 'sale',
    bracketStartQuantity: price.startQuantity,
    displayMode: answer.displayMode,
    matrixEntryId: price.rowId,
    source: price.source,
    compareAt: price.compareAt,
    explanation: answer.resolution.explanation,
  };
}

/**
 * The listing chain on price books: the resolved price, or `none` (FR-018).
 * There is no "product's own price" arm any more — a product no tier prices is
 * unpriced, and follows the quote-only path. A product whose display mode is
 * `none` for the viewer is the `none` arm too (issue #491).
 */
export function listingPriceFromBook(
  answer: BookLineAnswer | null,
  range?: { maxAmount: string | null; variesByVariant: boolean },
): ListingPrice {
  const price = answer?.resolution.price ?? null;
  if (!answer || !price || withheld(answer)) return { source: 'none' };
  return {
    ...(range?.variesByVariant ? { variesByVariant: true } : {}),
    ...(range?.maxAmount ? { maxAmount: range.maxAmount } : {}),
    source: 'price_list',
    amount: price.amount,
    currency: answer.currencyCode,
    priceListId: price.bookId,
    isSale: price.source === 'sale',
    priceSource: price.source,
    ...(price.compareAt !== null && price.source === 'sale' ? { compareAtAmount: price.compareAt } : {}),
  };
}

/**
 * The catalogue price beside a lower buyer price (G9 of `specs/161-price-book-editor/`,
 * owner ruling Q8a, N4; vectors D1–D4 of `worked-examples.md` §10.15): the
 * everyone price of the channel — its catalogue price, else the base — when
 * `pricing.show_list_price` is on and it is **above** the price charged.
 * Nothing otherwise, so a surcharge or an equal price shows one price.
 */
export function listPriceOf(
  answer: BookLineAnswer | null,
  showListPrice: boolean,
): { amount: string; currency: string } | undefined {
  if (!showListPrice || !answer || withheld(answer)) return undefined;
  const r = answer.resolution;
  const charged = r.price?.amount ?? null;
  const everyone = r.catalogue?.amount ?? r.base?.amount ?? null;
  if (charged === null || everyone === null || compareDecimal(everyone, charged) <= 0) return undefined;
  return { amount: everyone, currency: answer.currencyCode };
}

/**
 * The base / sale / tier split from the same resolution — every amount `null`
 * (and no list price) when the viewer's display mode is `none` (issue #491).
 */
export function listingDetailFromBook(
  answer: BookLineAnswer | null,
  range?: { maxAmount: string | null; variesByVariant: boolean },
  showListPrice = false,
): ListingPriceDetail {
  const price = listingPriceFromBook(answer, range);
  const currency = answer?.currencyCode ?? '';
  const money = (amount: string | null | undefined) => (amount ? { amount, currency } : null);
  const r = withheld(answer) ? null : (answer?.resolution ?? null);
  const regular = r ? (r.buyer?.amount ?? r.catalogue?.amount ?? r.base?.amount ?? null) : null;
  const saleCharged = r?.price?.source === 'sale';
  const listPrice = listPriceOf(answer, showListPrice);
  return {
    price,
    ...(listPrice ? { listPrice } : {}),
    basePrice: money(regular),
    salePrice: saleCharged ? money(r!.price!.amount) : null,
    displayMode: answer?.displayMode ?? 'gross_only',
    tiers: {
      base: money(r?.base?.amount),
      catalogue: money(r?.catalogue?.amount),
      buyer: money(r?.buyer?.amount),
      sale: money(r?.sale?.amount),
    },
  };
}

/**
 * The legacy engine shape, for `resolveEngine` callers: the regular price, and
 * the sale when charged. Under the viewer's display mode `none` it names no
 * book, no bracket, no sale and no source (issue #491): `resolveEngine` answers
 * the storefront's resolved-price endpoint.
 */
export function engineFromBook(
  answer: BookLineAnswer | null,
  productId: string,
  currencyCode: string,
  showListPrice = false,
): PricingEngineResult {
  const r = withheld(answer) ? null : (answer?.resolution ?? null);
  const listPrice = listPriceOf(answer, showListPrice);
  const regular = r ? (r.buyer ?? r.catalogue ?? r.base) : null;
  const charged = r?.price ?? null;
  return {
    base: {
      listId: regular?.bookId ?? '',
      listName: regular?.bookName ?? '',
      bracket: regular
        ? {
            priceListId: regular.bookId,
            productId,
            currencyCode: answer!.currencyCode,
            minQuantity: regular.startQuantity,
            maxQuantity: regular.endQuantity,
            amount: regular.amount,
            matrixEntryId: regular.rowId,
          }
        : null,
    },
    sale:
      charged && charged.source === 'sale' && r?.sale
        ? {
            listId: r.sale.bookId,
            listName: r.sale.bookName,
            bracket: {
              priceListId: r.sale.bookId,
              productId,
              currencyCode: answer!.currencyCode,
              minQuantity: r.sale.startQuantity,
              maxQuantity: r.sale.endQuantity,
              amount: r.sale.amount,
              matrixEntryId: r.sale.rowId,
            },
          }
        : null,
    displayMode: answer?.displayMode ?? 'gross_only',
    currencyCode: answer?.currencyCode ?? currencyCode,
    source: charged?.source ?? null,
    compareAt: charged?.compareAt ?? null,
    ...(listPrice ? { listPrice } : {}),
  };
}
