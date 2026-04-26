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
import { InvitationService } from './services/invitation-service.js';
import { RoleService } from '../customer_accounts/services/role-service.js';
import { PasswordResetService } from '../customer_accounts/services/password-reset-service.js';
import { TotpEnrolmentService } from '../customer_accounts/services/totp-enrolment-service.js';
import { ConsoleMailer, type Mailer } from '../email/services/mailer.js';
import { registerOrganizationsPublicRoutes } from './routes.public.js';
import { registerOrganizationsCustomerRoutes } from './routes.customer.js';
import { registerMembersRoutes } from './routes.members.js';
import { registerOrganizationsAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

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
  /** Optional post-login hook — the commerce module uses this to merge carts. */
  onLogin?: (ctx: {
    customerAccountId: string;
    organizationId: string;
    anonymousCartToken?: string;
  }) => Promise<void>;
  /** Admin gate for /admin/organizations routes. */
  requireAdmin?: RequireAdminFactory;
  /** Mailer used to dispatch invitation emails. Defaults to ConsoleMailer. */
  mailer?: Mailer;
  /** Storefront base URL for the invitation accept link. */
  storefrontBaseUrl?: string;
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
    const invitationService = new InvitationService(
      options.emFactory,
      options.mailer ?? new ConsoleMailer(),
      options.storefrontBaseUrl ? { acceptBaseUrl: options.storefrontBaseUrl } : {},
    );
    const roleService = new RoleService(options.emFactory);
    const passwordResetService = new PasswordResetService(options.emFactory);
    const totpEnrolmentService = new TotpEnrolmentService(options.emFactory);
    const latestInvitationToken: { value: string | null } = { value: null };

    await registerOrganizationsPublicRoutes(app, {
      registrationService,
      verificationService,
      customerAuthService,
      passwordResetService,
      exposeTestProbe: options.exposeTestProbe ?? false,
      latestTokenByEmail,
      ...(options.onLogin ? { onLogin: options.onLogin } : {}),
    });
    await registerOrganizationsCustomerRoutes(app, {
      customerAuthService,
      addressService,
      totpEnrolmentService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      emFactory: options.emFactory,
    });
    await registerMembersRoutes(app, {
      invitationService,
      roleService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      exposeTestProbe: options.exposeTestProbe ?? false,
      latestInvitationToken,
      emFactory: options.emFactory,
    });
    if (options.requireAdmin) {
      await registerOrganizationsAdminRoutes(app, {
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
      });
    }
  };
}
