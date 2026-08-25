import {
  ERROR_CODES,
  type AuthSessionPort,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';

/**
 * CustomerRegistrationService — standalone (org-less) sign-up (feature 040,
 * US1 / FR-002/FR-004).
 *
 * Gated by the `customers.allow_registration_without_organization` setting:
 * when disabled, registration is refused with a clear, actionable error so
 * the storefront can steer the visitor toward Organization registration.
 *
 * On success the new account and the individual's single-member personal
 * organization are written in one transaction by `customer_accounts` (D-178),
 * and an auto-login session is minted (parity with the Organization
 * registration flow, which also logs the first user straight in).
 *
 * **Feature 075, Phase C — this service writes no table.** It used to create
 * `customer_accounts`' entity itself, hash the password with `auth`'s hasher,
 * and hand its own `EntityManager` to `organizations`' provisioner. All three
 * are owner-side now: the account and its audit row come from
 * `customerAccountLifecycleWritePort`, the hashing goes with them (a caller
 * that hashes is a caller that has to be told which algorithm the owner uses),
 * and the organisation is provisioned inside that same write (D-178). What is left
 * here is the policy — whether a registration outside a company organization is
 * allowed at all — which is this module's setting.
 */
export interface CustomerRegistrationDeps {
  /** `customer_accounts`' account lifecycle. Creates the row and audits it. */
  accounts: CustomerAccountLifecycleWritePort;
  /**
   * `auth`'s published session port (D-98.2), not the `SessionService` class
   * this used to import: the only method reached here is `createSession`, the
   * port declares it, and `authSessionPort` is the name the contract
   * publishes.
   */
  sessionService: AuthSessionPort;
  /** Reads `customers.allow_registration_without_organization` (the per-channel B2C gate). */
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
  customerAccount: CustomerAccountRecord;
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

    // The duplicate-address refusal is inside the write, so a registration
    // racing its own pre-check still answers 409 rather than a 500 off the
    // unique index.
    //
    // D-178 — the personal organization feature 051 requires is provisioned
    // inside that call, in the same transaction as the account, so the record
    // that comes back already carries it. This service used to call
    // `personalOrganizationPort.ensureForCustomerAccount` on the next line, and
    // that second unit of work is exactly what left a committed account with no
    // organization whenever it failed: the visitor had no session to retry from
    // and nothing anywhere re-ran the provisioning.
    const customerAccount = await this.deps.accounts.createStandalone({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
    });

    const session = await this.deps.sessionService.createSession({
      kind: 'customer',
      customerAccountId: customerAccount.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    return {
      customerAccount,
      sessionCookieValue: session.cookieValue,
      sessionExpiresAt: session.expiresAt,
    };
  }
}
