import { TOTP, Secret } from 'otpauth';
import { randomBytes, createHash, timingSafeEqual as nodeTimingSafeEqual } from 'crypto';

/**
 * Time-based one-time password (TOTP) as specified in RFC 6238 plus a small bank of
 * backup codes. Standard compatible with Google Authenticator, 1Password, Authy, etc.
 *
 * Per R-11 this is the platform's 2FA implementation for Customer Accounts and
 * Admin Users.
 */

const ISSUER = 'B2B Platform';
const PERIOD = 30;
const DIGITS = 6;
const ALGORITHM: 'SHA1' = 'SHA1';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10;

export interface EnrolmentResult {
  /** Raw secret (base32) — stored encrypted; given back to the client as otpauth URI only. */
  secret: string;
  /** URI to embed in an authenticator-app QR code. */
  otpauthUri: string;
  /** Plaintext backup codes — show once to the user; store only their SHA-256 hashes. */
  backupCodes: string[];
}

export function enroll(accountLabel: string): EnrolmentResult {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });
  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    randomBytes(BACKUP_CODE_LENGTH / 2).toString('hex').toUpperCase(),
  );
  return {
    secret: secret.base32,
    otpauthUri: totp.toString(),
    backupCodes,
  };
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  const normalised = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalised)) return false;
  const totp = new TOTP({
    issuer: ISSUER,
    label: 'verify',
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
  // window 1 = accept previous, current, and next 30-second step; typical drift tolerance.
  const delta = totp.validate({ token: normalised, window: 1 });
  return delta !== null;
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase(), 'utf8').digest('hex');
}

/**
 * Given the user-entered backup code and the array of stored hashes, returns the index
 * of the match (so the caller can remove that hash from persistence so it can't be
 * reused), or -1 on no match. Timing-safe.
 */
export function matchBackupCode(code: string, storedHashes: string[]): number {
  const candidateHash = hashBackupCode(code);
  const candidate = Buffer.from(candidateHash, 'hex');
  for (let i = 0; i < storedHashes.length; i++) {
    const stored = storedHashes[i];
    if (!stored || stored.length !== candidateHash.length) continue;
    const storedBuf = Buffer.from(stored, 'hex');
    if (storedBuf.length === candidate.length && nodeTimingSafeEqual(candidate, storedBuf)) {
      return i;
    }
  }
  return -1;
}
