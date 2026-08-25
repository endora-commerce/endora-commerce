import { randomBytes } from 'node:crypto';

/**
 * Generates 22-char URL-safe base64 tokens (16 random bytes → base64url).
 *
 * Used for two distinct purposes inside the comparisons module:
 *   - `Comparison.shareToken` — the public, sharable identifier consumed
 *     by `GET /api/v1/comparisons/share/{token}` (US2).
 *   - `Comparison.anonymousToken` — the cookie-bound owner identity for
 *     anonymous customers (R-2).
 *
 * 128 bits of randomness from Node's stdlib (`crypto.randomBytes`) — no
 * external dependency. The keyspace is large enough that enumeration is
 * not a realistic threat (spec NFR-004).
 *
 * Constructor takes no DB; the class exists so the service layer can mock
 * deterministic tokens in tests via dependency injection.
 */
export class ShareTokenGenerator {
  generate(): string {
    return randomBytes(16).toString('base64url');
  }
}
