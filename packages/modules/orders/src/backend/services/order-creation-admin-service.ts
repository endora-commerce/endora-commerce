import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressServicePort,
  type CartWritePort,
  type CustomerAccountReadPort,
  type OriginReference,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { Order } from '../entities/order.entity.js';
import { OrderComment } from '../entities/order-comment.entity.js';
import type { OrderService } from './order-service.js';
import type { EmailMailerPort, TransactionalEmailSender } from '@endora-commerce/contracts';
import { buildAdminCreatedOrderEmail } from '../email-templates/admin-created-order.js';
import {
  orderEmailNotSent,
  sendOrderTransactionalEmail,
} from './transactional-email-helper.js';
import { rethrowIfModuleDisabled, SalesChannel } from '@endora-commerce/platform/kernel';
import { assertWithinAdminOrderItemBound } from './request-minimums.js';
import { planAdminLineGrouping } from '../domain/quote-line-groups.js';

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
  /**
   * In display order: each group's lines, then the ungrouped ones. `groupKey`
   * names one of `groups` (feature 159; the route's schema has checked it).
   */
  items: Array<{
    productId: string;
    variantId?: string | undefined;
    quantity: number;
    groupKey?: string | null | undefined;
  }>;
  /** Feature 159 — the new order's groups, in display order; a group no line names is not created. */
  groups?: Array<{ key: string; name: string }> | undefined;
  deliveryMethodId: string;
  paymentMethodId: string;
  /** Per side, supply EITHER an existing org address id OR an inline address. */
  deliveryAddressId?: string | undefined;
  billingAddressId?: string | undefined;
  deliveryAddress?: AdminCreateOrderInlineAddress | undefined;
  billingAddress?: AdminCreateOrderInlineAddress | undefined;
  customerNote?: string | undefined;
  comment?: { body: string; isCustomerVisible: boolean; notifyCustomer: boolean } | undefined;
  /** Where the order is created from — opaque here; handed on to `order.created.v1`. */
  origin?: OriginReference | undefined;
}

/**
 * OrderCreationAdminService — feature 038 (US3).
 *
 * A sales rep / admin builds an order for a customer (own item selection,
 * customer, payment + delivery method, billing + delivery address). We seed the
 * customer's working basket from the chosen items, then run the existing on-behalf
 * `placeOrder` (real pricing, stock reservation, min-value gate, payment
 * next-action), and notify the customer that an order awaits their payment.
 */
export class OrderCreationAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartService: CartWritePort,
    private readonly orderService: OrderService,
    private readonly addressService: AddressServicePort,
    private readonly customerAccountRead: CustomerAccountReadPort,
    private readonly mailer?: EmailMailerPort,
    private readonly getTransactionalEmailSender?: () => TransactionalEmailSender | undefined,
  ) {}

  /**
   * `options.language` names a product refused for its minimum (the request's
   * `Accept-Language`); absent, the product record's own fallback chain.
   */
  async create(
    adminUserId: string | null,
    input: AdminCreateOrderInput,
    options: { language?: string | undefined } = {},
  ): Promise<Order> {
    // Feature 155 (FR-038) — first, before anything is read or written.
    assertWithinAdminOrderItemBound(input.items.length);
    // Feature 159 (FR-061) — the request's grouping, every line kept.
    const lineGrouping =
      input.groups === undefined ? undefined : planAdminLineGrouping(input.groups, input.items);
    // command-coverage-ignore: the order write is delegated to
    // OrderService.placeOrder (audited there); the only local mutation here is
    // the optional append-only OrderComment, not audited domain-state.
    const em = this.emFactory();
    const customer = await this.customerAccountRead.findById(input.customerAccountId);
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

    // The operator names the order's channel, so it has to be one. Placement
    // falls back to the system default for a channel it cannot find, which is
    // right for a storefront request that named none and wrong here: the
    // order would land on a channel nobody chose. Refused before anything is
    // written — the customer's basket included.
    const channel = await em.findOne(
      SalesChannel,
      { id: input.salesChannelId },
      { fields: ['id'] },
    );
    if (!channel) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sales channel not found.');

    // The customer's Organization allow-lists bind the operator too. Asked
    // here as well as inside `placeOrder`, because this method writes a working
    // basket and inline addresses before it places: nothing is written yet.
    await this.orderService.assertMethodsAllowedForOrganization({
      organizationId,
      deliveryMethodId: input.deliveryMethodId,
      paymentMethodId: input.paymentMethodId,
    });

    // Before anything is written. `placeOrder`'s own channel gate would refuse
    // only after the working basket and the inline addresses exist.
    await this.orderService.assertMethodsOfferedInChannel({
      salesChannelId: input.salesChannelId,
      deliveryMethodId: input.deliveryMethodId,
      paymentMethodId: input.paymentMethodId,
    });

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
        } catch (error) {
          // `addresses` being absent is not a cleanup failure — it is the port's
          // fail-closed answer, and it travels on (issue #197).
          rethrowIfModuleDisabled(error);
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

      // Write the admin-entered items into a working basket of the customer's
      // (current pricing via CartService) and place the order from it. The
      // customer's own active basket — a quote-seeded one included — is not
      // touched (issue #169): the working basket stands beside it and ends
      // completed against this order, or is removed when placement refuses. The
      // assortment is judged on the order's channel, not on the admin request's.
      //
      // Feature 155 (FR-009, R8): one batch, so a product's minimum is judged
      // on its total across the request's lines (D1). A line the customer may
      // not see, or that the channel does not sell, is thrown before anything
      // is written, with the unknown id's answer (FR-035); any line below a
      // minimum refuses the whole request, keyed by its index. Placement checks
      // the basket again (FR-037) — this is the earlier, request-shaped answer,
      // not the only one.
      //
      // The basket is one of the order's channel, the channel the operator
      // named (`specs/154-sales-channel-access/`, contracts/basket-attribution.md
      // §1), so placement below reads the basket this writes.
      const basketCtx = { ...customerCtx, salesChannelId: input.salesChannelId };
      const lines = input.items.map((it) => ({
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        salesChannelId: input.salesChannelId,
      }));
      //
      // Feature 159 (research N-31) — every request line stays a line of its
      // own (`keepRepeatedLines`): one product may sit on lines of several
      // groups, each priced at its own quantity, and the basket reads back in
      // request order, which is what placement lays the groups out by.
      const working = await this.cartService.addItems({ customer: basketCtx }, lines, {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        workingBasket: true,
        keepRepeatedLines: true,
        ...(options.language ? { language: options.language } : {}),
      });

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
        {
          ...(input.origin ? { origin: input.origin } : {}),
          ...(options.language ? { language: options.language } : {}),
          ...(lineGrouping ? { lineGrouping } : {}),
          workingBasketId: working.cart.id,
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
    // Best-effort, and reported: the order is committed, so a message that does
    // not go out is named in the log rather than silently absorbed (issue #78).
    const emailContext = { orderId: order.id, code: 'admin_created_order' };
    if (!customer.email) {
      orderEmailNotSent(undefined, emailContext, 'no_recipient');
    } else {
      const sender = this.getTransactionalEmailSender?.();
      if (sender) {
        await sendOrderTransactionalEmail(em, sender, order, {
          orderId: order.id,
          code: 'admin_created_order',
          to: customer.email,
          messageId: `order_created_for_you:${order.id}`,
          variables: { order: { businessId: order.businessId, id: order.id } },
          meta: { orderId: order.id, kind: 'order_created_for_you' },
        });
      } else if (!this.mailer) {
        orderEmailNotSent(undefined, emailContext, 'no_transport');
      } else {
        try {
          const outcome = await this.mailer.send(
            buildAdminCreatedOrderEmail({ to: customer.email, businessId: order.businessId, orderId: order.id }),
          );
          if (outcome.status !== 'sent') {
            orderEmailNotSent(undefined, emailContext, outcome.status);
          }
        } catch (error) {
          // A switched-off module is not a delivery failure, so it travels on.
          rethrowIfModuleDisabled(error);
          orderEmailNotSent(undefined, emailContext, 'failed', error);
        }
      }
    }

    return order;
  }
}
