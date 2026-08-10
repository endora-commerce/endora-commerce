import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import type { SessionService } from '../../auth/services/session-service.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { PersonalOrganizationService } from '../../organizations/services/personal-organization-service.js';

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
  /** Reads `customers.allow_registration_without_organization` (the per-channel B2C gate). */
  resolveAllowRegistrationWithoutOrganization: () => Promise<boolean>;
  /** Feature 051 — provisions a single-member personal organization for a B2C customer. */
  personalOrganizationService: PersonalOrganizationService;
  /** Feature 054 — audits standalone registration co-transactionally when provided. */
  auditLog?: AuditLogService;
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
    if (this.deps.auditLog) {
      // Self-registration is pre-auth (no ambient actor) — records the account
      // creation with a null actor.
      recordAuditFromContext(this.deps.auditLog, em, {
        action: 'customer_account.register_standalone',
        objectType: 'customer_account',
        objectId: customer.id,
        stateBefore: null,
        stateAfter: { email: customer.email },
      });
    }
    await em.persistAndFlush(customer);

    // Feature 051 — a B2C customer is backed by a single-member personal
    // organization, so ordering/RFQ/credit/invoices work and the tenant guard
    // isolates each individual as their own tenant (no null-org path).
    await this.deps.personalOrganizationService.ensureFor(customer, em);

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
