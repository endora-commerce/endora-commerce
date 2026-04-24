import argon2 from 'argon2';

/**
 * Thin wrapper around argon2id with OWASP-recommended parameters.
 * See research.md R-11.
 *
 * - memoryCost: 19 MiB (19456 KiB) — OWASP 2024 recommendation.
 * - timeCost: 2.
 * - parallelism: 1.
 * - argon2id type.
 */

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters long.');
  }
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
