import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { MfaSocialIdentity } from '../entities/mfa-social-identity.entity.js';
import type { OAuthIdentity } from './oauth-provider-service.js';

/**
 * Resolves a federated identity to a platform account and records the link
 * (feature 042, R6). Account find/create is delegated to injected ports so the
 * `mfa` module never reaches into the customer/admin internals (Principle I):
 *   - Storefront: match by verified email, else auto-create a standalone
 *     customer (when registration-without-organization is allowed).
 *   - Admin: match an existing admin user only — never auto-create.
 */
export interface SocialIdentityDeps {
  resolveCustomerByEmail: (email: string) => Promise<{ id: string } | null>;
  /** Returns the new account id, or null when standalone registration is off. */
  autoCreateCustomer: (email: string) => Promise<{ id: string } | null>;
  resolveAdminByEmail: (email: string) => Promise<{ id: string } | null>;
}

export type SocialSignInResult =
  | { ok: true; subjectId: string }
  | { ok: false; reason: 'unverified' | 'registration_required' | 'no_account' };

export class SocialIdentityService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly deps: SocialIdentityDeps,
    private readonly auditLogService: AuditPort,
  ) {}

  async signInCustomer(identity: OAuthIdentity): Promise<SocialSignInResult> {
    if (!identity.emailVerified || !identity.email) return { ok: false, reason: 'unverified' };
    const existing = await this.deps.resolveCustomerByEmail(identity.email);
    let account = existing;
    let created = false;
    if (!account) {
      account = await this.deps.autoCreateCustomer(identity.email);
      if (!account) return { ok: false, reason: 'registration_required' };
      created = true;
    }
    await this.upsertLink('customer', account.id, identity);
    await this.auditLogService.record({
      action: created ? 'mfa.social_account_created' : 'mfa.social_linked',
      objectType: 'customer_account',
      objectId: account.id,
    });
    return { ok: true, subjectId: account.id };
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
    return { ok: true, subjectId: account.id };
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
