import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  ERROR_CODES,
  isOrderMinimumEligibleType,
  isProductVisibleTo,
  minimumRefusal,
  pickLocalized,
  type CartBatchLineInput,
  type CartBatchLineOutcome,
  type CartMergeOutcome,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type {
  CatalogPackagingUnitRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
  LinePricesPort,
  ProductDisplayModePort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { outOfRequestChannel, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { CartApprovalService } from './cart-approval-service.js';
import type { CartAuditService } from './cart-audit-service.js';
import type { CartRecomputeCache } from './cart-recompute-cache.js';
import {
  CartLinePricing,
  agreementOf,
  type CartLinePriceAnswer,
  type CartPricingContext,
} from './cart-line-pricing.js';
import {
  assertCartChangeMeetsMinimums,
  judgeCartBatch,
  toCartMinimumItem,
  type CartBatchRejection,
  type CartMinimumItem,
} from './cart-minimums.js';

/**
 * CartService (T125).
 *
 * Two cart shapes:
 *   - Anonymous: identified by a caller-held cookie token. No customer or
 *     organization attached.
 *   - Authenticated: the customer's single active cart.
 *
 * At login, the existing anonymous cart (if any) is merged into the
 * authenticated cart — duplicate lines have their quantities summed.
 */

export interface AnonymousContext {
  anonymousCartToken: string;
}

export interface CustomerContext {
  customerAccountId: string;
  /**
   * Feature 026 US2 — null for guest-style Customer accounts that have no
   * Organization. Carts already persist `organization_id` nullable, so the
   * service handles either case (no-org carts fall back to platform-default
   * prices via PricingService).
   */
  organizationId: string | null;
  /**
   * The channel whose basket is meant (`specs/154-sales-channel-access/`,
   * FR-030): a customer holds one active basket per channel, and every lookup
   * and every price is that channel's.
   */
  salesChannelId: string;
}

/**
 * Who a cart operation speaks for. A customer's basket is the one of
 * `customer.salesChannelId`; an anonymous one is the basket the cookie token
 * names **on `anonymousSalesChannelId`** — the request's channel, which the
 * storefront route passes. A token whose basket is on another channel names no
 * basket here (contracts/basket-attribution.md §1).
 */
export interface CartActor {
  customer?: CustomerContext;
  anonymousToken?: string;
  anonymousSalesChannelId?: string;
}

/**
 * Cart-line hard cap (feature 027 FR-001 / spec edge case "Cart contents
 * cap"). The 201st distinct line is refused with HTTP 422.
 */
export const CART_MAX_LINES = 200;

/**
 * The smallest quantity a cart line may hold. Carried in the refusal's
 * `details.minimum`, which is what both bundle sentences name (issue #86).
 */
export const CART_LINE_MIN_QUANTITY = 1;

/** One line a shopper asks to put in their cart (`addItem`'s input). */
export interface CartLineInput {
  productId: string;
  variantId?: string;
  /** Pieces, or units when `packagingUnitId` is set. */
  quantity: number;
  packagingUnitId?: string;
  /** Set only by a caller that names the channel itself (admin order creation). */
  salesChannelId?: string;
}

/** A line that has passed `addItem`'s preconditions (feature 155, R8). */
interface ResolvedCartLine {
  product: CatalogProductRecord;
  packagingUnit: CatalogPackagingUnitRecord | null;
  /** Base pieces. */
  effectiveQuantity: number;
}

export class CartService {
  /**
   * `pricingService` is **required** since issue #124. It used to be optional
   * "for test rigs", and the cart then read the legacy
   * `attributeValues['defaultPrice']` whenever it was missing — so a rig, a
   * wiring slip and `price_lists` switched off all produced the same thing: a
   * cart line priced from a catalogue attribute that no price list supports.
   * Absence is now a `lazyPort` gate that throws `MODULE_DISABLED` at the call,
   * which nothing downstream can mistake for a price.
   *
   * A basket belongs to the channel it is used on
   * (`specs/154-sales-channel-access/`, User Story 6): it is created on that
   * channel and every line is priced for it, so a list with a `salesChannel`
   * criterion applies on the store it targets. Every basket used to be created
   * on the system-default channel and priced there, whatever storefront it was
   * used on.
   */
  /**
   * `approvalService` and `auditService` are optional — when wired
   * (production composition), any buyer-driven mutation on an
   * `approved` cart re-arms approval to `pending` and a typed audit
   * row is landed (line_added / line_qty_changed / line_removed).
   * Foundation tests and legacy test rigs that don't wire either still
   * construct the service without them; both hooks no-op when absent.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * `price_lists`' line-resolution slice (feature 075, Phase C) — the batched
     * one since D-287 P0, so a basket's lines are priced in one call.
     */
    private readonly pricingService: LinePricesPort,
    /** `catalog`'s product read model — products, variants, packaging units. */
    private readonly catalogProducts: CatalogProductReadPort,
    /** `organizations`' read model — the buying org the price resolves against. */
    private readonly organizations: OrganizationDetailsPort,
    /**
     * The sanctioned bridge accessor (Constitution XII), for the assortment
     * gate `addItem` owes (issue #259). Required, like `catalogProducts`: an
     * optional one would make "this rig did not wire it" and "this channel
     * publishes the product" the same answer, which is the fail-open shape the
     * whole issue is about.
     */
    private readonly channelMembership: SalesChannelMembershipPort,
    /**
     * `price_lists`' display mode on its own (issue #236) — what `addItem`
     * refuses a product sold on request only by when no price list holds it.
     * Required for the reason `channelMembership` is.
     */
    private readonly displayModes: ProductDisplayModePort,
    private readonly approvalService?: CartApprovalService,
    private readonly auditService?: CartAuditService,
    private readonly recomputeCache?: CartRecomputeCache,
  ) {
    this.#linePricing = new CartLinePricing(
      this.pricingService,
      this.displayModes,
      this.organizations,
    );
  }

  /** What a line may cost at its current quantity — see `cart-line-pricing.ts`. */
  readonly #linePricing: CartLinePricing;

  /** Invalidate the per-cart price-recompute cache on every cart-side write. */
  async #invalidateRecomputeCache(cartId: string): Promise<void> {
    if (!this.recomputeCache) return;
    try {
      await this.recomputeCache.invalidate(cartId);
    } catch {
      // Cache invalidation is best-effort — never block a write.
    }
  }

  /**
   * A basket seeded from an accepted Quote Request stops being that request's
   * basket when its last line goes (`specs/143-crm-sales-opportunities/`,
   * FR-101). Adding to it, removing from it and changing a quantity do not
   * touch the mark, because they do not remove the agreement the remaining
   * lines carry either: a line moved off its agreed quantity is priced from
   * the list, and gets its agreed price back at the agreed quantity. Whether
   * the order may still name the request is `orders`' judgement at placement.
   * An emptied basket has no agreed line left, so whatever is put in it next is
   * priced from the list and is an ordinary order.
   */
  async #forgetSourceWhenEmptied(em: EntityManager, cart: Cart): Promise<void> {
    if (!cart.sourceQuoteRequestId) return;
    if ((await em.count(CartItem, { cartId: cart.id })) > 0) return;
    cart.sourceQuoteRequestId = null;
    await em.flush();
  }

  /**
   * The customer's active basket on `ctx.salesChannelId`, created on that
   * channel when there is none (FR-030). The unique index
   * `carts_one_active_per_customer_per_channel` is the "one active basket per
   * customer per channel" invariant this lookup is keyed by.
   */
  async getOrCreateForCustomer(ctx: CustomerContext): Promise<Cart> {
    const em = this.emFactory();
    return this.#getOrCreateForCustomerOn(em, ctx);
  }

  async #getOrCreateForCustomerOn(em: EntityManager, ctx: CustomerContext): Promise<Cart> {
    let cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      salesChannelId: ctx.salesChannelId,
      status: 'active',
    });
    if (!cart) {
      cart = em.create(Cart, {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
        status: 'active',
        salesChannelId: ctx.salesChannelId,
      });
      await em.persistAndFlush(cart);
    }
    return cart;
  }

  /**
   * The active anonymous basket `token` names on `salesChannelId`, created on
   * that channel when no basket holds the token — or `null` when the token
   * already belongs to a basket that is not an active basket of this channel
   * (typically one of **another** channel). `anonymous_cart_token` is unique
   * across every basket, so such a token can start no basket here: the caller
   * treats it as "no basket" on a read, and a write mints a new token first
   * (contracts/basket-attribution.md §1). The old basket is left for the
   * abandonment sweep.
   */
  async getOrCreateForAnon(
    em: EntityManager,
    token: string,
    salesChannelId: string,
  ): Promise<Cart | null> {
    const held = await em.findOne(Cart, { anonymousCartToken: token });
    if (held) {
      return held.status === 'active' && held.salesChannelId === salesChannelId ? held : null;
    }
    const cart = em.create(Cart, {
      anonymousCartToken: token,
      status: 'active',
      salesChannelId,
    });
    await em.persistAndFlush(cart);
    return cart;
  }

  /**
   * Whether `token` can address a basket on `salesChannelId` — `false` when a
   * basket that is not this channel's active one already holds it, which is
   * when a storefront write mints a new anonymous token before it adds
   * anything (contracts/basket-attribution.md §1).
   */
  async anonymousTokenUsableOn(token: string, salesChannelId: string): Promise<boolean> {
    const em = this.emFactory();
    const held = await em.findOne(
      Cart,
      { anonymousCartToken: token },
      { fields: ['id', 'status', 'salesChannelId'] },
    );
    return held === null || (held.status === 'active' && held.salesChannelId === salesChannelId);
  }

  /**
   * The basket `actor` addresses on its channel, as its caller got or created
   * it there. The route mints a new token for a token of another channel's
   * basket before it gets here; an in-process caller that did not is told so.
   *
   * Deliberately not the getter as well: `check:command-coverage` clears a
   * mutating method through the audited methods that call it **directly**
   * (one hop), so `addItem` and `addItems` call `getOrCreateForAnon` themselves.
   */
  #requireBasket(cart: Cart | null): Cart {
    if (!cart) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
    return cart;
  }

  /** The channel of the basket `actor` addresses. */
  #basketChannelOf(actor: CartActor): string {
    const channel = actor.customer?.salesChannelId ?? actor.anonymousSalesChannelId;
    if (!channel) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Invariant violated: a cart operation names no sales channel for its basket.',
      );
    }
    return channel;
  }

  async getItems(cartId: string): Promise<CartItem[]> {
    const em = this.emFactory();
    return em.find(CartItem, { cartId });
  }

  async addItem(
    actor: CartActor,
    input: CartLineInput,
    /** The request's language, which a minimum refusal names the product in (feature 155). */
    options: { language?: string } = {},
  ): Promise<{ cart: Cart; items: CartItem[] }> {
    const em = this.emFactory();
    assertCartActor(actor);
    const cart = this.#requireBasket(
      actor.customer
        ? await this.#getOrCreateForCustomerOn(em, actor.customer)
        : await this.getOrCreateForAnon(em, actor.anonymousToken!, this.#basketChannelOf(actor)),
    );

    const resolved = await this.#resolveLine(actor, input);
    const { product, packagingUnit, effectiveQuantity } = resolved;

    // Feature 155 (FR-006, FR-006a, FR-028) — the order minimums, judged on the
    // basket as this add would leave it. After the resolver, so a product this
    // shopper may not see answers its unknown-id 404 and never a name or a
    // minimum (FR-035); before the line cap and pricing, so a refusal writes
    // nothing and costs no `price_lists` call.
    await assertCartChangeMeetsMinimums(this.catalogProducts, {
      cart: { sourceQuoteRequestId: cart.sourceQuoteRequestId ?? null },
      items: (await em.find(CartItem, { cartId: cart.id })).map(toCartMinimumItem),
      change: {
        kind: 'add',
        productId: product.id,
        variantId: input.variantId ?? null,
        packagingUnitId: packagingUnit?.id ?? null,
        packagingUnitBaseQuantity: packagingUnit?.baseQuantity ?? null,
        quantity: effectiveQuantity,
      },
      productId: product.id,
      product,
      language: options.language,
    });

    await this.#writeLine(em, cart, actor, input, resolved);

    if (this.approvalService && actor.customer) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: actor.customer.customerAccountId,
      });
    }

    await this.#recordLineAdded(cart, actor, input);
    await this.#invalidateRecomputeCache(cart.id);

    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  /**
   * Feature 155 (research R8, `contracts/cart-and-checkout-api.md` §4) — add
   * several lines as one batch, the road every batch path into a cart takes.
   *
   * 1. **Resolve every line first**, through {@link #resolveLine} — exactly
   *    `addItem`'s preconditions. A line that fails keeps the refusal it met
   *    (the unknown-id `404` for a product this shopper may not see), never a
   *    name or a minimum, and takes no part in step 2 (threat F1, FR-035). With
   *    `'throw'` the first such failure is thrown here, before the cart is even
   *    created — nothing is written.
   * 2. **Judge the resolved lines with the cart, once** — two linear passes
   *    ({@link judgeCartBatch}) over one cart read and one packaging-unit read
   *    over the vetted, eligible ids (F12). Lines below a minimum are reported
   *    `below_minimum` and not added; lines already in the cart are never
   *    rejected. With `onBelowMinimum: 'throw'` any such line refuses the whole
   *    batch here instead — `422 PRODUCT_BELOW_MINIMUM_QUANTITY` /
   *    `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, every offending line in
   *    `details.lines` by its `index` — before anything is written (D1).
   * 3. **Add the accepted lines** through `addItem`'s own write (line cap,
   *    quote-only and pricing refusals unchanged). With `'throw'` a refusal here
   *    is thrown as `addItem` throws it, the earlier lines staying added; with
   *    `'report'` it is the line's `failed` outcome.
   *
   * `replaceExisting` (a customer only, with `onLineError: 'throw'`) makes the
   * batch the customer's whole basket — admin order creation, the API intake and
   * one-click: step 2 judges the batch alone, and the active cart is cleared
   * ({@link clearForCustomer}) only once steps 1 and 2 have passed, so a refused
   * request leaves the basket exactly as it was.
   *
   * `keepRepeatedLines` (with `replaceExisting` only) writes every line as a line
   * of its own — a repeated `(product, variant, unit)` is not merged into the
   * first — each priced at its own quantity, created in request order with
   * strictly increasing creation times so the basket reads back in that order.
   * The admin order creation needs it to place one product on lines of several
   * groups (feature 159, research N-31). Minimums are still judged on the
   * product's total across the batch (step 2).
   *
   * `ModuleDisabledError` is always thrown. More than {@link CART_MAX_LINES}
   * lines can never fit a cart and are refused before anything is resolved.
   */
  async addItems(
    actor: CartActor,
    lines: readonly CartBatchLineInput[],
    options: {
      onLineError: 'throw' | 'report';
      onBelowMinimum?: 'report' | 'throw';
      replaceExisting?: boolean;
      keepRepeatedLines?: boolean;
      language?: string;
    },
  ): Promise<{ cart: Cart; items: CartItem[]; outcomes: CartBatchLineOutcome[] }> {
    if (options.keepRepeatedLines && !options.replaceExisting) {
      throw new Error('[carts] addItems: keepRepeatedLines needs replaceExisting — it describes a fresh basket.');
    }
    if (options.replaceExisting && !actor.customer) {
      throw new Error('[carts] addItems: replaceExisting needs a customer — only a customer has a basket to replace.');
    }
    if (options.replaceExisting && options.onLineError !== 'throw') {
      // With 'report' a line the write step refuses is an outcome, met only
      // after the basket has been cleared — the request would replace the
      // basket with part of itself.
      throw new Error("[carts] addItems: replaceExisting needs onLineError 'throw' — a reported failure would leave a partly replaced basket.");
    }
    if (lines.length > CART_MAX_LINES) {
      throw new HttpError(422, ERROR_CODES.CART_LINE_CAP_EXCEEDED, 'cart_line_cap_exceeded', {
        maximum: CART_MAX_LINES,
      });
    }
    assertCartActor(actor);
    const outcomes = new Map<number, CartBatchLineOutcome>();

    // Step 1 — resolution, before any write.
    const resolvedLines: Array<{ index: number; input: CartBatchLineInput; resolved: ResolvedCartLine }> = [];
    for (const [index, input] of lines.entries()) {
      try {
        resolvedLines.push({ index, input, resolved: await this.#resolveLine(actor, input) });
      } catch (err) {
        // A presence answer is about the whole batch, never one line (issue #124).
        rethrowIfModuleDisabled(err);
        if (options.onLineError === 'throw' || !(err instanceof HttpError)) throw err;
        outcomes.set(index, failedOutcome(index, err));
      }
    }

    const em = this.emFactory();
    let cart: Cart;
    let rejections: Map<number, CartBatchRejection>;
    if (options.replaceExisting) {
      // Step 2 — the request alone: the basket it replaces counts toward nothing.
      rejections = await this.#judgeBatch({ sourceQuoteRequestId: null }, [], resolvedLines);
      this.#throwIfBelowMinimum(rejections, resolvedLines, options);
      // Round B (item 3) — the write step's own refusals (no price, quote-only)
      // are judged here too, before the basket is cleared, so a request refused
      // for them also leaves the basket as it was.
      if (options.onLineError === 'throw') {
        await this.#assertBatchOrderable(em, actor, resolvedLines, rejections, options.keepRepeatedLines === true);
      }
      // Only now, with nothing left to refuse the request for, is the customer's
      // basket replaced.
      await this.clearForCustomer(actor.customer!);
      cart = await this.#getOrCreateForCustomerOn(em, actor.customer!);
    } else {
      cart = this.#requireBasket(
        actor.customer
          ? await this.#getOrCreateForCustomerOn(em, actor.customer)
          : await this.getOrCreateForAnon(em, actor.anonymousToken!, this.#basketChannelOf(actor)),
      );
      // Step 2 — the minimums with the cart, over the vetted records only.
      rejections = await this.#judgeBatch(
        cart,
        (await em.find(CartItem, { cartId: cart.id })).map(toCartMinimumItem),
        resolvedLines,
      );
      this.#throwIfBelowMinimum(rejections, resolvedLines, options);
    }

    // Step 3 — the accepted lines, in input order. Kept apart, each line is
    // created a millisecond after the one before it: the basket is read back by
    // creation time, and lines written within one millisecond would otherwise
    // fall back to their random ids.
    const kept = options.keepRepeatedLines === true;
    const seedBase = Date.now();
    let added = 0;
    let failure: unknown = null;
    for (const { index, input, resolved } of resolvedLines) {
      const rejection = rejections.get(index);
      if (rejection) {
        outcomes.set(index, belowMinimumOutcome(index, rejection, resolved.product, options.language));
        continue;
      }
      try {
        await this.#writeLine(
          em,
          cart,
          actor,
          input,
          resolved,
          kept ? { createdAt: new Date(seedBase + index) } : undefined,
        );
      } catch (err) {
        rethrowIfModuleDisabled(err);
        if (options.onLineError === 'throw' || !(err instanceof HttpError)) {
          failure = err;
          break;
        }
        outcomes.set(index, failedOutcome(index, err));
        continue;
      }
      added += 1;
      await this.#recordLineAdded(cart, actor, input);
      outcomes.set(index, { index, status: 'added' });
    }

    // The lines already written stay written, so the basket's bookkeeping
    // follows them even when a later line is about to be thrown.
    if (added > 0) {
      if (this.approvalService && actor.customer) {
        await this.approvalService.maybeReArm(cart, {
          customerAccountId: actor.customer.customerAccountId,
        });
      }
      await this.#invalidateRecomputeCache(cart.id);
    }
    if (failure !== null) throw failure;

    const items = await em.find(CartItem, { cartId: cart.id });
    return {
      cart,
      items,
      outcomes: Array.from(outcomes.values()).sort((a, b) => a.index - b.index),
    };
  }

  /**
   * The write step's pricing refusals, asked before a `replaceExisting` batch
   * clears the basket (`'throw'` mode): every line to be written is priced at
   * the quantity its write will price it at — the running total of its
   * `(product, variant, unit)` key, as `#writeLine` merges a repeated line into
   * the first. The basket being written is a fresh one, so there is no agreed
   * line to price at and no line cap to meet (a batch holds at most
   * `CART_MAX_LINES` lines). Refuses with exactly the refusal the write would
   * raise. A price edited between this and the write can still refuse a line
   * after the clear; placement prices the basket again either way. With
   * `keepRepeated` no line merges, so each is priced at its own quantity.
   */
  async #assertBatchOrderable(
    em: EntityManager,
    actor: CartActor,
    resolvedLines: ReadonlyArray<{ index: number; input: CartBatchLineInput; resolved: ResolvedCartLine }>,
    rejections: ReadonlyMap<number, CartBatchRejection>,
    keepRepeated: boolean,
  ): Promise<void> {
    const pricingCtx = await this.#linePricing.contextFor(em, {
      organizationId: actor.customer?.organizationId ?? null,
      signedIn: actor.customer !== undefined,
      salesChannelId: this.#basketChannelOf(actor),
      customerAccountId: actor.customer?.customerAccountId ?? null,
    });
    const quantities = new Map<string, number>();
    const lines: Array<Parameters<CartLinePricing['orderablePrices']>[1][number]> = [];
    for (const { index, input, resolved } of resolvedLines) {
      if (rejections.has(index)) continue;
      const key = `${resolved.product.id}|${input.variantId ?? ''}|${input.packagingUnitId ?? ''}`;
      const quantity = (keepRepeated ? 0 : (quantities.get(key) ?? 0)) + resolved.effectiveQuantity;
      quantities.set(key, quantity);
      lines.push({
        key: String(lines.length),
        product: resolved.product,
        variantId: input.variantId ?? null,
        quantity,
      });
    }
    // D-287 P0 — the batch is priced in one call; the first line that cannot
    // be ordered refuses, in line order, exactly as the per-line loop did.
    const answers = await this.#linePricing.orderablePrices(pricingCtx, lines);
    for (const line of lines) this.#refuseUnorderable(answers.get(line.key)!, line);
  }

  /**
   * R8 step 2 — one cart read and one packaging-unit read, over the products the
   * resolver has already vetted and only the eligible ones among them (F12).
   */
  async #judgeBatch(
    cart: Pick<Cart, 'sourceQuoteRequestId'>,
    basket: readonly CartMinimumItem[],
    resolvedLines: ReadonlyArray<{ index: number; input: CartBatchLineInput; resolved: ResolvedCartLine }>,
  ): Promise<Map<number, CartBatchRejection>> {
    if (resolvedLines.length === 0) return new Map();
    const products = new Map(resolvedLines.map(({ resolved }) => [resolved.product.id, resolved.product]));
    const eligibleIds = [...products.values()]
      .filter((product) => isOrderMinimumEligibleType(product.type))
      .map((product) => product.id);
    const packagingUnits =
      eligibleIds.length > 0 ? await this.catalogProducts.listPackagingUnitsByProductIds(eligibleIds) : [];
    return judgeCartBatch(
      { sourceQuoteRequestId: cart.sourceQuoteRequestId ?? null },
      basket,
      resolvedLines.map(({ index, resolved }) => ({
        index,
        productId: resolved.product.id,
        quantity: resolved.effectiveQuantity,
        packagingUnitId: resolved.packagingUnit?.id ?? null,
        packagingUnitBaseQuantity: resolved.packagingUnit?.baseQuantity ?? null,
      })),
      { products: [...products.values()], packagingUnits },
    );
  }

  /**
   * `onBelowMinimum: 'throw'` (D1) — the whole batch refused for its rejected
   * lines, before anything is written: the first line's minimum code, every
   * rejected line in `details.lines` by its batch `index`, each product named in
   * `options.language`. The figures (`total`, `units`) are the judgement's own.
   */
  #throwIfBelowMinimum(
    rejections: ReadonlyMap<number, CartBatchRejection>,
    resolvedLines: ReadonlyArray<{ index: number; resolved: ResolvedCartLine }>,
    options: { onBelowMinimum?: 'report' | 'throw'; language?: string },
  ): void {
    if (options.onBelowMinimum !== 'throw' || rejections.size === 0) return;
    const violations = [...rejections.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, rejection]) => ({ ...rejection, key: String(index) }));
    const names = new Map(
      resolvedLines.map(({ resolved }) => [resolved.product.id, pickLocalized(resolved.product.name, options.language)]),
    );
    const refusal = minimumRefusal(violations, names, 'index');
    if (refusal === null) return;
    throw new HttpError(422, ERROR_CODES[refusal.code], refusal.message, refusal.details);
  }

  /**
   * The write of one resolved line, the minimum already decided: bump the line
   * matching `(product, variant, unit)` or create one behind the line cap and the
   * quote-only refusal, priced through `price_lists`. `separate` (a
   * `keepRepeatedLines` batch) always creates a line, at the creation time given.
   */
  async #writeLine(
    em: EntityManager,
    cart: Cart,
    actor: CartActor,
    input: CartLineInput,
    resolved: ResolvedCartLine,
    separate?: { createdAt: Date },
  ): Promise<void> {
    // command-coverage-ignore: the ephemeral cart's own line write; its typed
    // `line_added` audit row is recorded by the public caller (`addItem`,
    // `addItems`) through `#recordLineAdded` once the write has succeeded.
    const { product, packagingUnit, effectiveQuantity } = resolved;
    // If the same product+variant+packaging-unit is already in the cart, bump
    // quantity. A packaging-unit line and a single-piece line of the same
    // product stay distinct (different `packagingUnitId`).
    const existing = separate
      ? null
      : await em.findOne(CartItem, {
          cartId: cart.id,
          productId: product.id,
          variantId: input.variantId ?? null,
          packagingUnitId: input.packagingUnitId ?? null,
        });
    const pricingCtx = await this.#linePricing.contextFor(em, {
      organizationId: actor.customer?.organizationId ?? null,
      signedIn: actor.customer !== undefined,
      salesChannelId: this.#basketChannelOf(actor),
      customerAccountId: actor.customer?.customerAccountId ?? null,
    });
    if (existing) {
      // The merged line is a line of a new quantity, so it takes the price for
      // that quantity — a quantity-tier bracket the old quantity reached does
      // not carry over, and an agreed price holds only at the agreed quantity.
      const quantity = existing.quantity + effectiveQuantity;
      const price = await this.#orderablePriceOrRefuse(pricingCtx, {
        product,
        variantId: existing.variantId ?? null,
        quantity,
        agreed: agreementOf(existing),
      });
      existing.quantity = quantity;
      existing.unitPrice = price.unitPrice;
      existing.currency = price.currency;
      existing.priceSource = price.priceSource;
      cart.lastActivityAt = new Date();
      await em.flush();
      return;
    }
    // Feature 027 FR-001: enforce the 200-line cap on the 201st distinct
    // (productId, variantId) pair. Foundation duplicate-summation above
    // does not trigger the cap.
    const currentLineCount = await em.count(CartItem, { cartId: cart.id });
    if (currentLineCount >= CART_MAX_LINES) {
      throw new HttpError(
        422,
        ERROR_CODES.CART_LINE_CAP_EXCEEDED,
        'cart_line_cap_exceeded',
      );
    }
    // T084 / issue #236 — a product sold on request only is refused, and since
    // the price is what the order is placed at, so is a product nobody priced
    // (it used to become a line at `0.00`).
    const price = await this.#orderablePriceOrRefuse(pricingCtx, {
      product,
      variantId: input.variantId ?? null,
      quantity: effectiveQuantity,
    });
    const item = em.create(CartItem, {
      cartId: cart.id,
      productId: product.id,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      ...(packagingUnit
        ? {
            packagingUnitId: packagingUnit.id,
            packagingUnitName: packagingUnit.name,
            packagingUnitBaseQuantity: packagingUnit.baseQuantity,
          }
        : {}),
      quantity: effectiveQuantity,
      unitPrice: price.unitPrice,
      currency: price.currency,
      // Feature 160 (FR-030) — the tier that priced the line, written with it.
      priceSource: price.priceSource,
      ...(separate ? { createdAt: separate.createdAt } : {}),
    });
    em.persist(item);
    cart.lastActivityAt = new Date();
    await em.flush();
  }

  /** The typed `line_added` audit row of one added line, when auditing is wired. */
  async #recordLineAdded(
    cart: Cart,
    actor: CartActor,
    input: CartLineInput,
  ): Promise<void> {
    if (!this.auditService) return;
    await this.auditService.record({
      cartId: cart.id,
      actorType: actor.customer ? 'customer' : 'system',
      ...(actor.customer ? { actorId: actor.customer.customerAccountId } : {}),
      action: 'line_added',
      metadata: {
        productId: input.productId,
        ...(input.variantId ? { variantId: input.variantId } : {}),
        quantity: input.quantity,
      },
    });
  }

  /**
   * `addItem`'s preconditions, in its order (feature 155, research R8, threat F1):
   * the quantity floor, the product's existence and visibility to this shopper,
   * the channel's assortment, and the packaging unit belonging to the product.
   * One private resolver so every add path — the single add and the batch — asks
   * exactly the same questions and gives exactly the same unknown-id answers.
   * Writes nothing.
   */
  async #resolveLine(
    actor: CartActor,
    input: CartLineInput,
  ): Promise<ResolvedCartLine> {
    // Issue #86 — a refusal of its own, not `VALIDATION_FAILED`: the envelope
    // never replaces that code's message, so the sentence below was answered in
    // English whatever the reader asked for. `details.minimum` is what both
    // bundle sentences name. Every request schema in front of this method
    // already requires a positive integer, so this is what an in-process caller
    // of the cart write port meets.
    if (input.quantity < CART_LINE_MIN_QUANTITY) {
      throw new HttpError(
        422,
        ERROR_CODES.CART_QUANTITY_INVALID,
        `Quantity must be at least ${CART_LINE_MIN_QUANTITY}.`,
        { quantity: input.quantity, minimum: CART_LINE_MIN_QUANTITY },
      );
    }
    const product = await this.catalogProducts.findById(input.productId);
    // Issue #227 — a product this shopper may not see is a product they may not
    // put in a cart. The read port is the row-level one and applies no policy of
    // its own, deliberately: an order line has to resolve its product long after
    // the operator restricted it. That makes enforcement the caller's, and this
    // caller is holding a `productId` the buyer chose.
    //
    // 404 and not 403, matching the product detail: a caller who may not see the
    // row may not learn it exists, and the two answers are indistinguishable to
    // an honest client because they are the same answer.
    if (!product || !isProductVisibleTo(product, cartAudience(actor))) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    // Issue #259 — the second filter the predicate above says it is not. The
    // channel is a property of the request, so it is read off the request scope
    // and never re-resolved here; outside a request there is no channel to be
    // out of and `outOfRequestChannel` answers `false`.
    //
    // The same 404 as the two lines above, deliberately: "sold on another
    // channel", "restricted to another organisation" and "does not exist" have
    // to be one answer, or the pair of them is an enumeration oracle over an
    // operator's private assortment — the defect issue #174 found in the
    // type-ahead next door.
    //
    // The one exception is a caller that names the channel itself: an
    // administrator creating an order on a customer's behalf chooses the
    // order's channel in the request body, and the request scope of an admin
    // call resolves to the system default, which is not that channel. Buyer
    // routes never pass `salesChannelId`.
    const outOfChannel = input.salesChannelId
      ? !(
          await this.channelMembership.filterEntityIdsInChannel(input.salesChannelId, 'product', [
            product.id,
          ])
        ).includes(product.id)
      : await outOfRequestChannel(this.channelMembership, product.id);
    if (outOfChannel) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    // Feature 043 — ordering by a packaging unit (e.g. a pallet): the line is
    // measured in base pieces (`baseQuantity × units`) and snapshots the unit
    // name so the cart/order/RFQ can append it to the product name.
    //
    // `findPackagingUnitInProduct` is the two-argument form of the same read:
    // the "does this unit belong to this product?" test was the second half of
    // the `where` clause and stays inside one query.
    let packagingUnit: CatalogPackagingUnitRecord | null = null;
    if (input.packagingUnitId) {
      packagingUnit = await this.catalogProducts.findPackagingUnitInProduct(
        product.id,
        input.packagingUnitId,
      );
      if (!packagingUnit) {
        throw new HttpError(
          404,
          ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
          'Packaging unit not found for this product.',
        );
      }
    }
    const effectiveQuantity = packagingUnit
      ? packagingUnit.baseQuantity * input.quantity
      : input.quantity;
    return { product, packagingUnit, effectiveQuantity };
  }

  /**
   * The price a line may be stored at, or the refusal the buyer reads.
   *
   * There is no `catch` around the resolution (issue #84): `null` is the
   * price-list engine's own "nothing applies", which the chain in
   * `cart-line-pricing.ts` answers with the Product's own price, and an absent
   * `price_lists` throws `MODULE_DISABLED` through this method to the route
   * (issue #124).
   */
  async #orderablePriceOrRefuse(
    ctx: CartPricingContext,
    line: Parameters<CartLinePricing['orderablePrice']>[1],
  ): Promise<Extract<CartLinePriceAnswer, { ok: true }>> {
    return this.#refuseUnorderable(await this.#linePricing.orderablePrice(ctx, line), line);
  }

  /** The refusal half of {@link #orderablePriceOrRefuse}, for an answer already in hand. */
  #refuseUnorderable(
    answer: CartLinePriceAnswer,
    line: { product: { id: string } },
  ): Extract<CartLinePriceAnswer, { ok: true }> {
    if (answer.ok) return answer;
    if (answer.reason === 'quote_only') {
      // Issue #86 — its own code: raised as `VALIDATION_FAILED` it could not
      // be told from a malformed request, and the buyer read the identifier
      // `product_quote_only` in every language.
      throw new HttpError(
        400,
        ERROR_CODES.CART_PRODUCT_QUOTE_ONLY,
        'This product is sold on request only and cannot be added to the cart.',
        { productId: line.product.id },
      );
    }
    throw new HttpError(
      422,
      ERROR_CODES.CART_PRODUCT_UNPRICED,
      'This product has no price and cannot be added to the cart.',
      { productId: line.product.id },
    );
  }

  async updateItem(
    actor: CartActor,
    itemId: string,
    quantity: number,
    /** The request's language, which a minimum refusal names the product in (feature 155). */
    options: { language?: string } = {},
  ): Promise<{ cart: Cart; items: CartItem[] }> {
    const em = this.emFactory();
    const item = await em.findOne(CartItem, { id: itemId });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart item not found.');
    const cart = await em.findOne(Cart, { id: item.cartId });
    if (!cart) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
    this.#assertOwnership(cart, actor);

    // Feature 155 — an edit to 0 removes the line and is never refused (FR-007).
    // Any other quantity is judged like an add, on the line's new quantity; a
    // line whose product record is gone answers 404 (FR-037). Refused → the line
    // is left as it was.
    if (quantity > 0) {
      await assertCartChangeMeetsMinimums(this.catalogProducts, {
        cart: { sourceQuoteRequestId: cart.sourceQuoteRequestId ?? null },
        items: (await em.find(CartItem, { cartId: cart.id })).map(toCartMinimumItem),
        change: { kind: 'edit', itemId: item.id, quantity },
        productId: item.productId,
        product: await this.catalogProducts.findById(item.productId),
        language: options.language,
      });
    }

    const oldQuantity = item.quantity;
    if (quantity <= 0) {
      em.remove(item);
    } else if (quantity !== oldQuantity) {
      // A new quantity takes the price for that quantity: a quantity-tier
      // bracket the old quantity reached does not carry over, and an agreed
      // price holds only at the agreed quantity.
      const product = await this.catalogProducts.findById(item.productId);
      if (!product) {
        throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
      }
      const pricingCtx = await this.#linePricing.contextFor(em, {
        organizationId: actor.customer?.organizationId ?? cart.organizationId ?? null,
        signedIn: actor.customer !== undefined,
        salesChannelId: this.#basketChannelOf(actor),
        customerAccountId: actor.customer?.customerAccountId ?? cart.customerAccountId ?? null,
      });
      const price = await this.#orderablePriceOrRefuse(pricingCtx, {
        product,
        variantId: item.variantId ?? null,
        quantity,
        agreed: agreementOf(item),
      });
      item.quantity = quantity;
      item.unitPrice = price.unitPrice;
      item.currency = price.currency;
      item.priceSource = price.priceSource;
    }
    cart.lastActivityAt = new Date();
    await em.flush();
    if (quantity <= 0) await this.#forgetSourceWhenEmptied(em, cart);
    if (this.approvalService && actor.customer) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: actor.customer.customerAccountId,
      });
    }
    if (this.auditService) {
      await this.auditService.record({
        cartId: cart.id,
        actorType: actor.customer ? 'customer' : 'system',
        ...(actor.customer ? { actorId: actor.customer.customerAccountId } : {}),
        action: quantity <= 0 ? 'line_removed' : 'line_qty_changed',
        metadata: {
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          oldQuantity,
          newQuantity: quantity,
        },
      });
    }
    await this.#invalidateRecomputeCache(cart.id);
    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  async removeItem(
    actor: CartActor,
    itemId: string,
  ): Promise<{ cart: Cart; items: CartItem[] }> {
    const em = this.emFactory();
    const item = await em.findOne(CartItem, { id: itemId });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart item not found.');
    const cart = await em.findOne(Cart, { id: item.cartId });
    if (!cart) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
    this.#assertOwnership(cart, actor);
    const removedProductId = item.productId;
    const removedVariantId = item.variantId ?? null;
    const removedQuantity = item.quantity;
    em.remove(item);
    cart.lastActivityAt = new Date();
    await em.flush();
    await this.#forgetSourceWhenEmptied(em, cart);
    if (this.approvalService && actor.customer) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: actor.customer.customerAccountId,
      });
    }
    if (this.auditService) {
      await this.auditService.record({
        cartId: cart.id,
        actorType: actor.customer ? 'customer' : 'system',
        ...(actor.customer ? { actorId: actor.customer.customerAccountId } : {}),
        action: 'line_removed',
        metadata: {
          productId: removedProductId,
          ...(removedVariantId ? { variantId: removedVariantId } : {}),
          quantity: removedQuantity,
        },
      });
    }
    await this.#invalidateRecomputeCache(cart.id);
    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  /**
   * Explicit "this buyer just opened the cart page" ping (feature 027 §R4 /
   * FR-032). Bumps `last_activity_at` and, if the cart had transitioned to
   * `abandoned`, brings it back to `active` and clears
   * `abandonment_notified_at` so the next abandonment cycle can notify
   * again. No-op on a missing cart.
   */
  async touch(actor: CartActor): Promise<Cart | null> {
    // command-coverage-ignore: bumps the ephemeral cart's lastActivityAt for the
    // abandonment sweep — transient bookkeeping, not an audited domain mutation.
    const em = this.emFactory();
    let cart: Cart | null = null;
    if (actor.customer) {
      cart = await em.findOne(Cart, {
        customerAccountId: actor.customer.customerAccountId,
        salesChannelId: actor.customer.salesChannelId,
        status: { $in: ['active', 'abandoned'] },
      });
    } else if (actor.anonymousToken) {
      cart = await em.findOne(Cart, {
        anonymousCartToken: actor.anonymousToken,
        salesChannelId: this.#basketChannelOf(actor),
        status: { $in: ['active', 'abandoned'] },
      });
    }
    if (!cart) return null;
    cart.lastActivityAt = new Date();
    if (cart.status === 'abandoned') {
      cart.status = 'active';
      cart.abandonmentNotifiedAt = null;
    }
    await em.flush();
    return cart;
  }

  /**
   * Merge an anonymous cart's items into the customer's cart at login
   * time (feature 037-cart-merge-on-login).
   *
   * Returns a `CartMergeOutcome` diagnostic the caller (the login route
   * via the `onLogin` hook) uses to surface the result to the storefront
   * and to decide whether to clear the stale `b2b_cart_anon` cookie.
   * See specs/037-cart-merge-on-login/contracts/cart-merge.md § 3.
   *
   * State matrix:
   *   - `adopted`        — the customer had no active cart; the anon
   *     cart's lines were placed onto a freshly-created destination.
   *   - `merged`         — the customer already had an active cart and
   *     ≥ 1 anon line was moved or summed into it.
   *   - `noop_empty`     — the anon cart was found but carried no items;
   *     the source row is still flipped to `completed` + detokenised
   *     (cleanup), no audit row is written.
   *   - `noop_no_anon`   — no cart for the supplied token; no DB change.
   *
   * Coupons on the source cart are NOT carried to the destination
   * (R-05 / FR-010 — the destination's existing `appliedPromotionCode`
   * is preserved verbatim).
   *
   * Both baskets are those of `ctx.salesChannelId`, the sign-in request's
   * channel (`specs/154-sales-channel-access/`, contracts/basket-attribution.md
   * §3): an anonymous basket of another channel is left alone and the outcome
   * is `noop_no_anon`.
   */
  async mergeAnonymousIntoCustomer(
    anonymousToken: string,
    ctx: CustomerContext,
  ): Promise<CartMergeOutcome> {
    const em = this.emFactory();
    // Look up the source first so the noop_no_anon branch can skip the
    // destination-cart creation. Per the spec, the diagnostic still
    // includes a destinationCartId so the storefront has a stable id to
    // re-read its cart from on next render.
    const anon = await em.findOne(Cart, {
      anonymousCartToken: anonymousToken,
      salesChannelId: ctx.salesChannelId,
      status: 'active',
    });
    if (!anon) {
      const destForNoop = await this.#getOrCreateForCustomerOn(em, ctx);
      return {
        outcome: 'noop_no_anon',
        movedLineCount: 0,
        summedLineCount: 0,
        destinationCartId: destForNoop.id,
      };
    }

    // Detect "the customer's destination cart was newly created right now":
    // peek for an existing active cart row BEFORE calling the get-or-create
    // helper. If absent and the source has items, we will return `adopted`.
    const preExistingDest = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      salesChannelId: ctx.salesChannelId,
      status: 'active',
    });
    const customerCart = preExistingDest ?? (await this.#getOrCreateForCustomerOn(em, ctx));

    let movedLineCount = 0;
    let summedLineCount = 0;
    const repriced: CartItem[] = [];
    const anonItems = await em.find(CartItem, { cartId: anon.id });
    for (const item of anonItems) {
      const existing = await em.findOne(CartItem, {
        cartId: customerCart.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
      });
      if (existing) {
        existing.quantity += item.quantity;
        summedLineCount += 1;
        repriced.push(existing);
      } else {
        item.cartId = customerCart.id;
        movedLineCount += 1;
        repriced.push(item);
      }
    }
    // A summed line has a new quantity, and a moved line was priced for an
    // anonymous shopper: both take the price this customer may order them at.
    // A line that has none keeps what it holds — the login must not fail over
    // it — and order placement refuses it until the buyer reviews the cart.
    await this.repriceLinesForCustomer(em, ctx, repriced);

    // Merge complete — mark the source anonymous cart as `completed` even
    // when the merge was a noop_empty (it never produced anything down-
    // stream, but leaving it `active` would let the abandonment sweep
    // pick it up later, and leaving the token live would let a second
    // login try to re-merge an already-consumed source). Treating it as
    // `abandoned` would falsely flag it for the abandonment-notification
    // sweep. See feature 027 §R10.
    anon.status = 'completed';
    anon.anonymousCartToken = null;

    const isNoopEmpty = movedLineCount + summedLineCount === 0;
    const outcome: CartMergeOutcome['outcome'] = isNoopEmpty
      ? 'noop_empty'
      : preExistingDest
        ? 'merged'
        : 'adopted';

    // Audit only on observable state-changes on the destination cart
    // (R-08). noop_empty and noop_no_anon are not destination-state
    // changes and are observable in the application log instead.
    if ((outcome === 'adopted' || outcome === 'merged') && this.auditService) {
      const sourceAnonTokenHash = createHash('sha256').update(anonymousToken).digest('hex');
      await this.auditService.record({
        cartId: customerCart.id,
        actorType: 'system',
        action: 'cart_merged_from_anon',
        metadata: {
          sourceAnonTokenHash,
          outcome,
          movedLineCount,
          summedLineCount,
        },
      });
    }

    await em.flush();

    return {
      outcome,
      movedLineCount,
      summedLineCount,
      destinationCartId: customerCart.id,
    };
  }

  /**
   * Store on each line the price this customer may order it at now, without
   * flushing — the caller's `em` manages the lines and writes them. A line with
   * no orderable price (unpriced, sold on request only, its product gone, or a
   * product this read cannot see) keeps what it holds; order placement refuses
   * it until the buyer reviews the cart. Used where refusing is not an option:
   * the login merge, and seeding a basket from a past order.
   *
   * Answers the lines the chain refused, by item id, with the reason (issue
   * #166): a reorder leaves them out of the basket and reports them. A line
   * whose product this read cannot see is not in the answer.
   */
  async repriceLinesForCustomer(
    em: EntityManager,
    customer: CustomerContext,
    items: CartItem[],
  ): Promise<Map<string, 'unpriced' | 'quote_only'>> {
    const refused = new Map<string, 'unpriced' | 'quote_only'>();
    if (items.length === 0) return refused;
    const pricingCtx = await this.#linePricing.contextFor(em, {
      organizationId: customer.organizationId,
      signedIn: true,
      salesChannelId: customer.salesChannelId,
      customerAccountId: customer.customerAccountId,
    });
    const products = await this.catalogProducts.findByIds([
      ...new Set(items.map((it) => it.productId)),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    // D-287 P0 — every line in one batched resolution.
    const answers = await this.#linePricing.orderablePrices(
      pricingCtx,
      items.flatMap((item) => {
        const product = productById.get(item.productId);
        return product
          ? [
              {
                key: item.id,
                product,
                variantId: item.variantId ?? null,
                quantity: item.quantity,
                agreed: agreementOf(item),
              },
            ]
          : [];
      }),
    );
    for (const item of items) {
      const answer = answers.get(item.id);
      if (!answer) continue;
      if (!answer.ok) {
        refused.set(item.id, answer.reason);
        continue;
      }
      item.unitPrice = answer.unitPrice;
      item.currency = answer.currency;
      item.priceSource = answer.priceSource;
    }
    return refused;
  }

  async clearForCustomer(ctx: CustomerContext): Promise<void> {
    // command-coverage-ignore: empties the ephemeral cart — transient pre-order
    // working state; the resulting order captures the audited final state.
    const em = this.emFactory();
    const cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      salesChannelId: ctx.salesChannelId,
      status: 'active',
    });
    if (!cart) return;
    await em.nativeDelete(CartItem, { cartId: cart.id });
    cart.status = 'completed';
    await em.flush();
  }

  /**
   * The line's basket is the caller's **and** the one of the channel the caller
   * is on: a customer's basket of another store is not this store's basket, so
   * a line of it is answered like any line the caller does not hold.
   */
  #assertOwnership(cart: Cart, actor: CartActor): void {
    const owned =
      (actor.customer !== undefined &&
        cart.customerAccountId === actor.customer.customerAccountId) ||
      (actor.anonymousToken !== undefined && cart.anonymousCartToken === actor.anonymousToken);
    if (owned && cart.salesChannelId === this.#basketChannelOf(actor)) return;
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
  }
}

/**
 * The {@link ProductAudience} a cart operation speaks for (issue #227).
 *
 * An anonymous cart is the anonymous audience — the token in the cookie
 * identifies a basket, not a buyer, and it is minted by asking for one. A
 * signed-in shopper carries their Organization, `null` included: the guest-style
 * accounts of feature 026 have none, and they are exactly the caller
 * `logged_in_only` distinguishes from the public.
 */
function cartAudience(actor: CartActor): ProductAudience {
  if (!actor.customer) return ANONYMOUS_PRODUCT_AUDIENCE;
  return { organizationId: actor.customer.organizationId, authenticated: true };
}

/** `401` for a cart operation with neither a customer session nor an anonymous token. */
function assertCartActor(actor: CartActor): void {
  if (actor.customer || actor.anonymousToken) return;
  throw new HttpError(
    401,
    ERROR_CODES.UNAUTHORIZED,
    'Cart requires either a customer session or an anonymous cart token.',
  );
}

/**
 * A batch line's refusal as its outcome: the status, code, message and details it
 * met, nothing else (F1) — the unknown-id answer carries no details, so a line
 * the buyer may not see still discloses nothing.
 */
function failedOutcome(index: number, err: HttpError): CartBatchLineOutcome {
  return {
    index,
    status: 'failed',
    error: {
      status: err.statusCode,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}

function belowMinimumOutcome(
  index: number,
  rejection: CartBatchRejection,
  product: CatalogProductRecord,
  language: string | undefined,
): CartBatchLineOutcome {
  return {
    index,
    status: 'below_minimum',
    productId: rejection.productId,
    productName: pickLocalized(product.name, language),
    kind: rejection.kind,
    minimum: rejection.minimum,
    ...(rejection.kind === 'packaging_unit' ? { packagingUnitName: rejection.packagingUnitName } : {}),
  };
}
