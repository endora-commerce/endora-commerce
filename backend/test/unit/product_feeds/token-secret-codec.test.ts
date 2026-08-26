import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptFeedToken,
  encryptFeedToken,
  isFeedTokenEnvelope,
} from '../../../../packages/modules/product_feeds/src/backend/services/token-secret-codec.js';

/**
 * The codec that makes a feed's link re-readable.
 *
 * The property that matters is the one on the failure side: **nothing here
 * throws**. This copy of the token is a convenience for the admin screen, not
 * the thing that authorizes the public route, so every unreadable case has to
 * degrade to "show the masked form" rather than take the feed page down.
 */

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

describe('feed token secret codec', () => {
  it('round-trips a token', () => {
    const token = randomBytes(32).toString('base64url');
    const envelope = encryptFeedToken(token, KEY);
    expect(envelope).not.toBeNull();
    expect(isFeedTokenEnvelope(envelope)).toBe(true);
    expect(decryptFeedToken(envelope, KEY)).toBe(token);
  });

  it('never writes the plaintext into the envelope', () => {
    const token = randomBytes(32).toString('base64url');
    const serialized = JSON.stringify(encryptFeedToken(token, KEY));
    expect(serialized).not.toContain(token);
  });

  it('produces a different ciphertext each time, so equal tokens are not linkable', () => {
    const token = randomBytes(32).toString('base64url');
    const a = encryptFeedToken(token, KEY);
    const b = encryptFeedToken(token, KEY);
    expect(a?.ct).not.toBe(b?.ct);
    expect(a?.iv).not.toBe(b?.iv);
  });

  it('returns null instead of throwing when no key is configured', () => {
    expect(encryptFeedToken('anything', undefined)).toBeNull();
    expect(encryptFeedToken('anything', '')).toBeNull();
  });

  it('returns null instead of throwing when the key is the wrong size', () => {
    expect(encryptFeedToken('anything', randomBytes(16).toString('base64'))).toBeNull();
  });

  it('returns null for an envelope written under a different key', () => {
    const envelope = encryptFeedToken('token', KEY);
    expect(decryptFeedToken(envelope, OTHER_KEY)).toBeNull();
  });

  it('returns null for a tampered ciphertext rather than a wrong plaintext', () => {
    const envelope = encryptFeedToken('token', KEY)!;
    const tampered = { ...envelope, ct: randomBytes(16).toString('base64') };
    expect(decryptFeedToken(tampered, KEY)).toBeNull();
  });

  it('returns null for anything that is not an envelope', () => {
    // Notably a bare string: unlike the settings codec there is no legacy
    // plaintext form here, so a string must not be mistaken for a token.
    expect(decryptFeedToken('a-plain-string', KEY)).toBeNull();
    expect(decryptFeedToken(null, KEY)).toBeNull();
    expect(decryptFeedToken(undefined, KEY)).toBeNull();
    expect(decryptFeedToken({ v: 2, alg: 'aes-256-gcm', iv: '', ct: '', tag: '' }, KEY)).toBeNull();
  });

  it('returns null when a readable envelope meets a missing key', () => {
    const envelope = encryptFeedToken('token', KEY);
    expect(decryptFeedToken(envelope, undefined)).toBeNull();
  });
});
