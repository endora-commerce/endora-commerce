import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  ERROR_CODES,
  effectivePackagingUnitName,
  isOrderMinimumEligibleType,
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
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CatalogProductRecord,
  LinePricesPort,
  ProductDisplayModePort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import { basketScopeLanguage, withBasketOrderRules } from './cart-availability.js';
import type { CartApprovalService } from './cart-approval-service.js';
import type { CartAuditService } from './cart-audit-service.js';
import type { CartRecomputeCache } from './cart-recompute-cache.js';
import { discardWorkingBasketOn } from './working-basket.js';
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
  /**
   * Feature 163 — the request's first `Accept-Language` tag. The basket's
   * scope language L is this tag resolved against the channel's languages
   * (`basketScopeLanguage`). A preference, never an authority: it chooses a
   * language the channel offers and nothing else.
   */
  languageTag?: string;
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
  /**
   * Feature 163 (FR-079, T138) — the unit's name the line snapshots: its name in the
   * basket's scope language (an operator-named channel's default language, N2), else
   * its global name. `null` without a unit.
   */
  packagingUnitName: string | null;
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
     * `price_lists`' display mode on its own (issue #236) — what `addItem`
     * refuses a product sold on request only by when no price list holds it.
     * Required for the reason `availability` is.
     */
    private readonly displayModes: ProductDisplayModePort,
    /**
     * Feature 163 — `catalog`'s one answer to "may this shopper acquire this
     * product here, now" (FR-004): membership, effective status at (channel,
     * L), window and effective audience in one call — membership through the
     * sanctioned bridge accessor (Constitution XII) inside it. Required: an
     * optional one would make "this rig did not wire it" and "this channel
     * offers the product" the same answer, which is the fail-open shape issue
     * #259 is about.
     */
    private readonly availability: CatalogProductAvailabilityPort,
    private readonly approvalService?: CartApprovalService,
    private readonly auditService?: CartAuditService,
    private readonly recomputeCache?: CartRecomputeCache,
    /**
     * Feature 163, owner decision N2 = B — the kernel's channel accessor, read for one
     * fact: the default language of a channel an operator names, where a packaging
     * unit's name is snapshotted. Absent (some rigs) = the global name.
     */
    private readonly channelReads?: Pick<SalesChannelResolutionPort, 'getById'>,
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
   * The approval re-arm of a buyer's content change (issues #619, #649),
   * staged on `em` beside the change so the caller's next flush writes both —
   * see {@link CartApprovalService.reArmWithin}. A guest's basket has no
   * approval to re-arm.
   */
  #reArmWithin(em: EntityManager, cart: Cart, actor: CartActor): void {
    if (!this.approvalService || !actor.customer) return;
    this.approvalService.reArmWithin(em, cart, {
      customerAccountId: actor.customer.customerAccountId,
    });
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
   * A fresh working basket of the customer's on `ctx.salesChannelId` (issue
   * #169) — the cart an order is placed from when the order's lines are named
   * by the request rather than collected by the buyer. Status `working` keeps it
   * out of `carts_one_active_per_customer_per_channel` and out of every read of
   * "the customer's basket", so the active one stands beside it untouched.
   */
  async #createWorkingBasketOn(em: EntityManager, ctx: CustomerContext): Promise<Cart> {
    // command-coverage-ignore: the transient working state an order is placed
    // from; the placement that consumes it is the audited write.
    const cart = em.create(Cart, {
      customerAccountId: ctx.customerAccountId,
      organizationId: ctx.organizationId,
      status: 'working',
      salesChannelId: ctx.salesChannelId,
    });
    await em.persistAndFlush(cart);
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
  /** Feature 163 (FR-100) — one product record with the basket channel's order rules; `null` stays `null`. */
  async #withChannelRules(
    product: CatalogProductRecord | null,
    channelId: string | null | undefined,
  ): Promise<CatalogProductRecord | null> {
    if (product === null) return null;
    return (await withBasketOrderRules(this.availability, [product], channelId))[0]!;
  }

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
      // Feature 163 (FR-100) — judged on the basket channel's minimum.
      product: (await withBasketOrderRules(this.availability, [product], cart.salesChannelId))[0]!,
      language: options.language,
    });

    await this.#writeLine(em, cart, actor, input, resolved);

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
   * `workingBasket` (a customer only, with `onLineError: 'throw'`) writes the
   * batch into a **fresh working basket** — a cart of the customer's on the
   * actor's channel in status `working` — instead of the active one: admin order
   * creation, the API intake and one-click, which place an order from exactly
   * these lines (issue #169). Step 2 judges the batch alone; the working basket
   * is created only once steps 1 and 2 have passed, and removed again when the
   * write step refuses a line, so a refused request writes nothing. The
   * customer's active basket is never read, cleared or completed by it. The
   * caller hands the returned cart's id to placement, which completes it against
   * the order or removes it when placement refuses.
   *
   * `keepRepeatedLines` (with `workingBasket` only) writes every line as a line
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
      workingBasket?: boolean;
      keepRepeatedLines?: boolean;
      language?: string;
    },
  ): Promise<{ cart: Cart; items: CartItem[]; outcomes: CartBatchLineOutcome[] }> {
    if (options.keepRepeatedLines && !options.workingBasket) {
      throw new Error('[carts] addItems: keepRepeatedLines needs workingBasket — it describes a fresh basket.');
    }
    if (options.workingBasket && !actor.customer) {
      throw new Error('[carts] addItems: workingBasket needs a customer — only a customer places an order from one.');
    }
    if (options.workingBasket && options.onLineError !== 'throw') {
      // With 'report' a line the write step refuses is an outcome — the order
      // would be placed from part of the request.
      throw new Error("[carts] addItems: workingBasket needs onLineError 'throw' — a reported failure would leave a partly written working basket.");
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
    if (options.workingBasket) {
      // Step 2 — the request alone: the customer's active basket counts toward
      // nothing, and is not touched (issue #169).
      rejections = await this.#judgeBatch({ sourceQuoteRequestId: null }, [], resolvedLines, this.#basketChannelOf(actor));
      await this.#throwIfBelowMinimum(actor, rejections, resolvedLines, options);
      // Round B (item 3) — the write step's own refusals (no price, quote-only)
      // are judged here too, before the working basket is created, so a request
      // refused for them writes nothing.
      await this.#assertBatchOrderable(em, actor, resolvedLines, rejections, options.keepRepeatedLines === true);
      // Only now, with nothing left to refuse the request for, is the working
      // basket created.
      cart = await this.#createWorkingBasketOn(em, actor.customer!);
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
        cart.salesChannelId,
      );
      await this.#throwIfBelowMinimum(actor, rejections, resolvedLines, options);
    }

    // Step 3 — the accepted lines, in input order. Kept apart, each line is
    // created a millisecond after the one before it: the basket is read back by
    // creation time, and lines written within one millisecond would otherwise
    // fall back to their random ids.
    const kept = options.keepRepeatedLines === true;
    const seedBase = Date.now();
    // Feature 163 (FR-017 d) — a below-minimum outcome names the product as the
    // storefront shows it in this basket's (channel, language).
    const outcomeNames =
      rejections.size > 0 ? await this.#effectiveNamesFor(actor, resolvedLines) : new Map<string, string>();
    let added = 0;
    let failure: unknown = null;
    for (const { index, input, resolved } of resolvedLines) {
      const rejection = rejections.get(index);
      if (rejection) {
        outcomes.set(
          index,
          belowMinimumOutcome(
            index,
            rejection,
            outcomeNames.get(resolved.product.id) ?? pickLocalized(resolved.product.name, options.language),
          ),
        );
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
        // A working basket is removed whatever refused its line, a presence
        // answer included — which still travels, below.
        if (options.workingBasket) {
          failure = err;
          break;
        }
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

    // A working basket the write step refused a line of is the request's own
    // and nobody else's: it goes, lines and audit rows with it, so a refused
    // request leaves nothing behind (issue #169).
    if (failure !== null && options.workingBasket) {
      await discardWorkingBasketOn(em, { cartId: cart.id });
      throw failure;
    }
    // The lines already written stay written, so the basket's bookkeeping
    // follows them even when a later line is about to be thrown.
    if (added > 0) {
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
   * The write step's pricing refusals, asked before a `workingBasket` batch
   * creates its basket (`'throw'` mode): every line to be written is priced at
   * the quantity its write will price it at — the running total of its
   * `(product, variant, unit)` key, as `#writeLine` merges a repeated line into
   * the first. The basket being written is a fresh one, so there is no agreed
   * line to price at and no line cap to meet (a batch holds at most
   * `CART_MAX_LINES` lines). Refuses with exactly the refusal the write would
   * raise. A price edited between this and the write can still refuse a line
   * once the working basket exists — which then removes it; placement prices the basket again either way. With
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
    /** Feature 163 (FR-100) — the basket's channel, whose minimums the batch is judged on. */
    channelId: string | null | undefined,
  ): Promise<Map<number, CartBatchRejection>> {
    if (resolvedLines.length === 0) return new Map();
    const vetted = new Map(resolvedLines.map(({ resolved }) => [resolved.product.id, resolved.product]));
    const products = new Map(
      (await withBasketOrderRules(this.availability, [...vetted.values()], channelId)).map((p) => [p.id, p]),
    );
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
  async #throwIfBelowMinimum(
    actor: CartActor,
    rejections: ReadonlyMap<number, CartBatchRejection>,
    resolvedLines: ReadonlyArray<{ index: number; resolved: ResolvedCartLine; input: CartBatchLineInput }>,
    options: { onBelowMinimum?: 'report' | 'throw'; language?: string },
  ): Promise<void> {
    if (options.onBelowMinimum !== 'throw' || rejections.size === 0) return;
    const violations = [...rejections.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, rejection]) => ({ ...rejection, key: String(index) }));
    // Feature 163 (FR-017 d) — the names the storefront shows in this basket.
    const effective = await this.#effectiveNamesFor(actor, resolvedLines);
    const names = new Map(
      resolvedLines.map(({ resolved }) => [
        resolved.product.id,
        effective.get(resolved.product.id) ?? pickLocalized(resolved.product.name, options.language),
      ]),
    );
    const refusal = minimumRefusal(violations, names, 'index');
    if (refusal === null) return;
    throw new HttpError(422, ERROR_CODES[refusal.code], refusal.message, refusal.details);
  }

  /**
   * Feature 163 (FR-017 d) — the effective names of a batch's products at the
   * basket's (channel, language): `catalog`'s answer, the walk a storefront card
   * shows. An operator naming the channel is answered in its default language (N2).
   */
  async #effectiveNamesFor(
    actor: CartActor,
    resolvedLines: ReadonlyArray<{ resolved: ResolvedCartLine; input: CartBatchLineInput }>,
  ): Promise<Map<string, string>> {
    const named = resolvedLines.find(({ input }) => input.salesChannelId)?.input.salesChannelId;
    if (resolvedLines.length === 0) return new Map();
    const channelId = named ?? this.#basketChannelOf(actor);
    return this.availability.effectiveNames(
      [...new Set(resolvedLines.map(({ resolved }) => resolved.product.id))],
      { channelId, languageCode: named ? null : basketScopeLanguage(channelId, actor.languageTag) },
    );
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
    const { product, packagingUnit, packagingUnitName, effectiveQuantity } = resolved;
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
      this.#reArmWithin(em, cart, actor);
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
            packagingUnitName: packagingUnitName ?? packagingUnit.name,
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
    this.#reArmWithin(em, cart, actor);
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
    // Issue #227 / #259 / feature 163 — a product this shopper may not acquire
    // here, now, is a product they may not put in a cart. The read port is the
    // row-level one and applies no policy of its own, deliberately: an order
    // line has to resolve its product long after the operator restricted it.
    // That makes enforcement the caller's, and this caller is holding a
    // `productId` the buyer chose.
    //
    // 404 and not 403, matching the product detail: "does not exist", "sold on
    // another channel", "restricted to another organisation", "switched off in
    // this language" and "outside its publication window" have to be one
    // answer, or the set of them is an enumeration oracle over an operator's
    // private assortment — the defect issue #174 found in the type-ahead.
    const notFound = (): HttpError =>
      new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    if (!product) throw notFound();
    // The channel is the basket's: the one the route resolved and handed over
    // on the actor (`#basketChannelOf`, which refuses an actor naming none), so
    // there is no audience-only answer for a basket — every add is asked at a
    // channel (security review, checkpoint B). The one exception is a caller
    // that names the channel itself: an administrator creating an order on a
    // customer's behalf chooses the order's channel in the request body (buyer
    // routes never pass `salesChannelId`), and is answered in that channel's
    // default language (N2).
    const channelId = input.salesChannelId ?? this.#basketChannelOf(actor);
    const scopeLanguage = input.salesChannelId ? null : basketScopeLanguage(channelId, actor.languageTag);
    const available = await this.availability.filterAvailable([product.id], {
      channelId,
      languageCode: scopeLanguage,
      audience: cartAudience(actor),
    });
    if (!available.has(product.id)) throw notFound();

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
    // Feature 163 (FR-079, T138; owner decision 2026-10-26) — the snapshot takes the
    // unit's name in the basket's language; a placed line keeps it, never re-resolved.
    // An operator naming the channel has no request language: the name is taken at
    // that channel's default language (owner decision N2 = B), as the product name
    // beside it is. The channel is read only when a unit is named.
    const unitLanguage =
      packagingUnit && input.salesChannelId
        ? await this.#channelDefaultLanguage(input.salesChannelId)
        : scopeLanguage;
    const packagingUnitName = packagingUnit ? effectivePackagingUnitName(packagingUnit, unitLanguage) : null;
    return { product, packagingUnit, packagingUnitName, effectiveQuantity };
  }

  /** N2 — a named channel's default language, `null` (the global name) when unknown. */
  async #channelDefaultLanguage(channelId: string): Promise<string | null> {
    if (!this.channelReads) return null;
    return (await this.channelReads.getById(channelId))?.defaultLanguage ?? null;
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
        // Feature 163 (FR-100) — judged on the basket channel's minimum.
        product: await this.#withChannelRules(await this.catalogProducts.findById(item.productId), cart.salesChannelId),
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
    // A quantity set to what it already was changes nothing to approve.
    if (quantity !== oldQuantity) this.#reArmWithin(em, cart, actor);
    await em.flush();
    if (quantity <= 0) await this.#forgetSourceWhenEmptied(em, cart);
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
    this.#reArmWithin(em, cart, actor);
    await em.flush();
    await this.#forgetSourceWhenEmptied(em, cart);
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
export function cartAudience(actor: CartActor): ProductAudience {
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
  productName: string,
): CartBatchLineOutcome {
  return {
    index,
    status: 'below_minimum',
    productId: rejection.productId,
    productName,
    kind: rejection.kind,
    minimum: rejection.minimum,
    ...(rejection.kind === 'packaging_unit' ? { packagingUnitName: rejection.packagingUnitName } : {}),
  };
}
