import { createHash, randomBytes } from 'crypto';

/**
 * Recovery (backup) code helpers (feature 042). Codes are shown once at
 * activation/regeneration; only their SHA-256 hashes are stored. Matching is
 * case-insensitive and whitespace-tolerant (the hash normalizes the input).
 */
export const RECOVERY_CODE_COUNT = 10;
const CODE_BYTES = 5; // → 10 hex chars

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(CODE_BYTES).toString('hex').toUpperCase(),
  );
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}
