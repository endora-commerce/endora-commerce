/**
 * The TOTP primitives moved to `src/kernel/crypto/totp.ts` (feature 075,
 * Phase P, R-09): they are pure functions over their arguments, so gating them
 * behind `auth`'s effective state would make "is this code valid for this
 * secret" answer 503 `MODULE_DISABLED`.
 *
 * This file stays as a re-export for the length of Phase P, which cuts no
 * consumer. Delete it once `customer_accounts` and `mfa` name the kernel path.
 */
export {
  type EnrolmentResult,
  enroll,
  verifyTotp,
  hashBackupCode,
  matchBackupCode,
} from '../../../kernel/crypto/totp.js';
