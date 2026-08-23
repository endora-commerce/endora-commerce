import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  SecretKeyMissing,
  SecretKeyInvalid,
  decryptSecretValue,
  encryptSecretValue,
  isSecretEnvelope,
  secretValueIsSet,
} from '../../../src/kernel/settings/secret-value-codec.js';

/**
 * T004 — unit tests for the settings secret-value codec (feature 043, FR-021).
 * Written first per Principle III; the codec must satisfy every case below.
 */

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

describe('secret-value codec (T004)', () => {
  it('round-trips a plaintext through encrypt → decrypt', () => {
    const envelope = encryptSecretValue('sk-ant-test-123', KEY);
    expect(isSecretEnvelope(envelope)).toBe(true);
    expect(decryptSecretValue(envelope, KEY)).toBe('sk-ant-test-123');
  });

  it('produces a v1 aes-256-gcm envelope with base64 fields and no plaintext leakage', () => {
    const envelope = encryptSecretValue('top-secret-value', KEY);
    expect(envelope).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
    expect(typeof envelope.iv).toBe('string');
    expect(typeof envelope.ct).toBe('string');
    expect(typeof envelope.tag).toBe('string');
    expect(JSON.stringify(envelope)).not.toContain('top-secret-value');
  });

  it('uses a fresh IV per encryption (same plaintext, different ciphertext)', () => {
    const a = encryptSecretValue('same', KEY);
    const b = encryptSecretValue('same', KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('rejects a tampered ciphertext / auth tag', () => {
    const envelope = encryptSecretValue('payload', KEY);
    const tampered = { ...envelope, tag: Buffer.from(randomBytes(16)).toString('base64') };
    expect(() => decryptSecretValue(tampered, KEY)).toThrow();
  });

  it('fails to decrypt with the wrong key', () => {
    const envelope = encryptSecretValue('payload', KEY);
    expect(() => decryptSecretValue(envelope, OTHER_KEY)).toThrow();
  });

  it('passes legacy plaintext strings through unchanged on read', () => {
    // Pre-043 secret-ish settings (e.g. search.llm.embedder_api_key) stored
    // plain strings; reads must keep working even without the env key.
    expect(decryptSecretValue('legacy-plaintext-key', undefined)).toBe('legacy-plaintext-key');
    expect(decryptSecretValue('legacy-plaintext-key', KEY)).toBe('legacy-plaintext-key');
    expect(decryptSecretValue('', KEY)).toBe('');
  });

  it('throws SecretKeyMissing when encrypting without a key', () => {
    expect(() => encryptSecretValue('value', undefined)).toThrow(SecretKeyMissing);
  });

  it('throws SecretKeyMissing when decrypting an envelope without a key', () => {
    const envelope = encryptSecretValue('value', KEY);
    expect(() => decryptSecretValue(envelope, undefined)).toThrow(SecretKeyMissing);
  });

  it('rejects keys that do not decode to 32 bytes with a clear SecretKeyInvalid', () => {
    const shortKey = Buffer.from('short').toString('base64');
    expect(() => encryptSecretValue('value', shortKey)).toThrow(SecretKeyInvalid);
    try {
      encryptSecretValue('value', shortKey);
    } catch (err) {
      expect((err as Error).message).toMatch(/must decode to 32 bytes/);
      expect((err as SecretKeyInvalid).code).toBe('SETTING_SECRET_KEY_MISSING');
    }
  });

  it('isSecretEnvelope discriminates envelopes from arbitrary values', () => {
    expect(isSecretEnvelope(encryptSecretValue('x', KEY))).toBe(true);
    expect(isSecretEnvelope('plain string')).toBe(false);
    expect(isSecretEnvelope(null)).toBe(false);
    expect(isSecretEnvelope({ v: 2, alg: 'aes-256-gcm', iv: '', ct: '', tag: '' })).toBe(false);
    expect(isSecretEnvelope({ v: 1, alg: 'aes-256-gcm' })).toBe(false);
  });

  it('secretValueIsSet: envelope or non-empty string ⇒ set; empty/null ⇒ unset', () => {
    expect(secretValueIsSet(encryptSecretValue('x', KEY))).toBe(true);
    expect(secretValueIsSet('legacy-plaintext')).toBe(true);
    expect(secretValueIsSet('')).toBe(false);
    expect(secretValueIsSet(null)).toBe(false);
    expect(secretValueIsSet(undefined)).toBe(false);
  });
});
