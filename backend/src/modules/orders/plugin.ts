import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { CartService } from '../carts/services/cart-service.js';
import {
  OrderService,
  type CreditLimitPort,
  type OrderEventBus,
} from './services/order-service.js';
import { registerCartRoutes } from '../carts/routes.js';
import { registerOrderRoutes } from './routes.js';
import { registerDeliveryMethodsPublicRoutes } from '../delivery_methods/routes.js';
import { registerPaymentMethodsPublicRoutes } from '../payment_methods/routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Composition root for the commerce surface — carts + orders + invoice
 * download. CartService is also returned so the organizations module's login
 * flow can merge anonymous baskets.
 */

export interface OrdersModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /** Audit-log writer; OrderService stamps order.place_on_behalf rows on impersonated checkouts. */
  auditLogService?: AuditLogService;
  /** Optional CreditLimit driver — wired by the credit_limits module composition root. */
  creditLimit?: CreditLimitPort;
  /**
   * Resolver for cart actor (customer OR anonymous). The test helper maps
   * stub cookies + real sessions here; production wires it to the real auth
   * plugin.
   */
  resolveCartActor: (req: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string };
    anonymousToken?: string;
  };
  /** Hook — returned cart service so the login route can merge anonymous baskets. */
  exposeCartService?: (service: CartService) => void;
}

export function commerceModule(options: OrdersModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const cartService = new CartService(options.emFactory);
    const orderService = new OrderService(
      options.emFactory,
      options.eventBus as OrderEventBus,
      options.auditLogService,
      options.creditLimit,
    );
    if (options.exposeCartService) options.exposeCartService(cartService);

    await registerCartRoutes(app, {
      cartService,
      resolveCartActor: options.resolveCartActor,
      emFactory: options.emFactory,
    });
    await registerOrderRoutes(app, {
      orderService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      requireAdmin: options.requireAdmin,
      resolveCustomerContext: options.resolveCustomerContext,
    });
    await registerDeliveryMethodsPublicRoutes(app, { emFactory: options.emFactory });
    await registerPaymentMethodsPublicRoutes(app, { emFactory: options.emFactory });
  };
}
