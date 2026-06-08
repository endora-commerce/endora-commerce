import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { MFA_SETTING_CODES } from '@b2b/contracts';
import type {
  MfaLoginContext,
  MfaSubjectRef,
} from '../../auth/services/mfa-login-port.js';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';

/**
 * Resolves the effective MFA policy for a subject (feature 042, R5).
 *
 * Reuses the Settings engine's most-specific-wins resolution: storefront
 * settings read at the subject's sales channel (per-channel value → global →
 * default); admin settings are global ('default'). Organization enforcement is
 * additive. The invariant `enforced ⇒ enabled` (FR-016) is applied here.
 *
 * Every settings read is defensive: if a setting is not yet registered (e.g. a
 * narrow test that skips manifest seeding) the resolver treats it as `false`,
 * so login degrades safely to password-only rather than erroring.
 */
export interface MfaResolvedPolicy {
  totpEnabled: boolean;
  totpEnforced: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
}

/** The slice of SettingsService the resolver needs (port — not the class). */
export interface SettingsReader {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

const GLOBAL_CHANNEL = 'default';

export class MfaPolicyResolver {
  constructor(
    private readonly settings: SettingsReader,
    private readonly emFactory: () => EntityManager,
  ) {}

  async resolve(
    subject: MfaSubjectRef,
    ctx: MfaLoginContext,
  ): Promise<MfaResolvedPolicy> {
    const isAdmin = subject.subjectType === 'admin';
    const channelId = isAdmin ? GLOBAL_CHANNEL : ctx.salesChannelId ?? GLOBAL_CHANNEL;

    const codes = isAdmin
      ? {
          enabled: MFA_SETTING_CODES.ADMIN_TOTP_ENABLED,
          enforced: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
          google: MFA_SETTING_CODES.ADMIN_GOOGLE_ENABLED,
          microsoft: MFA_SETTING_CODES.ADMIN_MICROSOFT_ENABLED,
        }
      : {
          enabled: MFA_SETTING_CODES.STOREFRONT_TOTP_ENABLED,
          enforced: MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED,
          google: MFA_SETTING_CODES.STOREFRONT_GOOGLE_ENABLED,
          microsoft: MFA_SETTING_CODES.STOREFRONT_MICROSOFT_ENABLED,
        };

    const [totpEnabledRaw, totpEnforcedRaw, googleEnabled, microsoftEnabled] =
      await Promise.all([
        this.readBool(codes.enabled, channelId),
        this.readBool(codes.enforced, channelId),
        this.readBool(codes.google, channelId),
        this.readBool(codes.microsoft, channelId),
      ]);

    // Organization enforcement is additive (customers only).
    let orgEnforced = false;
    if (!isAdmin && ctx.organizationId) {
      orgEnforced = await this.readOrgEnforcement(ctx.organizationId);
    }

    const totpEnforced = totpEnforcedRaw || orgEnforced;
    // Invariant FR-016: enforcement implies enablement.
    const totpEnabled = totpEnabledRaw || totpEnforced;

    return { totpEnabled, totpEnforced, googleEnabled, microsoftEnabled };
  }

  private async readBool(code: string, channelId: string): Promise<boolean> {
    try {
      return await this.settings.get(code, channelId, z.boolean());
    } catch {
      return false;
    }
  }

  private async readOrgEnforcement(organizationId: string): Promise<boolean> {
    try {
      const em = this.emFactory();
      const policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
      return policy?.enforceTotp ?? false;
    } catch {
      return false;
    }
  }
}
