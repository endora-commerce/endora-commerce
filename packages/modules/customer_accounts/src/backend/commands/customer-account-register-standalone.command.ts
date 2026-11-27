import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type CustomerAccountStandaloneCreateInput,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
// D-178 — the one co-transactional seam this module consumes; why it is imported
// from `organizations`' `ports` subpath rather than `@endora-commerce/contracts`
// is on the interface (its signature carries an `EntityManager`).
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { accountCreatedAuditState } from '../services/customer-account-audit-state.js';

export interface RegisterStandaloneDeps {
  readonly personalOrganizations: PersonalOrganizationProvisionApi;
}

/**
 * `customer_account.register_standalone` (`specs/186-aggregate-ports/` T050,
 * issue #1822) — an individual's self-registration: the account **and** its
 * personal Organization, in the Command's one transaction (D-178).
 *
 * It was `CustomerAccountLifecycleWriteService.createStandalone`, a hand-audited
 * transaction run in an EventBus scope (issue #1926) so the Organization's
 * channel binding dropped the access cache after the commit. The bus opens
 * that scope itself, so the binding keeps its order; the entry, its action and
 * its state are the ones the hand audit wrote. On the anonymous registration
 * route the request is in system scope, so the entry has no actor — as it had.
 *
 * The password is hashed by the caller before the Command (argon2 is slow by
 * design, and the transaction holds a connection); the id is generated here
 * because the Organization records it as its account link before the account
 * row exists. The e-mail is refused `409 EMAIL_ALREADY_REGISTERED` by the
 * pre-check and, for the race it cannot see, by the unique index.
 */
export function makeRegisterStandaloneCommand(
  deps: RegisterStandaloneDeps,
  input: Omit<CustomerAccountStandaloneCreateInput, 'password'> & { readonly passwordHash: string },
): Command<CustomerAccount> {
  const customerAccountId = randomUUID();
  return {
    action: 'customer_account.register_standalone',
    objectType: 'customer_account',
    objectId: customerAccountId,
    run: async ({ em }) => {
      // Folded, like every write and read of this column.
      const email = normalizeEmailAddress(input.email);
      if (await em.findOne(CustomerAccount, { email })) throw emailTaken();
      const organization = await deps.personalOrganizations.provisionFor(em, {
        customerAccountId,
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        // Feature 154 (owner decision D6) — the store the visitor registers on
        // becomes the personal organisation's channel; outside a request there
        // is none and the default applies.
        salesChannelId: currentSalesChannel()?.id ?? null,
      });
      const account = em.create(CustomerAccount, {
        id: customerAccountId,
        email,
        passwordHash: input.passwordHash,
        // Issue #222 — the visitor typed this password on the registration form.
        passwordSetAt: new Date(),
        firstName: input.firstName,
        lastName: input.lastName,
        organizationId: organization.id,
        // The individual administers their own personal Organization (owner
        // ruling PR-3, research R-34).
        organizationRoleId: organization.administratorRoleId,
        // Issue #652 (D-292) — the registering request's language.
        preferredLanguage: input.preferredLanguage ?? null,
      });
      try {
        await em.persist(account).flush();
      } catch (err) {
        // The unique index is the real arbiter; the pre-check only buys a
        // better message for the common case. The provisioning call stays
        // outside this `catch`: a `ModuleDisabledError` from it must reach the
        // caller as the 503 it is.
        if (err instanceof UniqueConstraintViolationException) throw emailTaken();
        throw err;
      }
      return { result: account, before: null, after: accountCreatedAuditState(account) };
    },
  };
}

function emailTaken(): HttpError {
  return new HttpError(409, ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists.');
}
