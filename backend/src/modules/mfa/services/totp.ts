import { TOTP, Secret } from 'otpauth';

/**
 * TOTP helpers (feature 042) using the already-present `otpauth` dependency.
 * Same parameters as the platform's existing TOTP primitive
 * (`auth/services/totp-service.ts`) for authenticator-app compatibility.
 */
const ISSUER = 'B2B Platform';
const PERIOD = 30;
const DIGITS = 6;
const ALGORITHM = 'SHA1' as const;

export function generateSecret(accountLabel: string): {
  secret: string;
  otpauthUri: string;
} {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });
  return { secret: secret.base32, otpauthUri: totp.toString() };
}

/**
 * Verify a 6-digit code against a base32 secret. Returns the absolute TOTP
 * time-step that matched (for the replay guard), or null if invalid. Accepts
 * the ±1 step drift window.
 */
export function verifyTotpStep(secretBase32: string, code: string): number | null {
  const normalised = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalised)) return null;
  const totp = new TOTP({
    issuer: ISSUER,
    label: 'verify',
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: normalised, window: 1 });
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / PERIOD) + delta;
}
