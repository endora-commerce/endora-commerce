import type { CustomerAccountPreferencePort, CustomerAccountRecord } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { makeSetCustomerAccountPreferredLanguageCommand } from '../commands/customer-account-set-preferred-language.command.js';
import { toOneCustomerAccountRecord } from './customer-account-ports.js';
import type { TwoFactorEnrolmentReader } from './two-factor-enrolments.js';

/**
 * `customerAccountPreferencePort` (issue #652, D-292) — the account's
 * preferred language, written through `customer_account.set_preferred_language`.
 *
 * `setPreferredLanguage` is the owner's explicit choice and overwrites; the
 * caller (`customers`' self-service route) has already checked the tag against
 * the request channel and passes it in that channel's spelling.
 * `captureIfUnset` is a sign-in's capture and fills only an unknown value. See
 * the contract for the rest.
 */
export class CustomerAccountPreferenceService implements CustomerAccountPreferencePort {
  constructor(
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
    private readonly commandBus: CommandBus,
  ) {}

  async setPreferredLanguage(customerAccountId: string, preferredLanguage: string): Promise<CustomerAccountRecord> {
    const account = await this.commandBus.run(
      makeSetCustomerAccountPreferredLanguageCommand({ customerAccountId, preferredLanguage, source: 'self_service' }),
    );
    // `self_service` throws rather than answer `null` for a missing account.
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account!);
  }

  /**
   * System-scoped: a sign-in runs before a tenant context exists — identity
   * resolution precedes tenancy, as `customerOrgResolver` and the federated
   * account lookup are — so the entry is recorded with no actor, which is
   * what an automatic capture is.
   */
  async captureIfUnset(customerAccountId: string, preferredLanguage: string): Promise<void> {
    await withSystemScope('customer_accounts: capture the preferred language at sign-in', () =>
      this.commandBus.run(
        makeSetCustomerAccountPreferredLanguageCommand({ customerAccountId, preferredLanguage, source: 'sign_in' }),
      ),
    );
  }
}
