/**
 * The password hasher has moved to `src/kernel/crypto/password-hasher.ts`
 * (feature 075, Phase P, R-09): it is a pure function over its argument, so
 * gating it behind `auth`'s effective state would make `hashPassword` answer
 * 503 `MODULE_DISABLED` — a bug, not a degrade.
 *
 * This file stays as a re-export for the length of Phase P, because Phase P
 * publishes and cuts nothing: the eleven consumers still name this path, and
 * each is rewired to the kernel by its own Phase-C merge request. Delete it
 * when the last of them has been.
 */
export { hashPassword, verifyPassword } from '../../../kernel/crypto/password-hasher.js';
