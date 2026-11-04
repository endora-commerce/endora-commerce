import {
  ERROR_CODES,
  isOrderMinimumEligibleType,
  type CartWritePort,
  type CatalogProductReadPort,
  type OrderPlacementPort,
  type OrganizationPermissionPort,
  type OrganizationPermissionSubject,
  type PlacedOrderRecord,
  type QuickOrderOneClickEligibility,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { DefaultPreferenceService } from './default-preference-service.js';

export interface OneClickContext {
  customerAccountId: string;
  organizationId: string;
  /** The member's role id when the request's actor carries it (research R-15); the port reads the account's otherwise. */
  organizationRoleId?: string | null;
}

export interface OneClickPlaceInput {
  productId: string;
  variantId?: string | null;
  quantity?: number;
  idempotencyKey?: string;
}

/**
 * OneClickService (feature 039, US5). Computes whether the one-click button
 * should show, and places a one-click order through the platform's one
 * placement path: write the chosen product into a working basket (the buyer's
 * active basket is left alone, issue #169), then run `OrderService.placeOrder`
 * from it with the buyer's resolved default methods
 * and addresses. All order validation (org active, minimum value, credit limit,
 * stock) and the payment-routing `nextAction` come from `placeOrder` (FR-029 /
 * FR-030); no parallel ordering path (FR-031).
 *
 * Both collaborators are `@endora-commerce/contracts` ports since feature 075's Phase C —
 * `cartWritePort` and `orderPlacementPort`. The lazy `() => OrderService | null`
 * accessor is gone with them: the port's gate answers 503 `MODULE_DISABLED`
 * when `orders` is not present, which is the same refusal the `null` branch
 * spelled by hand, except that a `null` accessor was indistinguishable from a
 * wiring mistake. `placeOrder` answers `PlacedOrderRecord`, which is
 * `OrderRecord` **plus** `nextAction` — the payment routing this reply exists
 * to carry.
 *
 * **The channel is a per-call argument, not a constructor default** (issue #99,
 * D-48). It used to be `salesChannelId: string = 'default'` — a fifth
 * constructor parameter `backend.ts` never passed, so every deployment read the
 * setting against a channel *code*, tripped the settings seam guard, and
 * reported `setting_disabled` indistinguishably from an operator having
 * switched one-click buy off. The routes read the channel the canonical
 * resolver put on the request and hand it down; `null` means there is none, and
 * then the setting is read platform-wide (D-41 case c) and the order records no
 * channel rather than an invented one.
 */
export class OneClickService {
  constructor(
    private readonly preferenceService: DefaultPreferenceService,
    private readonly cartWrite: CartWritePort,
    private readonly orderPlacement: OrderPlacementPort,
    private readonly resolveOneClickEnabled: (salesChannelId: string | null) => Promise<boolean>,
    /**
     * Feature 155 (FR-010, R12.3) — where the default quantity comes from: the
     * product's pieces minimum. `quick_order` already declares `catalog`.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * `specs/170-organization-roles/` (OR-1, OR-6, FR-050; issue #653) — whom
     * one-click is for. `organizations`' port, resolved lazily by the
     * composition and never captured.
     */
    private readonly permissions: OrganizationPermissionPort,
  ) {}

  /**
   * Whether the PDP offers one-click buy to this member, and if not, why.
   *
   * The member's role is judged first (FR-050, research R-6, owner ruling
   * PR-8): no `quick_order.one_click` reads `permission_required`; holding it
   * without `carts.order_without_approval` reads `cart_approval_required` — a
   * cart of theirs needs approval, and one-click is a way round it (#653). In
   * that order, so a member lacking both reads `permission_required`, and both
   * before the operator setting and the defaults: a member who may not buy
   * this way is not told to set up defaults for it.
   */
  async eligibility(
    ctx: OneClickContext,
    salesChannelId: string | null,
  ): Promise<QuickOrderOneClickEligibility> {
    const subject = subjectOf(ctx);
    if (!(await this.permissions.can(subject, 'quick_order.one_click'))) {
      return { enabled: false, reason: 'permission_required' };
    }
    if (!(await this.permissions.can(subject, 'carts.order_without_approval'))) {
      return { enabled: false, reason: 'cart_approval_required' };
    }
    return this.#availability(ctx.customerAccountId, salesChannelId);
  }

  /** The operator setting and the four defaults — what decided eligibility before roles. */
  async #availability(
    customerAccountId: string,
    salesChannelId: string | null,
  ): Promise<QuickOrderOneClickEligibility> {
    const enabled = await this.resolveOneClickEnabled(salesChannelId);
    if (!enabled) return { enabled: false, reason: 'setting_disabled' };

    // For this channel: a default method the channel does not offer is not a
    // usable default, and the button must not be offered on the strength of it.
    const defaults = await this.preferenceService.resolveForCustomer(
      customerAccountId,
      salesChannelId,
    );
    if (
      !defaults.paymentMethodId ||
      !defaults.deliveryMethodId ||
      !defaults.billingAddressId ||
      !defaults.shippingAddressId
    ) {
      return { enabled: false, reason: 'missing_defaults' };
    }
    return { enabled: true, reason: null };
  }

  /**
   * `salesChannelId` is required here, unlike {@link eligibility}: the order is
   * placed from the basket of the channel it is placed on
   * (`specs/154-sales-channel-access/`), so the basket this fills and the order
   * it places have to name the same one.
   */
  async place(
    ctx: OneClickContext,
    input: OneClickPlaceInput,
    salesChannelId: string,
    /** The language a minimum refusal names the product in (feature 155, D3/D4). */
    options: { language?: string } = {},
  ): Promise<PlacedOrderRecord> {
    // The role first, on the same rule and in the same order as
    // `eligibility` (FR-050, PR-8): `403 ORGANIZATION_PERMISSION_REQUIRED`
    // naming the first missing code, before anything below reads or writes.
    // The route declares the same two guards; this is the line an in-process
    // caller cannot step round.
    const subject = subjectOf(ctx);
    const language = options.language ? { language: options.language } : {};
    await this.permissions.assert(subject, 'quick_order.one_click', language);
    await this.permissions.assert(subject, 'carts.order_without_approval', language);

    const eligibility = await this.#availability(ctx.customerAccountId, salesChannelId);
    if (!eligibility.enabled) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'One-click buy is not available.', {
        code: 'one_click_unavailable',
        reason: eligibility.reason,
      });
    }

    // The same channel-aware read `#availability` just made, so the methods used
    // below are the ones it vouched for — and the refusal above came before the
    // basket is touched.
    const defaults = await this.preferenceService.resolveForCustomer(
      ctx.customerAccountId,
      salesChannelId,
    );
    const customerCtx = { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId };
    // Read before the basket is touched, so a failed read leaves it as it was.
    const quantity = input.quantity ?? (await this.#defaultQuantity(input.productId));

    // The line is written into a working basket of the buyer's, and the order
    // is placed from it: the buyer's own active basket — a quote-seeded one
    // included — is not touched (issue #169). `addItems` creates the working
    // basket only once nothing is left to refuse the line for — resolution,
    // the minimums, the price — and placement removes it again when it refuses
    // (stock, the organization, a method), so a refused one-click leaves
    // nothing behind.
    //
    // The basket is one of the channel the order is placed on
    // (`specs/154-sales-channel-access/`, contracts/basket-attribution.md §1).
    const working = await this.cartWrite.addItems(
      { customer: { ...customerCtx, salesChannelId } },
      [
        {
          productId: input.productId,
          ...(input.variantId ? { variantId: input.variantId } : {}),
          quantity,
        },
      ],
      {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        workingBasket: true,
        ...(options.language ? { language: options.language } : {}),
      },
    );

    return this.orderPlacement.placeOrder(
      customerCtx,
      {
        deliveryAddressId: defaults.shippingAddressId!,
        billingAddressId: defaults.billingAddressId!,
        deliveryMethodId: defaults.deliveryMethodId!,
        paymentMethodId: defaults.paymentMethodId!,
        salesChannelId,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
      { ...(options.language ? { language: options.language } : {}), workingBasketId: working.cart.id },
    );
  }

  /**
   * Feature 155 (FR-010, R12.3, analyze F14) — the product's pieces minimum
   * when its type carries one (`simple` / `configurable`) and it is above 1;
   * otherwise 1. A product the read does not find gets 1, and the add path
   * answers it with the unknown id's 404 — the minimum of a product the buyer
   * may not see only ever sizes a line `addItem` then refuses as unknown.
   */
  async #defaultQuantity(productId: string): Promise<number> {
    const product = await this.catalogProducts.findById(productId);
    if (!product || !isOrderMinimumEligibleType(product.type)) return 1;
    const minimum = product.minOrderQuantity;
    return minimum !== null && minimum > 1 ? minimum : 1;
  }
}

/** The member judged: the account, its Organization, and the role id when the actor carried one. */
function subjectOf(ctx: OneClickContext): OrganizationPermissionSubject {
  return {
    customerAccountId: ctx.customerAccountId,
    organizationId: ctx.organizationId,
    ...(ctx.organizationRoleId !== undefined ? { organizationRoleId: ctx.organizationRoleId } : {}),
  };
}
