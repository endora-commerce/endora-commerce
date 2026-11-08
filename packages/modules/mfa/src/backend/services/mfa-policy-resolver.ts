import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { MFA_SETTING_CODES } from '@endora-commerce/contracts';
import type {
  AdminRoleResolution,
  MfaLoginContext,
  MfaSubjectRef,
} from '@endora-commerce/contracts';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';

/**
 * Resolves the effective MFA policy for a subject (feature 042, R5).
 *
 * Reuses the Settings engine's most-specific-wins resolution: storefront
 * settings read at the subject's sales channel (per-channel value → global →
 * default); admin settings are read platform-wide, which since feature 072
 * (D-41) has a spelling of its own — `null`. Organization enforcement is
 * additive for customers. Role enforcement is additive for administrators
 * (issue #349): a role whose `requiresTwoFactor` is set requires TOTP of its
 * holder exactly as `mfa.admin.totp_enforced` requires it of every
 * administrator. The invariant `enforced ⇒ enabled` (FR-016) is applied here.
 *
 * Every settings read is defensive: if a setting is not yet registered (e.g. a
 * narrow test that skips manifest seeding) the resolver treats it as `false`,
 * so login degrades safely to password-only rather than erroring.
 *
 * **The role read is not, and fails closed.** A role that cannot be read — the
 * read throws, or answers a refusal — counts as requiring a second factor.
 * This code runs only while `mfa` is present, so the worst case is an
 * administrator asked to enrol a factor this module can enrol; an
 * administrator with no role is refused everywhere anyway
 * (`ADMIN_ROLE_REQUIRED`).
 *
 * **No administrator requirement is in force where no factor can be enrolled**
 * (issue #930 for `mfa.admin.totp_enforced`; issue #948, owner ruling Q6 of
 * 2026-11-08, for a role's flag). Without `MFA_SECRET_ENCRYPTION_KEY` this
 * module serves no enrolment route, so enforcing either would send every
 * administrator it binds without a factor to a setup step nothing can complete
 * — for the setting, the whole Admin UI locked out. Both writes refuse to turn
 * the requirement on in that state, every boot reports it at error level while
 * it is set, and the Settings and Roles screens say it is not in force, so
 * this branch is reached only by a value set before the key went. Storefront
 * and organization enforcement are untouched here; `MfaLoginService` asks for
 * no second step of anybody without the key.
 */
export interface MfaResolvedPolicy {
  totpEnabled: boolean;
  totpEnforced: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
}

/**
 * The administrator's role, as `admin_roles`' `PermissionReadPort.resolveRole`
 * answers it. A port call, never an entity read across the boundary.
 */
export type AdminRoleReader = (adminUserId: string) => Promise<AdminRoleResolution>;

/** The slice of SettingsService the resolver needs (port — not the class). */
export interface SettingsReader {
  get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T>;
}

export class MfaPolicyResolver {
  constructor(
    private readonly settings: SettingsReader,
    private readonly emFactory: () => EntityManager,
    /** Issue #349 — the administrator's role, for its `requiresTwoFactor`. */
    private readonly readAdminRole: AdminRoleReader,
    /**
     * Resolves the system-default sales-channel id for a storefront request
     * that arrived without one. `settingsService.get` requires a real channel
     * uuid or `null`, so a literal sentinel cannot be used.
     */
    private readonly resolveDefaultChannelId: () => Promise<string | null> = async () => null,
    /**
     * Issue #930 — whether this composition can enrol a second factor (it was
     * given an encryption key). Defaults to `true`, which keeps every
     * requirement in force.
     */
    private readonly canEnrolSecondFactor: boolean = true,
  ) {}

  async resolve(
    subject: MfaSubjectRef,
    ctx: MfaLoginContext,
  ): Promise<MfaResolvedPolicy> {
    const isAdmin = subject.subjectType === 'admin';
    // The admin surface has no storefront, so its four `mfa.admin.*` settings
    // are platform-wide by nature: `null` reads `global_value ?? default_value`
    // directly (feature 072, D-41 case c). It used to resolve the system-default
    // *channel* and read there, then coerce a missing one to `''` — which is not
    // a uuid, so the query threw in the driver and the `catch` below reported
    // every policy as `false`, i.e. MFA quietly off.
    //
    // A storefront subject keeps its channel: `mfa.storefront.*` genuinely
    // differs per storefront. With no request channel it falls back to the
    // system default, and to platform-wide only if there is none.
    const channelId = isAdmin
      ? null
      : ctx.salesChannelId ?? (await this.resolveDefaultChannelId());

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
    // Issues #930 and #948 — no administrator requirement is applied where
    // nothing can meet it: neither the platform-wide setting nor a role's flag.
    const adminRequirementApplies = !isAdmin || this.canEnrolSecondFactor;

    // Role enforcement is additive (administrators only). The federated
    // provider list and its start step resolve with no subject — nobody has
    // signed in yet — and read only the provider switches, so there is no
    // role to read. Without a key the role is not read at all, so its
    // fail-closed read cannot bring the requirement back.
    const roleEnforced =
      isAdmin && adminRequirementApplies && subject.subjectId !== ''
        ? await this.readRoleEnforcement(subject.subjectId)
        : false;
    const settingEnforced = adminRequirementApplies ? totpEnforcedRaw : false;
    const totpEnforced = settingEnforced || orgEnforced || roleEnforced;
    // Invariant FR-016: enforcement implies enablement.
    const totpEnabled = totpEnabledRaw || totpEnforced;

    return { totpEnabled, totpEnforced, googleEnabled, microsoftEnabled };
  }

  private async readBool(code: string, channelId: string | null): Promise<boolean> {
    try {
      return await this.settings.get(code, channelId, z.boolean());
    } catch {
      return false;
    }
  }

  /** Fails closed: an unreadable role, or a refusal, counts as requiring it. */
  private async readRoleEnforcement(adminUserId: string): Promise<boolean> {
    try {
      const resolution = await this.readAdminRole(adminUserId);
      return resolution.role ? resolution.role.requiresTwoFactor : true;
    } catch {
      return true;
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
