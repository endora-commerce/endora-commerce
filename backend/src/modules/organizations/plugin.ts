import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { SessionService } from '../auth/services/session-service.js';
import {
  RegistrationService,
  type OrganizationEventBus,
} from './services/registration-service.js';
import { EmailVerificationService } from './services/email-verification-service.js';
import { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import { AddressService } from '../addresses/services/address-service.js';
import { registerOrganizationsPublicRoutes } from './routes.public.js';
import { registerOrganizationsCustomerRoutes } from './routes.customer.js';

/**
 * Composition root for the organizations + customer_accounts + addresses
 * module family. One plugin registers all three because their routes share
 * the same auth flow and serializers.
 */

export interface OrganizationsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  sessionService: SessionService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Expose the /api/v1/_test/latest-verification-token probe (test-only). */
  exposeTestProbe?: boolean;
}

export function organizationsModule(options: OrganizationsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const latestTokenByEmail = new Map<string, string>();
    const registrationService = new RegistrationService(
      options.emFactory,
      options.eventBus as OrganizationEventBus,
    );
    const verificationService = new EmailVerificationService(
      options.emFactory,
      options.eventBus as OrganizationEventBus,
    );
    const customerAuthService = new CustomerAuthService(
      options.emFactory,
      options.sessionService,
    );
    const addressService = new AddressService(options.emFactory);

    await registerOrganizationsPublicRoutes(app, {
      registrationService,
      verificationService,
      customerAuthService,
      exposeTestProbe: options.exposeTestProbe ?? false,
      latestTokenByEmail,
    });
    await registerOrganizationsCustomerRoutes(app, {
      customerAuthService,
      addressService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
  };
}
