import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModulePlugin } from '../../http/server.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { OrderListService } from '../orders/services/order-list-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import { CustomerRegistrationService } from './services/customer-registration-service.js';
import { registerCustomersRegisterRoutes } from './routes.register.js';
import {
  registerCustomersSelfRoutes,
  type RequireCustomerGuard,
  type ResolveCustomerActor,
} from './routes.self.js';

/**
 * Customers module composition root (feature 040).
 *
 * Orchestrates the customer-lifecycle surfaces over the existing data
 * modules. Sibling services are injected from `composition.ts` so the module
 * never imports another module's internals (Constitution Principle I).
 */
export interface CustomersModuleOptions {
  emFactory: () => EntityManager;
  sessionService: SessionService;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerActor: ResolveCustomerActor;
  /** Reads `customers.allow_registration_without_organization`. */
  resolveAllowRegistrationWithoutOrganization: () => Promise<boolean>;
  /** Lazy — OrderListService is bound during the orders plugin registration. */
  getOrderListService: () => OrderListService;
  rfqService: RfqService;
}

export interface CustomersModuleHandle {
  registrationService: CustomerRegistrationService;
}

export function customersModule(options: CustomersModuleOptions): {
  plugin: ModulePlugin;
  handle: () => CustomersModuleHandle;
} {
  const customerAuthService = new CustomerAuthService(
    options.emFactory,
    options.sessionService,
  );
  const registrationService = new CustomerRegistrationService({
    emFactory: options.emFactory,
    sessionService: options.sessionService,
    resolveAllowRegistrationWithoutOrganization:
      options.resolveAllowRegistrationWithoutOrganization,
  });

  const plugin: ModulePlugin = async (app) => {
    await registerCustomersRegisterRoutes(app, { registrationService });
    await registerCustomersSelfRoutes(app, {
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerActor: options.resolveCustomerActor,
      customerAuthService,
      getOrderListService: options.getOrderListService,
      rfqService: options.rfqService,
    });
  };

  return { plugin, handle: () => ({ registrationService }) };
}
