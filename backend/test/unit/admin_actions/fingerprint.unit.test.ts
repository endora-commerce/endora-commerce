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

  it('returns a 16-character hex slice', () => {
    const fp = fingerprintPermissions(['catalog:write', 'cms.write']);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});
