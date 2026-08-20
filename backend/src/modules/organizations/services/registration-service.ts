import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type DictionaryValidator,
  type RegisterOrganizationRequest,
} from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Organization } from '../entities/organization.entity.js';
import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

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
  /**
   * A CustomerAccount belonging to an Organization was created (self-service
   * registration, admin direct-create, or invitation accept). Consumed by the
   * shopping_lists module to provision the customer's default list eagerly.
   */
  'customer_account.created.v1': EventBase & {
    customerAccountId: string;
    organizationId: string;
  };
}
export type OrganizationEventBus = EventBus<OrganizationEvents>;

/**
 * Emit `customer_account.created.v1` for a newly-created org-attached customer.
 * Shared by every creation chokepoint so provisioning side effects (e.g. the
 * default shopping list) happen consistently regardless of entry path.
 */
export function emitCustomerAccountCreated(
  events: OrganizationEventBus,
  customerAccountId: string,
  organizationId: string,
): void {
  events.emit('customer_account.created.v1', {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    customerAccountId,
    organizationId,
  });
}

const TOKEN_TTL_HOURS = 48;

export interface RegistrationResult {
  organization: Organization;
  customerAccount: CustomerAccountRecord;
  /** Raw token to include in the verification email — shown once. */
  verificationToken: string;
}

export interface RegistrationAccountPorts {
  /**
   * `customer_accounts`' published read and write (feature 075, Phase C). The
   * first user of a new Organization is a row in *that* module's table, and
   * this service used to create it with `em.create(CustomerAccount, …)` and a
   * `hashPassword` imported from `auth`. Both are on the owner's side of the
   * port now, which is also why the plain password crosses and no hash does.
   *
   * With `customer_accounts` off registration fails closed. That is right: an
   * Organization whose administrator could not be created is not a
   * registration, and the module is in any case non-deactivatable.
   */
  read: CustomerAccountReadPort;
  write: CustomerAccountMemberWritePort;
}

export class RegistrationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrganizationEventBus,
    private readonly accounts: RegistrationAccountPorts,
    private readonly dictionaryValidator?: DictionaryValidator,
    private readonly auditLog?: AuditLogService,
  ) {}

  async registerOrganization(req: RegisterOrganizationRequest): Promise<RegistrationResult> {
    const em = this.emFactory();
    await this.validateCountry(req.organization.registeredAddress.country);

    // Pre-check the easy cases so we can return the right error code before
    // hashing the password (avoids a wasted ~50 ms of argon2 work — the hash
    // is computed inside `create` below, after both checks have passed).
    const existingByTaxId = await em.findOne(Organization, { taxId: req.organization.taxId });
    if (existingByTaxId) {
      throw new HttpError(
        409,
        ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
        'An organization with this taxId already exists.',
      );
    }
    const existingByEmail = await this.accounts.read.findByEmail(req.firstUser.email);
    if (existingByEmail) {
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with this email already exists.',
      );
    }

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

    // `create` raises the same 409 `EMAIL_ALREADY_REGISTERED` on the unique
    // index that the `catch` here used to, so the translation moved with the
    // write rather than being dropped.
    const customerAccount = await this.accounts.write.create({
      organizationId: organization.id,
      email: req.firstUser.email,
      password: req.firstUser.password,
      firstName: req.firstUser.firstName,
      lastName: req.firstUser.lastName,
      role: 'organization_admin',
    });

    const rawToken = randomBytes(32).toString('base64url');
    const token = em.create(EmailVerificationToken, {
      customerAccountId: customerAccount.id,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1_000),
    });
    if (this.auditLog) {
      // Self-registration is pre-auth (no ambient actor) — the entry records the
      // organization creation with a null actor.
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.register',
        objectType: 'organization',
        objectId: organization.id,
        stateBefore: null,
        stateAfter: { name: organization.name, taxId: organization.taxId, status: organization.status },
      });
    }
    await em.persistAndFlush(token);

    this.events.emit('organization.registered.v1', {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: organization.id,
    });
    emitCustomerAccountCreated(this.events, customerAccount.id, organization.id);

    return { organization, customerAccount, verificationToken: rawToken };
  }

  private async validateCountry(country: string): Promise<void> {
    if (!this.dictionaryValidator) return;
    try {
      await this.dictionaryValidator.validateCountryCode(country, 'create-or-change');
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw new HttpError(
          409,
          err.code,
          err.code === 'DICTIONARY_ENTRY_INACTIVE'
            ? `Country code ${err.entryCode} is no longer available for organization registration.`
            : `Country code ${err.entryCode} is not recognised.`,
          [{ path: 'organization.registeredAddress.country', issue: err.code }],
        );
      }
      throw err;
    }
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// Polyfill for environments where crypto.randomUUID isn't on global (node < 19).
// Node 22+ has it, so this is a belt-and-braces fallback.
declare const crypto: { randomUUID: () => string };
