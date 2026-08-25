import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Feed access token — feature 067 / FR-046, FR-047, data-model §11.
 *
 * The token in the public URL is the ONLY authorization on the module's
 * internet-facing route, so the model follows `api_keys` exactly: 32 random
 * bytes rendered base64url, shown to the operator **once**, and persisted only
 * as its sha256 hex (`packages/modules/api_keys/src/backend/entities/api-key.entity.ts`
 * — "We store only its sha256 hash").
 *
 * **No grace window on rotation** is deliberate (research §R8): a second still
 * valid token would mean rotation does not actually revoke. An in-flight
 * response completes because the token was validated at request start; that is
 * the transport layer's business, not this module's.
 */

/** 32 bytes → 43 base64url characters, ~256 bits of entropy. */
const TOKEN_BYTES = 32;

/** Non-secret display fragment shown in the admin next to the feed. */
const PREFIX_LENGTH = 8;

/**
 * The shape the public route pre-checks *before* touching the database, so a
 * scanner spraying garbage costs one regex rather than one indexed read.
 *
 * Non-global on purpose: a `/g` regex carries `lastIndex` between `.test()`
 * calls and would reject every second valid token.
 */
export const FEED_TOKEN_SHAPE_RE = /^[A-Za-z0-9_-]{43}$/;

export interface IssuedFeedToken {
  /** The plaintext. Returned to the operator once and never stored. */
  token: string;
  /** sha256 hex — the only thing persisted. */
  tokenHash: string;
  /** Non-secret leading fragment, for display. */
  prefix: string;
}

export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueFeedToken(): IssuedFeedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    token,
    tokenHash: hashFeedToken(token),
    prefix: token.slice(0, PREFIX_LENGTH),
  };
}

export function isFeedTokenShape(value: string): boolean {
  return FEED_TOKEN_SHAPE_RE.test(value);
}

/**
 * Constant-time hash comparison.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which would both
 * crash the route and leak length through the error path — so the length check
 * happens first and returns the ordinary "no match" answer.
 */
export function tokenHashMatches(candidateHash: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The four conditions the public route checks, in one place so they cannot drift. */
export interface PubliclyServableFeed {
  enabled: boolean;
  tokenHash?: string | null;
  tokenRevokedAt?: Date | null;
  publishedArtefactId?: string | null;
}

/**
 * Whether a feed row may be served over the public URL at all.
 *
 * Every `false` here maps to the SAME `404` body (FR-049) — the caller must not
 * branch on which condition failed, or the endpoint becomes an oracle for
 * "does this feed exist".
 */
export function isFeedPubliclyServable(feed: PubliclyServableFeed): boolean {
  if (!feed.enabled) return false;
  if (!feed.tokenHash) return false;
  if (feed.tokenRevokedAt) return false;
  if (!feed.publishedArtefactId) return false;
  return true;
}
