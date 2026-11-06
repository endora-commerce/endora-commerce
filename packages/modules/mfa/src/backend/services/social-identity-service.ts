import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { MfaSocialIdentity } from '../entities/mfa-social-identity.entity.js';
import type { OAuthIdentity } from './oauth-provider-service.js';
import type { CustomerChannelAccess } from './customer-channel-access.js';

/**
 * Resolves a federated identity to a platform account and records the link
 * (feature 042, R6). Account find/create is delegated to injected ports so the
 * `mfa` module never reaches into the customer/admin internals (Principle I):
 *   - Storefront: match by verified email, else auto-create a standalone
 *     customer (when registration-without-organization is allowed) for the
 *     sales channel the sign-in was started on — and only where that channel
 *     is open to anonymous visitors (feature 154, owner decision D6). A matched
 *     account that is **blocked** is refused, as the password sign-in refuses
 *     it — before a link is written or anything is audited.
 *   - Admin: match an existing, active admin user only — never auto-create.
 *
 * Admin accounts are matched by the provider's verified e-mail, not by an
 * existing `(provider, sub)` link: there is no flow in which an administrator
 * links a provider identity deliberately, so requiring a prior link would leave
 * admin federated sign-in with no way to begin (spec FR-022). What keeps the
 * match from being the whole decision is what happens after it — the route
 * hands every subject to the same second-factor decision the password sign-in
 * takes.
 *
 * A successful answer carries the account's organisation (`null` for an
 * administrator, or a customer with none), because the second-factor policy an
 * organisation enforces is resolved from it.
 */
export interface SocialAccountMatch {
  id: string;
  /** The account's organisation, when the resolver knows it. */
  organizationId?: string | null;
  /** `true` for a customer account an operator has blocked. */
  blocked?: boolean;
}

export interface SocialIdentityDeps {
  resolveCustomerByEmail: (email: string) => Promise<SocialAccountMatch | null>;
  /**
   * Returns the new account id, or null when the channel does not allow
   * registration (`customers.allow_registration_without_organization` off for it):
   * the only refusal it has, which `signInCustomer` answers as
   * `registration_disabled_in_channel` (issue #789).
   * The new personal Organization gets exactly `salesChannelId` — the channel
   * the sign-in was started on (feature 154, D6).
   */
  autoCreateCustomer: (
    email: string,
    context: { salesChannelId: string },
  ) => Promise<SocialAccountMatch | null>;
  resolveAdminByEmail: (email: string) => Promise<{ id: string } | null>;
}

export type SocialSignInResult =
  | { ok: true; subjectId: string; organizationId: string | null }
  | {
      ok: false;
      reason:
        | 'unverified'
        | 'registration_disabled_in_channel'
        | 'no_account'
        | 'blocked'
        | 'sales_channel_sign_in_required';
    };

/** Where a customer's federated sign-in was started: the OAuth transaction's channel. */
export interface CustomerSignInContext {
  salesChannelId: string | null;
}

export class SocialIdentityService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly deps: SocialIdentityDeps,
    private readonly auditLogService: AuditPort,
    /** Feature 154 — whether the started-on channel admits a new account at all. */
    private readonly newAccountAdmission: Pick<CustomerChannelAccess, 'admitsNewAccount'>,
  ) {}

  async signInCustomer(
    identity: OAuthIdentity,
    context: CustomerSignInContext,
  ): Promise<SocialSignInResult> {
    if (!identity.emailVerified || !identity.email) return { ok: false, reason: 'unverified' };
    const existing = await this.deps.resolveCustomerByEmail(identity.email);
    if (existing?.blocked) return { ok: false, reason: 'blocked' };
    let account = existing;
    let created = false;
    if (!account) {
      // Feature 154 (D6) — a new account is created for the channel the
      // sign-in was started on, and only where that channel is open to
      // anonymous visitors: on a closed store individual self-registration is
      // refused, and a provider sign-in is not a second way to it. Asked before
      // anything is written, so a refusal leaves no account, no Organization and
      // no link behind. An existing account is not asked: whether it may use
      // the store is the assignment rule's answer, which the callback asks next.
      const salesChannelId = context.salesChannelId;
      if (
        salesChannelId === null ||
        !(await this.newAccountAdmission.admitsNewAccount(salesChannelId))
      ) {
        return { ok: false, reason: 'sales_channel_sign_in_required' };
      }
      account = await this.deps.autoCreateCustomer(identity.email, { salesChannelId });
      if (!account) return { ok: false, reason: 'registration_disabled_in_channel' };
      created = true;
    }
    await this.upsertLink('customer', account.id, identity);
    await this.auditLogService.record({
      action: created ? 'mfa.social_account_created' : 'mfa.social_linked',
      objectType: 'customer_account',
      objectId: account.id,
    });
    return { ok: true, subjectId: account.id, organizationId: account.organizationId ?? null };
  }

  async signInAdmin(identity: OAuthIdentity): Promise<SocialSignInResult> {
    if (!identity.emailVerified || !identity.email) return { ok: false, reason: 'unverified' };
    const account = await this.deps.resolveAdminByEmail(identity.email);
    if (!account) return { ok: false, reason: 'no_account' };
    await this.upsertLink('admin', account.id, identity);
    await this.auditLogService.record({
      action: 'mfa.social_linked',
      objectType: 'admin_user',
      objectId: account.id,
    });
    return { ok: true, subjectId: account.id, organizationId: null };
  }

  private async upsertLink(
    subjectType: 'customer' | 'admin',
    subjectId: string,
    identity: OAuthIdentity,
  ): Promise<void> {
    const em = this.emFactory();
    let link = await em.findOne(MfaSocialIdentity, {
      provider: identity.provider,
      providerSubject: identity.sub,
    });
    if (!link) {
      link = em.create(MfaSocialIdentity, {
        subjectType,
        subjectId,
        provider: identity.provider,
        providerSubject: identity.sub,
        email: identity.email,
        lastUsedAt: new Date(),
      });
      em.persist(link);
    } else {
      link.email = identity.email;
      link.lastUsedAt = new Date();
    }
    await em.flush();
  }
}
