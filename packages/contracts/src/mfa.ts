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

export const mfaSocialLinkSummarySchema = z.object({
  provider: mfaSocialProviderSchema,
  email: z.string(),
  linkedAt: z.string(),
});

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
  ADMIN_TOTP_ENABLED: 'mfa.admin.totp_enabled',
  ADMIN_TOTP_ENFORCED: 'mfa.admin.totp_enforced',
  STOREFRONT_TOTP_ENABLED: 'mfa.storefront.totp_enabled',
  STOREFRONT_TOTP_ENFORCED: 'mfa.storefront.totp_enforced',
  ADMIN_GOOGLE_ENABLED: 'mfa.admin.google_enabled',
  ADMIN_MICROSOFT_ENABLED: 'mfa.admin.microsoft_enabled',
  STOREFRONT_GOOGLE_ENABLED: 'mfa.storefront.google_enabled',
  STOREFRONT_MICROSOFT_ENABLED: 'mfa.storefront.microsoft_enabled',
} as const;
