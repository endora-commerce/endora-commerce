import { describe, expect, it } from 'vitest';
import { fingerprintPermissions } from '../../../src/modules/admin_actions/services/admin-actions-service.js';

describe('fingerprintPermissions', () => {
  it('returns the same fingerprint for the same permissions in any order', () => {
    const a = fingerprintPermissions(['catalog:write', 'cms.write', 'rfqs:handle']);
    const b = fingerprintPermissions(['rfqs:handle', 'cms.write', 'catalog:write']);
    expect(a).toBe(b);
  });

  it('returns different fingerprints for different permission sets', () => {
    const a = fingerprintPermissions(['catalog:write']);
    const b = fingerprintPermissions(['cms.write']);
    expect(a).not.toBe(b);
  });

  it('handles empty input deterministically', () => {
    const a = fingerprintPermissions([]);
    const b = fingerprintPermissions([]);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('handles the wildcard permission distinctly', () => {
    const a = fingerprintPermissions(['*']);
    const b = fingerprintPermissions([]);
    expect(a).not.toBe(b);
  });

  /**
   * Pinned pre-issue-190 digests.
   *
   * The separator between two permissions is a NUL byte — the one byte a
   * permission code cannot contain. `admin-actions-service.ts` used to spell it
   * as a raw NUL, which made git classify that source file as binary; issue
   * #190 respelled it as `\0`. Same byte, therefore the same digest, and these
   * values are what proves it: an escape that merely looks right (`\\0`, `0`,
   * or a dropped separator) changes every one of them.
   *
   * The fingerprint keys an in-process Map, so no stored digest depends on it
   * today. It is pinned anyway because that is a property of the current call
   * site, not of the function, and the next call site may persist it.
   */
  it.each([
    [[], 'da39a3ee5e6b4b0d'],
    [['*'], 'df58248c414f342c'],
    [['catalog:write'], 'ad52a7bcba6541ca'],
    [['cms.write'], 'c96cf5ae8e8ecbe9'],
    [['catalog:write', 'cms.write'], '4ca13dfe1aff46b4'],
    [['catalog:write', 'cms.write', 'rfqs:handle'], 'fc937f7e50db1d68'],
  ])('hashes %j to the digest it hashed before issue #190', (permissions, expected) => {
    expect(fingerprintPermissions(permissions)).toBe(expected);
  });

  it('separates permissions with a NUL, which no permission code can contain', () => {
    // Without a separator, ['ab', 'c'] and ['a', 'bc'] would collide.
    expect(fingerprintPermissions(['ab', 'c'])).not.toBe(fingerprintPermissions(['a', 'bc']));
  });

  it('returns a 16-character hex slice', () => {
    const fp = fingerprintPermissions(['catalog:write', 'cms.write']);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});
