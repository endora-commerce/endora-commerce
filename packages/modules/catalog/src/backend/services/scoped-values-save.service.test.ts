import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SCOPED_AUDIT_CELL_MAX_BYTES } from '@endora-commerce/contracts';

import { boundedAuditCell } from './scoped-values-save.service.js';

/**
 * Feature 170 (R21; C2/C3 security review note) — an audit cell over the cap is stored as
 * `{ truncated, length, sha256 }`: strings by their UTF-8 bytes, arrays and objects (attribute
 * lists, audiences) by the bytes of their JSON form.
 */
describe('boundedAuditCell', () => {
  const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  it('keeps small values of every kind as they are', () => {
    for (const value of ['short', 12, true, null, ['a', 'b'], { inherit: true }, { visibility: 'public', allowedOrganizationIds: [] }]) {
      expect(boundedAuditCell(value)).toEqual(value);
    }
  });

  it('bounds a long string by its bytes', () => {
    const value = 'x'.repeat(SCOPED_AUDIT_CELL_MAX_BYTES + 1);
    expect(boundedAuditCell(value)).toEqual({ truncated: true, length: value.length, sha256: sha(value) });
  });

  it('bounds a long array and a large object by their JSON form', () => {
    const list = Array.from({ length: 500 }, (_, i) => `option-${i}-${'y'.repeat(20)}`);
    const json = JSON.stringify(list);
    expect(boundedAuditCell(list)).toEqual({ truncated: true, length: Buffer.byteLength(json, 'utf8'), sha256: sha(json) });
    const audience = { visibility: 'restricted', allowedOrganizationIds: Array.from({ length: 200 }, () => '6f1d2c4e-8a1b-4c2d-9e3f-0a1b2c3d4e5f') };
    expect(boundedAuditCell(audience)).toMatchObject({ truncated: true, sha256: sha(JSON.stringify(audience)) });
  });
});
