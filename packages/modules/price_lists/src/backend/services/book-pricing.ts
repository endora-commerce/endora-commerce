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

/** A listing card's answer: the lowest variant's (or the product's) resolution, and the range. */
export interface ListingAnswer {
  answer: BookLineAnswer | null;
  maxAmount: string | null;
  variesByVariant: boolean;
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

/** What one resolved line is, as the engine caches it. */
export interface BookLineAnswer {
  resolution: BookResolution;
  displayMode: DisplayMode;
  currencyCode: string;
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
  displayModes: (input: {
    productIds: readonly string[];
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
    categoryIdsByProduct: ReadonlyMap<string, ReadonlySet<string>>;
  }) => Promise<Map<string, DisplayMode>>;
  cache?: PricingCache<BookLineAnswer, ProfilePricingCacheKey>;
  profileMemo?: PricingCache<PricingProfile, ProfileMemoKey>;
}

const uuidArray = (ids: readonly string[]): string => `{${ids.join(',')}}`;

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

  /** Drop every in-process layer this engine holds. */
  invalidateAll(): void {
    this.precedence.invalidateAll();
  }

  /** The answer for every line, keyed by the line's key; `null` when nothing prices it. */
  async resolve(
    lines: readonly PricingLineRequest[],
    viewer: BookPricingViewer,
    prefetchedVariants?: ReadonlyMap<string, CatalogProductVariantRecord>,
    /** A profile already resolved (the price surface builds a profile, not a buyer). */
    fixedProfile?: PricingProfile,
  ): Promise<Map<string, BookLineAnswer | null>> {
    const out = new Map<string, BookLineAnswer | null>();
    if (lines.length === 0) return out;
    const currencyCode = viewer.currencyCode.toUpperCase();
    const em = this.deps.emFactory();

    // K3.2 — a currency the channel does not offer prices nothing (the lines
    // still carry the viewer's display mode). A channel that does not exist
    // offers nothing either.
    const offered = await channelOffers(em, viewer.salesChannelId, currencyCode);

    const precedence = await this.precedence.active();
    const profile = !offered
      ? emptyProfile(viewer.salesChannelId, currencyCode, precedence.version)
      : (fixedProfile ?? (await this.#profileOf(viewer, currencyCode, precedence.version)));

    const cache = this.deps.cache;
    const generation = cache?.generation;
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
    const pending: Array<{ line: PricingLineRequest; keys: string[] }> = [];
    for (const item of items.values()) {
      const cached = cache?.get(keyOf(item.line));
      if (cached) for (const key of item.keys) out.set(key, cached);
      else pending.push(item);
    }
    if (pending.length === 0) return out;

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
    const resolver = createBookResolver({ books, rows, precedence, eligibleAttributes });
    const displayModes = await this.deps.displayModes({
      productIds,
      organizationId: viewer.organizationId,
      salesChannelId: viewer.salesChannelId,
      customerKind: viewer.signedIn ? 'signed_in' : 'guest',
      categoryIdsByProduct,
    });

    for (const { line, keys } of pending) {
      const resolution = resolver.resolve({
        productId: line.product.id,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
        categoryIds: categoryIdsByProduct.get(line.product.id) ?? new Set<string>(),
        attributes: effectiveAttributes(line, variants),
      });
      const answer: BookLineAnswer = {
        resolution,
        displayMode: displayModes.get(line.product.id) ?? 'gross_only',
        currencyCode,
      };
      cache?.set(keyOf(line), answer, generation);
      for (const key of keys) out.set(key, answer);
    }
    return out;
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
      [input.currencyCode, ...bridge.params, uuidArray(input.vector.map((v) => v.bookId))],
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
    const answers = await this.resolve(lines, viewer, new Map(records.map((v) => [v.id, v])), fixedProfile);
    for (const product of products) {
      const variants = variantsByProduct.get(product.id) ?? [];
      if (variants.length === 0) {
        out.set(product.id, { answer: answers.get(product.id) ?? null, maxAmount: null, variesByVariant: false });
        continue;
      }
      let lowest: BookLineAnswer | null = null;
      let highest: string | null = null;
      const distinct = new Set<string>();
      for (const v of variants) {
        const answer = answers.get(`${product.id}|${v.id}`) ?? null;
        const amount = answer?.resolution.price?.amount;
        if (!answer || amount === undefined) continue;
        distinct.add(amount);
        if (!lowest || compareDecimal(amount, lowest.resolution.price!.amount) < 0) lowest = answer;
        if (highest === null || compareDecimal(amount, highest) > 0) highest = amount;
      }
      out.set(product.id, { answer: lowest, maxAmount: highest, variesByVariant: distinct.size > 1 });
    }
    return out;
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
      [uuidArray(query.organizationIds), query.customerGroupId, query.currencyCode, ...bridge.params],
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
      [uuidArray(bookIds), uuidArray(productIds), uuidArray(variantIds)],
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

/** The charged line, as `resolveLinePrice(s)` answers it. */
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
 * unpriced, and follows the quote-only path.
 */
export function listingPriceFromBook(
  answer: BookLineAnswer | null,
  range?: { maxAmount: string | null; variesByVariant: boolean },
): ListingPrice {
  const price = answer?.resolution.price ?? null;
  if (!answer || !price) return { source: 'none' };
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
  if (!showListPrice || !answer) return undefined;
  const r = answer.resolution;
  const charged = r.price?.amount ?? null;
  const everyone = r.catalogue?.amount ?? r.base?.amount ?? null;
  if (charged === null || everyone === null || compareDecimal(everyone, charged) <= 0) return undefined;
  return { amount: everyone, currency: answer.currencyCode };
}

/** The base / sale / tier split from the same resolution. */
export function listingDetailFromBook(
  answer: BookLineAnswer | null,
  range?: { maxAmount: string | null; variesByVariant: boolean },
  showListPrice = false,
): ListingPriceDetail {
  const price = listingPriceFromBook(answer, range);
  const currency = answer?.currencyCode ?? '';
  const money = (amount: string | null | undefined) => (amount ? { amount, currency } : null);
  const r = answer?.resolution ?? null;
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

/** The legacy engine shape, for `resolveEngine` callers: the regular price, and the sale when charged. */
export function engineFromBook(
  answer: BookLineAnswer | null,
  productId: string,
  currencyCode: string,
  showListPrice = false,
): PricingEngineResult {
  const r = answer?.resolution ?? null;
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
