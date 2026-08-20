// @b2b/contracts — MFA module (feature 042).
//
// Source-of-truth Zod schemas for the MFA boundary: TOTP enrolment/verification,
// the two-step login result, federated sign-in, and admin reset/enforcement.
// Provider client secrets are NOT modelled here — they are backend config/env.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Identity surface a subject belongs to. */
export const mfaSubjectTypeSchema = z.enum(['customer', 'admin']);
export type MfaSubjectType = z.infer<typeof mfaSubjectTypeSchema>;

/** Supported federated identity providers. */
export const mfaSocialProviderSchema = z.enum(['google', 'microsoft']);
export type MfaSocialProvider = z.infer<typeof mfaSocialProviderSchema>;

// ---------------------------------------------------------------------------
// Federated sign-in availability (issue #193)
// ---------------------------------------------------------------------------

/**
 * `GET /api/v1/auth/{customer|admin}/oauth/providers` — public, unauthenticated.
 *
 * The providers a sign-in surface can actually complete a hand-off with. A
 * provider is listed only when **both** halves hold: client credentials are
 * configured for it (backend env, never Settings) *and* the surface's
 * `mfa.*.<provider>_enabled` setting is on for the request's sales channel.
 *
 * A provider missing either half is **absent from the array**, not present with
 * a `false` flag. That asymmetry is the contract's job: a frontend deciding
 * "render this button or not" must not be handed a reason to render a control
 * whose click leads back to the login screen with an error. Both settings
 * default to `false`, so the honest answer on a fresh deployment is `[]`.
 *
 * The route belongs to `mfa` and is gated at its registration seam, so a
 * switched-off module answers 503 `MODULE_DISABLED`. Frontends still project
 * absence from `/module-presence` first and treat the 503 as defence in depth —
 * absence is projected, never inferred from a status code.
 */
export const federatedSignInOptionsResponseSchema = z.object({
  providers: z.array(mfaSocialProviderSchema),
});
export type FederatedSignInOptionsResponse = z.infer<
  typeof federatedSignInOptionsResponseSchema
>;

// ---------------------------------------------------------------------------
// Two-step login result (replaces the inline `twoFactorCode` shape)
// ---------------------------------------------------------------------------

/**
 * Discriminated result returned by the first login step (email+password) and
 * by the OAuth callback. Only `authenticated` carries/sets a session cookie;
 * the other two hand the client an opaque ticket for the second step.
 */
export const mfaLoginResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('authenticated') }),
  z.object({ status: z.literal('mfaRequired'), challengeId: z.string().min(1) }),
  z.object({
    status: z.literal('mfaSetupRequired'),
    setupTicket: z.string().min(1),
  }),
]);
export type MfaLoginResult = z.infer<typeof mfaLoginResultSchema>;

/** Second-step verification — a 6-digit TOTP code or a recovery code. */
export const mfaVerifyRequestSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().min(6).max(20),
});
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

// ---------------------------------------------------------------------------
// Self-service enrolment
// ---------------------------------------------------------------------------

/** Optional setup ticket for the enforced-but-unenrolled flow (no session yet). */
export const mfaSetupTicketBodySchema = z.object({
  setupTicket: z.string().min(1).optional(),
});

export const mfaSetupResponseSchema = z.object({
  /** base32 secret for manual entry. */
  secret: z.string().min(1),
  /** otpauth:// URI for QR rendering on the client. */
  otpauthUri: z.string().min(1),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const mfaActivateRequestSchema = z.object({
  code: z.string().length(6),
  setupTicket: z.string().min(1).optional(),
});
export type MfaActivateRequest = z.infer<typeof mfaActivateRequestSchema>;

export const mfaActivateResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).length(10),
});
export type MfaActivateResponse = z.infer<typeof mfaActivateResponseSchema>;

/**
 * Enforced-but-unenrolled flow (feature 042, US3). The setup ticket replaces a
 * session for the forced-enrolment screen: `begin` returns the secret, and
 * `complete` activates + upgrades the ticket to a full session.
 */
export const mfaSetupTicketBeginSchema = z.object({
  setupTicket: z.string().min(1),
});
export type MfaSetupTicketBegin = z.infer<typeof mfaSetupTicketBeginSchema>;

export const mfaSetupTicketCompleteSchema = z.object({
  setupTicket: z.string().min(1),
  code: z.string().length(6),
});
export type MfaSetupTicketComplete = z.infer<typeof mfaSetupTicketCompleteSchema>;

/** Re-auth for self-disable: current password, or a current TOTP/recovery code. */
export const mfaDisableRequestSchema = z
  .object({
    password: z.string().min(1).optional(),
    code: z.string().min(6).max(20).optional(),
  })
  .refine((v) => Boolean(v.password) || Boolean(v.code), {
    message: 'Either password or code is required to disable 2FA.',
  });
export type MfaDisableRequest = z.infer<typeof mfaDisableRequestSchema>;

export const mfaRegenerateRequestSchema = z.object({
  code: z.string().length(6),
});
export type MfaRegenerateRequest = z.infer<typeof mfaRegenerateRequestSchema>;

/**
 * Why an account may not sever a federated identity (issue #194).
 *
 * `last_credential` — it is the account's only link, and the platform cannot
 * tell whether its holder has ever chosen a password: an account created by a
 * social sign-in is given a random one at signup. Removing the link could
 * therefore remove the only credential its holder can use, so it is refused
 * until another credential is in place.
 */
export const mfaSocialUnlinkBlockedReasonSchema = z.enum(['last_credential']);
export type MfaSocialUnlinkBlockedReason = z.infer<typeof mfaSocialUnlinkBlockedReasonSchema>;

export const mfaSocialLinkSummarySchema = z.object({
  provider: mfaSocialProviderSchema,
  email: z.string(),
  linkedAt: z.string(),
  /** The surface renders the unlink control from this, never from its own guess. */
  canUnlink: z.boolean(),
  unlinkBlockedReason: mfaSocialUnlinkBlockedReasonSchema.nullable(),
});
export type MfaSocialLinkSummary = z.infer<typeof mfaSocialLinkSummarySchema>;

/** `DELETE {prefix}/social-links/:provider` — one link per provider per account. */
export const mfaSocialUnlinkParamsSchema = z.object({
  provider: mfaSocialProviderSchema,
});
export type MfaSocialUnlinkParams = z.infer<typeof mfaSocialUnlinkParamsSchema>;

export const mfaSocialUnlinkResponseSchema = z.object({
  status: z.literal('unlinked'),
  provider: mfaSocialProviderSchema,
});
export type MfaSocialUnlinkResponse = z.infer<typeof mfaSocialUnlinkResponseSchema>;

export const mfaStatusResponseSchema = z.object({
  totpActive: z.boolean(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
  totpEnabledForScope: z.boolean(),
  totpEnforcedForScope: z.boolean(),
  socialLinks: z.array(mfaSocialLinkSummarySchema),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Organization enforcement policy
// ---------------------------------------------------------------------------

export const mfaOrgPolicyRequestSchema = z.object({
  enforceTotp: z.boolean(),
});
export type MfaOrgPolicyRequest = z.infer<typeof mfaOrgPolicyRequestSchema>;

export const mfaOrgPolicyResponseSchema = z.object({
  enforceTotp: z.boolean(),
});
export type MfaOrgPolicyResponse = z.infer<typeof mfaOrgPolicyResponseSchema>;

// ---------------------------------------------------------------------------
// Admin reset
// ---------------------------------------------------------------------------

export const mfaResetBulkRequestSchema = z.union([
  z.object({ customerIds: z.array(z.string().uuid()).min(1).max(1000) }),
  z.object({ organizationId: z.string().uuid() }),
]);
export type MfaResetBulkRequest = z.infer<typeof mfaResetBulkRequestSchema>;

export const mfaResetResultSchema = z.object({ affected: z.boolean() });
export type MfaResetResult = z.infer<typeof mfaResetResultSchema>;

export const mfaResetBulkResultSchema = z.object({
  requested: z.number().int().nonnegative(),
  affected: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type MfaResetBulkResult = z.infer<typeof mfaResetBulkResultSchema>;

// ---------------------------------------------------------------------------
// Setting codes (single source for both manifest and resolver)
// ---------------------------------------------------------------------------

export const MFA_SETTING_CODES = {
  /**
   * Feature 074 — the operator-activation control (Constitution XVII). It sits
   * above the eight policy switches below rather than beside them: those decide
   * *which* second factor a surface offers, this decides whether the module is
   * present at all.
   */
  ACTIVATION: 'mfa.enabled',
  ADMIN_TOTP_ENABLED: 'mfa.admin.totp_enabled',
  ADMIN_TOTP_ENFORCED: 'mfa.admin.totp_enforced',
  STOREFRONT_TOTP_ENABLED: 'mfa.storefront.totp_enabled',
  STOREFRONT_TOTP_ENFORCED: 'mfa.storefront.totp_enforced',
  ADMIN_GOOGLE_ENABLED: 'mfa.admin.google_enabled',
  ADMIN_MICROSOFT_ENABLED: 'mfa.admin.microsoft_enabled',
  STOREFRONT_GOOGLE_ENABLED: 'mfa.storefront.google_enabled',
  STOREFRONT_MICROSOFT_ENABLED: 'mfa.storefront.microsoft_enabled',
} as const;

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** How many subjects hold an active second factor, split by identity store. */
export const mfaActiveEnrolmentCountsSchema = z.object({
  admins: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
});
export type MfaActiveEnrolmentCounts = z.infer<typeof mfaActiveEnrolmentCountsSchema>;

/**
 * Container name: `mfaEnrolmentCountPort`. Owner: `mfa`.
 *
 * How many people would lose their second factor. Read by `/platform/modules`
 * before an operator switches this module off, so the confirmation dialog can
 * say "14 administrators and 320 customers currently use a second factor"
 * instead of only naming the capability.
 *
 * **It is read while `mfa` is still on**, which is the whole reason it can be a
 * port at all: the dialog renders before the flip, so the gate on this
 * registration is open at exactly the moment the question is asked. A count
 * taken *after* deactivation would be a read of `mfa_enrolments` through a
 * closed gate, which is why "refuse the login of an enrolled subject while the
 * module is off" was ruled unimplementable (D-96.7).
 *
 * The caller therefore decides presence before it resolves this, and treats a
 * failed read as "count unavailable" — a number that cannot be fetched must
 * never stop an operator switching a module off.
 */
export interface MfaEnrolmentCountPort {
  /** Subjects with an `active` (confirmed) TOTP enrolment, right now. */
  countActiveEnrolments(): Promise<MfaActiveEnrolmentCounts>;
}
