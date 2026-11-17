import { createCipheriv, createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GUEST_TRACKING_PURPOSE,
  GUEST_VERIFY_PURPOSE,
  createGuestLinks,
  type GuestLinkSeal,
} from './guest-tracking-link.js';

/**
 * `specs/181-guest-complaints/` T015 (research R-3, R-5): the guest's two links
 * are purpose-sealed references, not stored secrets — the verification link
 * seals the verification id, the tracking link the case id and its version.
 *
 * The seal here is a stand-in with the platform `cursorSeal`'s contract —
 * AES-256-GCM, the purpose as additional data, a synthetic IV so one payload
 * always seals to one token — because a module may not name the platform's
 * composition subpath (`check:platform-surface`). What is under test is how
 * `returns` uses a seal: which purpose, which payload, what it accepts back.
 */
function testSeal(secret = 'test-secret'): GuestLinkSeal {
  const key = createHmac('sha256', secret).update('enc').digest();
  const ivKey = createHmac('sha256', secret).update('iv').digest();
  return {
    seal(purpose, payload) {
      const iv = createHmac('sha256', ivKey).update(`${purpose}\u0000${payload}`).digest().subarray(0, 12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
    },
    open(purpose, token) {
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.length < 29 || bytes.toString('base64url') !== token) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(purpose));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

describe('guest links (R-3, R-5)', () => {
  const links = createGuestLinks(testSeal());
  const caseId = randomUUID();
  const verificationId = randomUUID();

  it('names its two purposes', () => {
    expect(GUEST_VERIFY_PURPOSE).toBe('returns.guest-verify.v1');
    expect(GUEST_TRACKING_PURPOSE).toBe('returns.guest-tracking.v1');
  });

  it('opens a verification token to its verification id', () => {
    expect(links.openVerification(links.verificationToken(verificationId))).toBe(verificationId);
  });

  it('opens a tracking token to its case and version', () => {
    expect(links.openTracking(links.trackingToken(caseId, 3))).toEqual({ caseId, version: 3 });
  });

  it('never opens a verification token as a tracking token, nor the reverse', () => {
    expect(links.openTracking(links.verificationToken(verificationId))).toBeNull();
    expect(links.openVerification(links.trackingToken(caseId, 1))).toBeNull();
  });

  it('answers null for a tampered, foreign-keyed, empty or garbage token', () => {
    const token = links.trackingToken(caseId, 1);
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(links.openTracking(`${token.slice(0, -1)}${last}`)).toBeNull();
    expect(createGuestLinks(testSeal('another-key')).openTracking(token)).toBeNull();
    expect(links.openTracking('')).toBeNull();
    expect(links.openTracking('not a token')).toBeNull();
    expect(links.openVerification('x'.repeat(600))).toBeNull();
  });

  it('answers null for a well-sealed payload of the wrong shape', () => {
    const seal = testSeal();
    const raw = createGuestLinks(seal);
    expect(raw.openTracking(seal.seal(GUEST_TRACKING_PURPOSE, 'not-a-uuid:1'))).toBeNull();
    expect(raw.openTracking(seal.seal(GUEST_TRACKING_PURPOSE, `${caseId}:0`))).toBeNull();
    expect(raw.openTracking(seal.seal(GUEST_TRACKING_PURPOSE, `${caseId}:1.5`))).toBeNull();
    expect(raw.openTracking(seal.seal(GUEST_TRACKING_PURPOSE, caseId))).toBeNull();
    expect(raw.openVerification(seal.seal(GUEST_VERIFY_PURPOSE, 'nope'))).toBeNull();
  });

  it('is stable for one case and version, and changes with the version', () => {
    expect(links.trackingToken(caseId, 1)).toBe(links.trackingToken(caseId, 1));
    expect(links.trackingToken(caseId, 2)).not.toBe(links.trackingToken(caseId, 1));
    expect(links.trackingToken(randomUUID(), 1)).not.toBe(links.trackingToken(caseId, 1));
  });
});
