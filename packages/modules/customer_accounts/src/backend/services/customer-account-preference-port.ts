import type {
  CustomerAccountCommandPort,
  CustomerAccountPreferencePort,
  CustomerAccountRecord,
} from '@endora-commerce/contracts';
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
 *
 * Since `specs/186-aggregate-ports/` (issue #1822, research R-17.4)
 * `setPreferredLanguage` is `customerAccountCommandPort.setPreferredLanguage`
 * with the code `self_service`: one write, and the entry records
 * `source: 'self_service'` as it always has. It is not deprecated — the buyer's
 * own page is a customer-facing route, which the aggregate port must never
 * serve — and `captureIfUnset` stays this port's alone.
 */
export class CustomerAccountPreferenceService implements CustomerAccountPreferencePort {
  constructor(
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
    private readonly commandBus: CommandBus,
    /** The aggregate port the owner's choice runs; a hand-built test service runs the Command itself. */
    private readonly commands?: Pick<CustomerAccountCommandPort, 'setPreferredLanguage'>,
  ) {}

  async setPreferredLanguage(customerAccountId: string, preferredLanguage: string): Promise<CustomerAccountRecord> {
    if (this.commands) {
      return this.commands.setPreferredLanguage(
        customerAccountId,
        { language: preferredLanguage },
        { source: 'self_service' },
      );
    }
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
