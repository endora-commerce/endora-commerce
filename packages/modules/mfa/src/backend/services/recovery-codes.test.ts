import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './recovery-codes.js';

describe('recovery codes', () => {
  it('generates the configured number of distinct codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{10}$/);
  });

  it('hashes deterministically and case/space-insensitively', () => {
    const [code] = generateRecoveryCodes(1);
    const h = hashRecoveryCode(code!);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(code!.toLowerCase())).toBe(h);
    expect(hashRecoveryCode(` ${code!} `)).toBe(h);
  });

  it('different codes hash differently', () => {
    const [a, b] = generateRecoveryCodes(2);
    expect(hashRecoveryCode(a!)).not.toBe(hashRecoveryCode(b!));
  });

  it('normalizes input', () => {
    expect(normalizeRecoveryCode(' ab cd ')).toBe('ABCD');
  });
});
