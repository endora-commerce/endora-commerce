import { describe, expect, it } from 'vitest';
import { HmacSigner } from '../../../src/modules/assets_library/services/hmac.js';

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('HmacSigner', () => {
  it('round-trips sign + verify for a fresh token', () => {
    const signer = HmacSigner.fromEnv(KEY_HEX);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signer.sign({ assetId: 'a', exp });
    expect(signer.verify({ assetId: 'a', exp, token, nowSec: Math.floor(Date.now() / 1000) })).toBe(true);
  });

  it('rejects an expired token', () => {
    const signer = HmacSigner.fromEnv(KEY_HEX);
    const past = Math.floor(Date.now() / 1000) - 1;
    const token = signer.sign({ assetId: 'a', exp: past });
    expect(signer.verify({ assetId: 'a', exp: past, token, nowSec: Math.floor(Date.now() / 1000) })).toBe(false);
  });

  it('rejects a token signed for a different assetId', () => {
    const signer = HmacSigner.fromEnv(KEY_HEX);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signer.sign({ assetId: 'a', exp });
    expect(signer.verify({ assetId: 'b', exp, token, nowSec: Math.floor(Date.now() / 1000) })).toBe(false);
  });

  it('rejects a tampered token (one hex char flipped)', () => {
    const signer = HmacSigner.fromEnv(KEY_HEX);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signer.sign({ assetId: 'a', exp });
    const tampered = token.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    expect(signer.verify({ assetId: 'a', exp, token: tampered, nowSec: Math.floor(Date.now() / 1000) })).toBe(false);
  });

  it('rejects a valid signature produced with a different key', () => {
    const signerA = HmacSigner.fromEnv(KEY_HEX);
    const signerB = HmacSigner.fromEnv('ff' + KEY_HEX.slice(2));
    const exp = Math.floor(Date.now() / 1000) + 60;
    const tokenA = signerA.sign({ assetId: 'a', exp });
    expect(signerB.verify({ assetId: 'a', exp, token: tokenA, nowSec: Math.floor(Date.now() / 1000) })).toBe(false);
  });

  it('throws when explicitly given an empty key', () => {
    // Passing '' bypasses the env-fallback path: callers who supply an empty
    // string are signalling unconfigured state explicitly.
    expect(() => HmacSigner.fromEnv('')).toThrow();
  });
});
