import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  CustomerPasswordStatePort,
  MfaSocialLinkSummary,
  MfaSocialProvider,
  MfaSubjectRef,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
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
 * holder has a credential they can actually use.
 *
 * Issue #194 could not ask that question and therefore refused the **last**
 * link of every account, absolutely. Issue #222 added the datum —
 * `customer_accounts.password_set_at`, read here over
 * {@link CustomerPasswordStatePort} — so the rule is now the narrower and
 * truthful one: refuse the last link **only** while the account has no password
 * on record. Where another link remains, or a password has been set, the
 * removal goes through. An active TOTP enrolment still does not unblock it: a
 * second factor is not a first one, and nobody signs in with TOTP alone.
 *
 * That is also what makes the sentence at the seam an instruction again. It
 * told the holder to set a password first, then said plainly that there was no
 * way out (!723), because with the rule counting links the instruction named a
 * step that lifted nothing. It lifts it now, so the wording went back — in the
 * thrown message and in `errors.MFA_SOCIAL_LAST_CREDENTIAL`, both languages.
 *
 * **The admin arm asks nobody.** An `AdminUser` cannot exist without a password
 * somebody supplied: `AdminUserService.create` takes a required one (as does
 * `createAdminUserRequestSchema`), and `SocialIdentityService.signInAdmin`
 * matches an existing admin and refuses when there is none — there is no
 * auto-create on that side to mint a random hash. So the answer is structurally
 * `true` and a second column would record a constant.
 * `test/unit/mfa/admin-password-is-structural.test.ts` is what keeps that
 * premise from rotting quietly.
 */
export class SocialLinkService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly commandBus: CommandBus,
    private readonly passwordState: CustomerPasswordStatePort,
  ) {}

  /** The links this subject holds, in link order, each with its unlink verdict. */
  async list(subject: MfaSubjectRef): Promise<MfaSocialLinkSummary[]> {
    const rows = await this.emFactory().find(
      MfaSocialIdentity,
      { subjectType: subject.subjectType, subjectId: subject.subjectId },
      { orderBy: { linkedAt: 'asc' } },
    );
    // Only the single-link case can be blocked, so only it asks — a status call
    // for an account with two links, or none, has nothing to look up.
    const blocked = rows.length === 1 && !(await this.#hasPasswordOnRecord(subject));
    return rows.map((row) => ({
      provider: row.provider as MfaSocialProvider,
      email: row.email,
      linkedAt: row.linkedAt.toISOString(),
      canUnlink: !blocked,
      unlinkBlockedReason: blocked ? ('last_credential' as const) : null,
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
        if (rows.length <= 1 && !(await this.#hasPasswordOnRecord(subject))) {
          throw new HttpError(
            409,
            ERROR_CODES.MFA_SOCIAL_LAST_CREDENTIAL,
            'This is the last sign-in identity linked to the account and it has no password on record: set a password for the account first, then it can be removed.',
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

  /**
   * Whether the subject has a password its holder can use.
   *
   * Deliberately not wrapped in a `catch`. `customer_accounts` declares itself
   * non-deactivatable, so the gate on its port cannot be reached today — but a
   * `catch` here would be the fail-open shape whatever the manifest says, and
   * the wrong answer to this question removes somebody's last way into their
   * account. A `ModuleDisabledError` must surface as 503, not as "no password
   * on record" and not as "has one".
   */
  async #hasPasswordOnRecord(subject: MfaSubjectRef): Promise<boolean> {
    // Structurally true — see the class doc block.
    if (subject.subjectType === 'admin') return true;
    return (await this.passwordState.passwordSetAt(subject.subjectId)) !== null;
  }
}
