// HMAC sign/verify for local-FS private asset URLs. Cloud backends use their
// own native signed URLs and do not consult this module.
//
// The signing key is sourced from the env var ASSETS_LIBRARY_HMAC_KEY (32-byte
// hex string). Rotating the key invalidates every outstanding private URL —
// that is the desired behaviour, not a bug.

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedTokenInput {
  /** Asset id this token authorizes. */
  assetId: string;
  /** Unix-seconds expiry. */
  exp: number;
}

export interface VerificationContext {
  assetId: string;
  /** The full token string from the URL. */
  token: string;
  /** The full exp value from the URL (seconds). */
  exp: number;
  /** Now (seconds since epoch). Injectable for tests. */
  nowSec: number;
}

export class HmacSigner {
  constructor(private readonly key: Buffer) {
    if (key.length === 0) {
      throw new Error('HmacSigner: key cannot be empty');
    }
  }

  static fromEnv(envKey = process.env['ASSETS_LIBRARY_HMAC_KEY']): HmacSigner {
    if (!envKey || envKey.trim().length === 0) {
      throw new Error(
        'ASSETS_LIBRARY_HMAC_KEY is unset. Generate one with `openssl rand -hex 32` and add it to backend/.env.',
      );
    }
    // Accept hex or raw — hex is what we document, but tolerate raw for tests.
    const buf = /^[0-9a-fA-F]+$/.test(envKey) && envKey.length % 2 === 0
      ? Buffer.from(envKey, 'hex')
      : Buffer.from(envKey, 'utf8');
    return new HmacSigner(buf);
  }

  sign(input: SignedTokenInput): string {
    return createHmac('sha256', this.key)
      .update(`${input.assetId}\n${input.exp}`)
      .digest('hex');
  }

  /**
   * Returns true when `ctx.token` is a valid signature for
   * (`ctx.assetId`, `ctx.exp`) and `ctx.exp >= ctx.nowSec`. Returns false on
   * any failure (mismatch, expiry, malformed). Uses `timingSafeEqual`.
   */
  verify(ctx: VerificationContext): boolean {
    if (!Number.isFinite(ctx.exp) || ctx.exp < ctx.nowSec) return false;
    const expected = this.sign({ assetId: ctx.assetId, exp: ctx.exp });
    if (expected.length !== ctx.token.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(ctx.token, 'hex'));
    } catch {
      return false;
    }
  }
}
