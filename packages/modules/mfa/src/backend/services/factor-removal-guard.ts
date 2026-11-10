import { ERROR_CODES } from '@endora-commerce/contracts';
import type { MfaDisableBlockedReason, MfaLoginContext, MfaSubjectRef } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { MfaPolicyResolver } from './mfa-policy-resolver.js';

export interface FactorRemovalVerdict {
  canDisable: boolean;
  disableBlockedReason: MfaDisableBlockedReason | null;
}

/** How many active second factors the subject holds — this module's own table. */
export type ActiveFactorCounter = (subject: MfaSubjectRef) => Promise<number>;

/**
 * Issue #935 — whether an account may remove its own second factor.
 *
 * Refused while it is the account's last one and a requirement is in force.
 * The requirement is read through {@link MfaPolicyResolver}, the reader the
 * sign-in decision uses, so every source counts here exactly as it counts
 * there and none is stricter: `mfa.admin.totp_enforced` and a role's
 * `requiresTwoFactor` for an administrator, `mfa.storefront.totp_enforced` at
 * the request's channel and the organization's policy for a customer. Without
 * `MFA_SECRET_ENCRYPTION_KEY` the resolver puts no requirement in force
 * (issues #930, #947, #948), so nothing is refused here either.
 *
 * Only the self-service removal is guarded. An administrator's reset of
 * somebody else's factor is the recovery path for a lost device, and the next
 * sign-in sends the account to setup.
 */
export class FactorRemovalGuard {
  constructor(
    private readonly policyResolver: Pick<MfaPolicyResolver, 'resolve'>,
    private readonly countActiveFactors: ActiveFactorCounter,
  ) {}

  async verdict(subject: MfaSubjectRef, ctx: MfaLoginContext): Promise<FactorRemovalVerdict> {
    // One factor left: removing it leaves none. None: there is nothing to remove.
    if ((await this.countActiveFactors(subject)) !== 1) return ALLOWED;
    const policy = await this.policyResolver.resolve(subject, ctx);
    return policy.totpEnforced ? BLOCKED : ALLOWED;
  }

  async assertMayRemove(subject: MfaSubjectRef, ctx: MfaLoginContext): Promise<void> {
    if ((await this.verdict(subject, ctx)).canDisable) return;
    throw new HttpError(
      409,
      ERROR_CODES.MFA_LAST_FACTOR_REQUIRED,
      'Two-step verification is required for this account, so its last second factor cannot be removed.',
    );
  }
}

const ALLOWED: FactorRemovalVerdict = { canDisable: true, disableBlockedReason: null };
const BLOCKED: FactorRemovalVerdict = { canDisable: false, disableBlockedReason: 'factor_required' };
