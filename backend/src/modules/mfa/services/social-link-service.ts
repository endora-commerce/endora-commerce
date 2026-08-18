import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  MfaSocialLinkSummary,
  MfaSocialProvider,
  MfaSubjectRef,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { Command, CommandBus } from '../../../commands/index.js';
import { MfaSocialIdentity } from '../entities/mfa-social-identity.entity.js';

/**
 * The account-holder's view of their federated identities, and the one write
 * that removes one (issue #194).
 *
 * Separate from {@link SocialIdentityService}, which resolves an incoming
 * provider identity to an account at sign-in and therefore needs the account
 * resolvers and a configured provider. This surface needs neither: the links a
 * subject already holds stay visible and severable after an operator switches a
 * provider off, which is exactly when somebody wants to look at them.
 *
 * ## Why an unlink can be refused
 *
 * A customer auto-created by a federated sign-in is given a random password at
 * signup (`customer_accounts/backend.ts`) — one nobody was ever told. So
 * `password_hash is not null` is true for such an account and answers a
 * different question from the one that matters here, which is whether the
 * holder has a credential they can actually use. **Nothing in the tree records
 * that**: there is no `passwordSetAt`, no `mustChangePassword`, no flag on the
 * account saying a password was ever chosen.
 *
 * Rather than guess, this refuses to remove the **last** link of any account
 * and names the reason (`last_credential`). Where another link remains, the
 * removal goes through. An active TOTP enrolment deliberately does not unblock
 * it: a second factor is not a first one, and nobody signs in with TOTP alone.
 *
 * **The refusal is currently absolute, and every sentence about it says so.**
 * The first draft told the holder to set a password first — but the rule counts
 * links, so setting one lifts nothing; there is no datum for it to read. An
 * instruction with no effect is worse on a security surface than a plain "no",
 * so both the thrown message and the `errors.MFA_SOCIAL_LAST_CREDENTIAL`
 * sentence state that the link cannot be removed and why. The way out is a
 * `passwordSetAt` (or equivalent) on the account: when that lands, this rule
 * and those sentences change in the same commit.
 */
export class SocialLinkService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly commandBus: CommandBus,
  ) {}

  /** The links this subject holds, in link order, each with its unlink verdict. */
  async list(subject: MfaSubjectRef): Promise<MfaSocialLinkSummary[]> {
    const rows = await this.emFactory().find(
      MfaSocialIdentity,
      { subjectType: subject.subjectType, subjectId: subject.subjectId },
      { orderBy: { linkedAt: 'asc' } },
    );
    const isLast = rows.length <= 1;
    return rows.map((row) => ({
      provider: row.provider as MfaSocialProvider,
      email: row.email,
      linkedAt: row.linkedAt.toISOString(),
      canUnlink: !isLast,
      unlinkBlockedReason: isLast ? ('last_credential' as const) : null,
    }));
  }

  /**
   * Remove one provider link from this subject.
   *
   * Runs through the Command Bus (Constitution XIII): a security-relevant
   * account change is audited co-transactionally, so a rollback takes the audit
   * row with it.
   */
  async unlink(subject: MfaSubjectRef, provider: MfaSocialProvider): Promise<void> {
    await this.commandBus.run(this.#unlinkCommand(subject, provider));
  }

  #unlinkCommand(subject: MfaSubjectRef, provider: MfaSocialProvider): Command<void> {
    return {
      action: 'mfa.social_unlink',
      objectType: subject.subjectType === 'admin' ? 'admin_user' : 'customer_account',
      objectId: subject.subjectId,
      run: async ({ em }) => {
        const where = { subjectType: subject.subjectType, subjectId: subject.subjectId };
        const rows = await em.find(MfaSocialIdentity, where);
        const target = rows.find((row) => row.provider === provider);
        if (!target) {
          throw new HttpError(
            404,
            ERROR_CODES.NOT_FOUND,
            `No ${provider} identity is linked to this account.`,
          );
        }
        if (rows.length <= 1) {
          throw new HttpError(
            409,
            ERROR_CODES.MFA_SOCIAL_LAST_CREDENTIAL,
            'This is the last sign-in identity linked to the account and cannot be removed: the platform cannot confirm the account has another way in.',
          );
        }
        const before = {
          provider: target.provider,
          email: target.email,
          linkedAt: target.linkedAt.toISOString(),
        };
        em.remove(target);
        return { result: undefined, before, after: null };
      },
    };
  }
}
