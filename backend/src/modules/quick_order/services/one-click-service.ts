import {
  ERROR_CODES,
  type QuickOrderOneClickEligibility,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CartService } from '../../carts/services/cart-service.js';
import type { Order } from '../../orders/entities/order.entity.js';
import type { OrderService } from '../../orders/services/order-service.js';
import type { DefaultPreferenceService } from './default-preference-service.js';

export interface OneClickContext {
  customerAccountId: string;
  organizationId: string;
}

export interface OneClickPlaceInput {
  productId: string;
  variantId?: string | null;
  quantity?: number;
  idempotencyKey?: string;
}

/**
 * OneClickService (feature 039, US5). Computes whether the one-click button
 * should show, and places a one-click order by reusing the platform's
 * established single-active-cart flow: clear the cart, add the chosen product,
 * then run `OrderService.placeOrder` with the buyer's resolved default methods
 * and addresses. All order validation (org active, minimum value, credit limit,
 * stock) and the payment-routing `nextAction` come from `placeOrder` (FR-029 /
 * FR-030); no parallel ordering path (FR-031).
 *
 * `OrderService` is injected through a lazy getter so the orders module never
 * depends on quick_order (it is late-bound at request time, mirroring the
 * existing getRfqService / getShoppingListService pattern).
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
    private readonly cartService: CartService,
    private readonly getOrderService: () => OrderService | null,
    private readonly resolveOneClickEnabled: (salesChannelId: string | null) => Promise<boolean>,
  ) {}

  async eligibility(
    customerAccountId: string,
    salesChannelId: string | null,
  ): Promise<QuickOrderOneClickEligibility> {
    const enabled = await this.resolveOneClickEnabled(salesChannelId);
    if (!enabled) return { enabled: false, reason: 'setting_disabled' };

    const defaults = await this.preferenceService.resolveForCustomer(customerAccountId);
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

  async place(
    ctx: OneClickContext,
    input: OneClickPlaceInput,
    salesChannelId: string | null,
  ): Promise<Order> {
    const eligibility = await this.eligibility(ctx.customerAccountId, salesChannelId);
    if (!eligibility.enabled) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'One-click buy is not available.', {
        code: 'one_click_unavailable',
        reason: eligibility.reason,
      });
    }

    const orderService = this.getOrderService();
    if (!orderService) {
      throw new HttpError(503, ERROR_CODES.NOT_FOUND, 'Ordering is unavailable.');
    }

    const defaults = await this.preferenceService.resolveForCustomer(ctx.customerAccountId);
    const customerCtx = { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId };

    // Clear-then-seed matches the single-active-cart model used by admin
    // order-create and RFQ-convert.
    await this.cartService.clearForCustomer(customerCtx);
    await this.cartService.addItem(
      { customer: customerCtx },
      {
        productId: input.productId,
        ...(input.variantId ? { variantId: input.variantId } : {}),
        quantity: input.quantity ?? 1,
      },
    );

    return orderService.placeOrder(customerCtx, {
      deliveryAddressId: defaults.shippingAddressId!,
      billingAddressId: defaults.billingAddressId!,
      deliveryMethodId: defaults.deliveryMethodId!,
      paymentMethodId: defaults.paymentMethodId!,
      ...(salesChannelId ? { salesChannelId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
  }
}
