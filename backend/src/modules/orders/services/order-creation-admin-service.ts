import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { CartService } from '../../carts/services/cart-service.js';
import type { Mailer } from '../../email/services/mailer.js';
import { Order } from '../entities/order.entity.js';
import { OrderComment } from '../entities/order-comment.entity.js';
import type { OrderService } from './order-service.js';
import { buildAdminCreatedOrderEmail } from '../email-templates/admin-created-order.js';

export interface AdminCreateOrderInput {
  customerAccountId: string;
  salesChannelId: string;
  items: Array<{ productId: string; variantId?: string | undefined; quantity: number }>;
  deliveryMethodId: string;
  paymentMethodId: string;
  deliveryAddressId: string;
  billingAddressId: string;
  customerNote?: string | undefined;
  comment?: { body: string; isCustomerVisible: boolean; notifyCustomer: boolean } | undefined;
}

/**
 * OrderCreationAdminService — feature 038 (US3).
 *
 * A sales rep / admin builds an order for a customer (own item selection,
 * customer, payment + delivery method, billing + delivery address). We seed the
 * customer's cart from the chosen items, then run the existing on-behalf
 * `placeOrder` (real pricing, stock reservation, min-value gate, payment
 * next-action), and notify the customer that an order awaits their payment.
 */
export class OrderCreationAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartService: CartService,
    private readonly orderService: OrderService,
    private readonly mailer?: Mailer,
  ) {}

  async create(adminUserId: string | null, input: AdminCreateOrderInput): Promise<Order> {
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, { id: input.customerAccountId });
    if (!customer) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    if (!customer.organizationId) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Customer has no organization; cannot create an order on their behalf.',
      );
    }
    const organizationId = customer.organizationId;
    const customerCtx = { customerAccountId: input.customerAccountId, organizationId };

    // Seed the customer's cart from the admin-entered items (current pricing
    // via CartService). Clearing first matches the platform's single-active-cart
    // model (same approach as RfqService.convertToOrder).
    await this.cartService.clearForCustomer(customerCtx);
    for (const it of input.items) {
      await this.cartService.addItem(
        { customer: customerCtx },
        { productId: it.productId, ...(it.variantId ? { variantId: it.variantId } : {}), quantity: it.quantity },
      );
    }

    const order = await this.orderService.placeOrder(
      { customerAccountId: input.customerAccountId, organizationId, impersonatorAdminUserId: adminUserId },
      {
        deliveryAddressId: input.deliveryAddressId,
        billingAddressId: input.billingAddressId,
        deliveryMethodId: input.deliveryMethodId,
        paymentMethodId: input.paymentMethodId,
        salesChannelId: input.salesChannelId,
        ...(input.customerNote ? { customerNote: input.customerNote } : {}),
      },
    );

    // Optional initial comment captured on the create form.
    if (input.comment) {
      em.persist(
        em.create(OrderComment, {
          orderId: order.id,
          authorAdminUserId: adminUserId,
          authorCustomerAccountId: null,
          body: input.comment.body,
          isCustomerVisible: input.comment.isCustomerVisible,
          notifyCustomer: input.comment.notifyCustomer,
        }),
      );
      await em.flush();
    }

    // Notify the customer that an order was created for them (FR-011).
    if (this.mailer && customer.email) {
      try {
        await this.mailer.send(
          buildAdminCreatedOrderEmail({ to: customer.email, businessId: order.businessId, orderId: order.id }),
        );
      } catch {
        // best-effort
      }
    }

    return order;
  }
}
