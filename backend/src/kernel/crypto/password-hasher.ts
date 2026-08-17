import argon2 from 'argon2';

/**
 * Thin wrapper around argon2id with OWASP-recommended parameters.
 * See specs/001-b2b-platform-foundation/research.md R-11.
 *
 * - memoryCost: 19 MiB (19456 KiB) — OWASP 2024 recommendation.
 * - timeCost: 2.
 * - parallelism: 1.
 * - argon2id type.
 *
 * **Why this lives in the kernel and not in `auth` (feature 075, R-09).**
 * Five modules and the dev seed hash a password. Every one of them reached
 * into `auth/services/password-hasher.js` for it, and the obvious remedy —
 * publish it as a port — is the wrong one: `providePort` wraps a registration
 * in a gate on the owner's effective state, so an operator switching `auth`
 * off would make `hashPassword` answer 503 `MODULE_DISABLED`. That is not a
 * degrade, it is a bug. The test the plan sets is "does switching the owner
 * off change the answer?", and for a pure function over its argument the
 * answer is no. So it relocates rather than becoming a port.
 *
 * It reads no table, holds no state and touches no request context, which is
 * what makes the kernel the right home rather than a second module.
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
