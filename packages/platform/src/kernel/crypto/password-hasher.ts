import { randomBytes } from 'node:crypto';
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

/**
 * One hash of a value nobody knows, made once per process with the parameters
 * every stored hash is made with. It is what a sign-in verifies against when
 * there is no account to verify against.
 */
const DUMMY_HASH: Promise<string> = argon2.hash(randomBytes(32).toString('hex'), HASH_OPTIONS);
// Reported where it is awaited, not as an unhandled rejection at import.
DUMMY_HASH.catch(() => undefined);

/**
 * {@link verifyPassword}, for a sign-in: when there is no usable stored hash —
 * no such account, or one that may not sign in — the password is verified
 * against {@link DUMMY_HASH} and the answer is `false`.
 *
 * Skipping the verification for an unknown address makes that refusal arrive
 * tens of milliseconds sooner than the one for a wrong password, and the
 * difference tells a caller which addresses have an account.
 */
export async function verifyPasswordOrDummy(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (hash) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Not a hash at all: do the work below, as for a missing one.
    }
  }
  await argon2.verify(await DUMMY_HASH, password);
  return false;
}
