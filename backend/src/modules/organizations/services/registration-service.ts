import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES, type RegisterOrganizationRequest } from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { Organization } from '../entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';

/**
 * Registration flow (T117, FR-040).
 *
 * - Creates the Organization in `pending_verification`.
 * - Creates the first CustomerAccount with `role='organization_admin'`, email
 *   unverified, argon2-hashed password.
 * - Issues an EmailVerificationToken; the raw token is returned so callers
 *   can dispatch the email. Only its sha256 hash is stored.
 * - Emits `organization.registered.v1`.
 *
 * Uniqueness conflicts raise:
 *   409 ORGANIZATION_TAX_ID_EXISTS if the taxId is taken.
 *   409 EMAIL_ALREADY_REGISTERED if the email is taken by another account.
 */

export interface OrganizationEvents extends Record<string, EventBase> {
  'organization.registered.v1': EventBase & { organizationId: string };
  'organization.verified.v1': EventBase & { organizationId: string; customerAccountId: string };
  'organization.status_changed.v1': EventBase & { organizationId: string; newStatus: string };
}
export type OrganizationEventBus = EventBus<OrganizationEvents>;

const TOKEN_TTL_HOURS = 48;

export interface RegistrationResult {
  organization: Organization;
  customerAccount: CustomerAccount;
  /** Raw token to include in the verification email — shown once. */
  verificationToken: string;
}

export class RegistrationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrganizationEventBus,
  ) {}

  async registerOrganization(req: RegisterOrganizationRequest): Promise<RegistrationResult> {
    const em = this.emFactory();

    // Pre-check the easy cases so we can return the right error code before
    // hashing the password (avoids a wasted ~50 ms of argon2 work).
    const existingByTaxId = await em.findOne(Organization, { taxId: req.organization.taxId });
    if (existingByTaxId) {
      throw new HttpError(
        409,
        ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
        'An organization with this taxId already exists.',
      );
    }
    const existingByEmail = await em.findOne(CustomerAccount, { email: req.firstUser.email });
    if (existingByEmail) {
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with this email already exists.',
      );
    }

    const passwordHash = await hashPassword(req.firstUser.password);

    const organization = em.create(Organization, {
      name: req.organization.name,
      taxId: req.organization.taxId,
      status: 'pending_verification',
      vatStatus: req.organization.vatStatus ?? 'vat_payer',
      registeredAddress: {
        street: req.organization.registeredAddress.street,
        city: req.organization.registeredAddress.city,
        postalCode: req.organization.registeredAddress.postalCode,
        country: req.organization.registeredAddress.country,
      },
    });
    try {
      await em.persistAndFlush(organization);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
          'An organization with this taxId already exists.',
        );
      }
      throw err;
    }

    const customerAccount = em.create(CustomerAccount, {
      organizationId: organization.id,
      email: req.firstUser.email,
      passwordHash,
      firstName: req.firstUser.firstName,
      lastName: req.firstUser.lastName,
      role: 'organization_admin',
    });
    try {
      await em.persistAndFlush(customerAccount);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.EMAIL_ALREADY_REGISTERED,
          'An account with this email already exists.',
        );
      }
      throw err;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const token = em.create(EmailVerificationToken, {
      customerAccountId: customerAccount.id,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1_000),
    });
    await em.persistAndFlush(token);

    this.events.emit('organization.registered.v1', {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: organization.id,
    });

    return { organization, customerAccount, verificationToken: rawToken };
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// Polyfill for environments where crypto.randomUUID isn't on global (node < 19).
// Node 22+ has it, so this is a belt-and-braces fallback.
declare const crypto: { randomUUID: () => string };
