import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import type { SessionService } from '../../auth/services/session-service.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';

/**
 * CustomerRegistrationService — standalone (org-less) sign-up (feature 040,
 * US1 / FR-002/FR-004).
 *
 * Gated by the `customers.allow_registration_without_organization` setting:
 * when disabled, registration is refused with a clear, actionable error so
 * the storefront can steer the visitor toward Organization registration.
 *
 * On success the new account is created with `organizationId = null` and an
 * auto-login session is minted (parity with the Organization registration
 * flow which also logs the first user straight in).
 */
export interface CustomerRegistrationDeps {
  emFactory: () => EntityManager;
  sessionService: SessionService;
  /** Reads `customers.allow_registration_without_organization`. */
  resolveAllowRegistrationWithoutOrganization: () => Promise<boolean>;
}

export interface RegisterStandaloneInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  ip?: string;
  userAgent?: string;
}

export interface RegisterStandaloneResult {
  customerAccount: CustomerAccount;
  sessionCookieValue: string;
  sessionExpiresAt: Date;
}

export class CustomerRegistrationService {
  constructor(private readonly deps: CustomerRegistrationDeps) {}

  async registerStandalone(
    input: RegisterStandaloneInput,
  ): Promise<RegisterStandaloneResult> {
    const allowed =
      await this.deps.resolveAllowRegistrationWithoutOrganization();
    if (!allowed) {
      throw new HttpError(
        403,
        ERROR_CODES.REGISTRATION_REQUIRES_ORGANIZATION,
        'Registration without an Organization is currently disabled. Please register your Organization instead.',
      );
    }

    const em = this.deps.emFactory();
    const existing = await em.findOne(CustomerAccount, { email: input.email });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with this email already exists.',
      );
    }

    const passwordHash = await hashPassword(input.password);
    const customer = em.create(CustomerAccount, {
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      organizationId: null,
    });
    await em.persistAndFlush(customer);

    const session = await this.deps.sessionService.createSession({
      kind: 'customer',
      customerAccountId: customer.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    return {
      customerAccount: customer,
      sessionCookieValue: session.cookieValue,
      sessionExpiresAt: session.expiresAt,
    };
  }
}
