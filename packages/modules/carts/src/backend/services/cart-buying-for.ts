import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CartBuyingFor,
  CartBuyingForResetReason,
  CartRepricingSummary,
  CatalogProductReadPort,
  PayerPolicySubject,
  RelatedPayerPolicyPort,
} from '@endora-commerce/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { agreementOf, type CartLinePricing } from './cart-line-pricing.js';

export interface CartBuyingForDeps {
  readonly emFactory: () => EntityManager;
  /** `related_payers`' policy, or `null` while it is absent (`degrades-without`). */
  readonly policy: () => RelatedPayerPolicyPort | null;
  readonly linePricing: Pick<CartLinePricing, 'contextFor' | 'orderablePrices'>;
  readonly catalogProducts: Pick<CatalogProductReadPort, 'findByIds'>;
  /** Drops the cart's recompute cache, so the next read prices in the new context. */
  readonly invalidate: (cartId: string) => Promise<void>;
}

/**
 * `specs/182-related-payers/` FR-110 to FR-116 — *Buying for*: whose commercial terms price a
 * cart. The link decides the terms (`relatedPayerPolicyPort`); this service records the choice on
 * the cart and reprices every stored line in the same operation, so what the cart stores is what
 * placement's drift check finds (`cart-placement-apply-port.ts`).
 *
 * The engine is named the **payer**, with no customer account (A-18): an X user's own customer
 * group never reaches Y's prices. The display mode stays the buyer's (RP-14), which
 * `CartLinePricing.contextFor` carries.
 *
 * Not a Command: the choice is the buyer's ephemeral working state, as a quantity change is
 * (the `refreshLinePrices` precedent); the order records the terms it was placed on (FR-117).
 */
export class CartBuyingForService {
  constructor(private readonly deps: CartBuyingForDeps) {}

  /** Sets (`payerOrganizationId`) or clears (`null`) the cart's *Buying for* (FR-110, FR-113). */
  async set(input: {
    cartId: string;
    subject: PayerPolicySubject;
    payerOrganizationId: string | null;
  }): Promise<{ buyingFor: CartBuyingFor | null; repricing: CartRepricingSummary }> {
    // command-coverage-ignore: the buyer's own ephemeral basket — whose terms price it and the
    // derived line prices — the same class of working state as a quantity change; no order
    // exists, and the order records the terms it was placed on (FR-117).
    let next: CartBuyingFor | null = null;
    if (input.payerOrganizationId !== null) {
      const policy = this.deps.policy();
      if (!policy) throw new Error('[carts] Buying for a payer needs related_payers, which is absent.');
      // Throws `422 RELATED_PAYER_NOT_USABLE` before anything is written.
      const usable = await policy.assertUsable(input.subject, input.payerOrganizationId);
      next = { organizationId: usable.payerOrganizationId, name: usable.payerName, terms: usable.commercialTerms };
    }
    const em = this.deps.emFactory();
    const cart = await em.findOneOrFail(Cart, { id: input.cartId });
    cart.buyingForOrganizationId = next?.organizationId ?? null;
    cart.buyingForTerms = next?.terms ?? null;
    const repricing = await this.#reprice(em, cart);
    await em.flush();
    await this.deps.invalidate(cart.id);
    // The promotions the switch adds and removes are the route's: the cart read's own answer
    // before and after (RP-19 b).
    return { buyingFor: next, repricing };
  }

  /**
   * FR-116 — on a cart read: a payer's-terms cart whose link is no longer usable, or no longer
   * on the payer's terms, returns to the buyer's own context and is repriced. Answers why, or
   * `null` when nothing changed. A buyer's-terms choice that stopped being usable is cleared too.
   */
  async resetIfUnusable(input: {
    cartId: string;
    subject: PayerPolicySubject;
  }): Promise<{ reason: CartBuyingForResetReason; previousOrganizationId: string } | null> {
    // command-coverage-ignore: drops the buyer's ephemeral basket back to its own prices on a
    // read that found the payer unusable (FR-116) — derived working state, no domain decision.
    const em = this.deps.emFactory();
    const cart = await em.findOneOrFail(Cart, { id: input.cartId });
    const previous = cart.buyingForOrganizationId ?? null;
    if (previous === null) return null;
    const reason = await this.#unusableReason(input.subject, previous, cart.buyingForTerms ?? null);
    if (reason === null) return null;
    cart.buyingForOrganizationId = null;
    cart.buyingForTerms = null;
    await this.#reprice(em, cart);
    await em.flush();
    await this.deps.invalidate(cart.id);
    return { reason, previousOrganizationId: previous };
  }

  async #unusableReason(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
    terms: 'buyer' | 'payer' | null,
  ): Promise<CartBuyingForResetReason | null> {
    const policy = this.deps.policy();
    if (!policy) return 'capability_unavailable';
    try {
      if (terms === 'payer') {
        return (await policy.pricingContext(subject, payerOrganizationId)) === null ? 'terms_changed' : null;
      }
      await policy.assertUsable(subject, payerOrganizationId);
      return null;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 422) return 'link_not_usable';
      throw error;
    }
  }

  /**
   * Every stored line at the price of the cart's current context; the per-line summary
   * (FR-113). Promotions are re-evaluated by the cart read that follows; the summary does not
   * name them yet (see `tasks.md`, Phase 4 notes).
   */
  async #reprice(em: EntityManager, cart: Cart): Promise<CartRepricingSummary> {
    const items = await em.find(CartItem, { cartId: cart.id });
    const none = { lines: [], promotionsAdded: [], promotionsRemoved: [] };
    if (items.length === 0 || !cart.salesChannelId) return none;
    const payerTerms = cart.buyingForTerms === 'payer' ? (cart.buyingForOrganizationId ?? null) : null;
    const ctx = await this.deps.linePricing.contextFor(em, {
      organizationId: cart.organizationId ?? null,
      signedIn: true,
      salesChannelId: cart.salesChannelId,
      // A-18 — on the payer's terms the engine is named the payer and no account.
      customerAccountId: payerTerms ? null : (cart.customerAccountId ?? null),
      pricingOrganizationId: payerTerms,
    });
    const products = await this.deps.catalogProducts.findByIds([...new Set(items.map((it) => it.productId))]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const answers = await this.deps.linePricing.orderablePrices(
      ctx,
      items.flatMap((item) => {
        const product = productById.get(item.productId);
        return product
          ? [{ key: item.id, product, variantId: item.variantId ?? null, quantity: item.quantity, agreed: agreementOf(item) }]
          : [];
      }),
    );
    const lines: CartRepricingSummary['lines'] = [];
    for (const item of items) {
      const before = { amount: Number(item.unitPrice), currency: item.currency };
      const answer = answers.get(item.id);
      if (!answer?.ok) {
        // FR-114 — kept, its stored price untouched; placement refuses an unpriced line.
        lines.push({ lineId: item.id, before, after: null, unpriced: true });
        continue;
      }
      // The buyer's ephemeral basket repriced in its new context.
      item.unitPrice = answer.unitPrice;
      item.currency = answer.currency;
      item.priceSource = answer.priceSource ?? null;
      lines.push({ lineId: item.id, before, after: { amount: Number(answer.unitPrice), currency: answer.currency }, unpriced: false });
    }
    return { lines, promotionsAdded: [], promotionsRemoved: [] };
  }
}
