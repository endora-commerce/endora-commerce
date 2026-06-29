import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { CartService } from '../../carts/services/cart-service.js';
import type { AddressService } from '../../addresses/services/address-service.js';
import type { Mailer } from '../../email/services/mailer.js';
import type { Order } from '../entities/order.entity.js';
import { OrderComment } from '../entities/order-comment.entity.js';
import type { OrderService } from './order-service.js';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { buildAdminCreatedOrderEmail } from '../email-templates/admin-created-order.js';
import { sendOrderTransactionalEmail } from './transactional-email-helper.js';

/** A new address typed on the create form (vs. an existing org address id). */
export interface AdminCreateOrderInlineAddress {
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | undefined;
  saveToAddressBook: boolean;
}

export interface AdminCreateOrderInput {
  customerAccountId: string;
  salesChannelId: string;
  items: Array<{ productId: string; variantId?: string | undefined; quantity: number }>;
  deliveryMethodId: string;
  paymentMethodId: string;
  /** Per side, supply EITHER an existing org address id OR an inline address. */
  deliveryAddressId?: string | undefined;
  billingAddressId?: string | undefined;
  deliveryAddress?: AdminCreateOrderInlineAddress | undefined;
  billingAddress?: AdminCreateOrderInlineAddress | undefined;
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
    private readonly addressService: AddressService,
    private readonly mailer?: Mailer,
    private readonly getTransactionalEmailSender?: () => TransactionalEmailSender | undefined,
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

    // Resolve each address side to an org address id. An inline address is
    // created in the org book (so placeOrder can look it up and snapshot it);
    // a non-saved inline address is soft-deleted again after placement — the
    // order keeps its standalone JSONB snapshot, so the book stays clean.
    const transientAddressIds: string[] = [];
    const resolveAddress = async (
      kind: 'delivery' | 'billing',
      id: string | undefined,
      inline: AdminCreateOrderInlineAddress | undefined,
    ): Promise<string> => {
      if (id) return id;
      if (!inline) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `Missing ${kind} address.`);
      }
      const created = await this.addressService.createAddress(organizationId, {
        kind,
        recipientName: inline.recipientName,
        street: inline.street,
        city: inline.city,
        postalCode: inline.postalCode,
        country: inline.country,
        ...(inline.phone ? { phone: inline.phone } : {}),
        // Never demote the org's real default for an order-form address.
        isDefault: false,
      });
      if (!inline.saveToAddressBook) transientAddressIds.push(created.id);
      return created.id;
    };

    const cleanupTransient = async (): Promise<void> => {
      for (const addressId of transientAddressIds) {
        try {
          await this.addressService.deleteAddress(organizationId, addressId);
        } catch {
          // best-effort cleanup; a leftover soft-deletable row is harmless.
        }
      }
    };

    let order: Order;
    try {
      const deliveryAddressId = await resolveAddress(
        'delivery',
        input.deliveryAddressId,
        input.deliveryAddress,
      );
      const billingAddressId = await resolveAddress(
        'billing',
        input.billingAddressId,
        input.billingAddress,
      );

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

      order = await this.orderService.placeOrder(
        { customerAccountId: input.customerAccountId, organizationId, impersonatorAdminUserId: adminUserId },
        {
          deliveryAddressId,
          billingAddressId,
          deliveryMethodId: input.deliveryMethodId,
          paymentMethodId: input.paymentMethodId,
          salesChannelId: input.salesChannelId,
          ...(input.customerNote ? { customerNote: input.customerNote } : {}),
        },
      );
    } catch (err) {
      await cleanupTransient();
      throw err;
    }
    // Placement succeeded and snapshotted the addresses onto the order; drop any
    // one-time addresses from the reusable org address book.
    await cleanupTransient();

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
    if (customer.email) {
      const sender = this.getTransactionalEmailSender?.();
      try {
        if (sender) {
          await sendOrderTransactionalEmail(em, sender, order, {
            code: 'admin_created_order',
            to: customer.email,
            messageId: `order_created_for_you:${order.id}`,
            variables: { order: { businessId: order.businessId, id: order.id } },
            meta: { orderId: order.id, kind: 'order_created_for_you' },
          });
        } else if (this.mailer) {
          await this.mailer.send(
            buildAdminCreatedOrderEmail({ to: customer.email, businessId: order.businessId, orderId: order.id }),
          );
        }
      } catch {
        // best-effort
      }
    }

    return order;
  }
}
