import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';

import { preferenceOwner } from './product-editor-preferences.service.js';

/**
 * Feature 170 (C2/C3 security review note) — an editor preference is one admin's: with no
 * resolved admin id the call is refused, never filed under a shared all-zero id where every
 * admin would read the last scope another one chose.
 */
describe('preferenceOwner', () => {
  it('answers the admin id it is given', () => {
    expect(preferenceOwner('6f1d2c4e-8a1b-4c2d-9e3f-0a1b2c3d4e5f')).toBe('6f1d2c4e-8a1b-4c2d-9e3f-0a1b2c3d4e5f');
  });

  it.each([undefined, null, ''])('refuses %s with 403 FORBIDDEN', (id) => {
    expect(() => preferenceOwner(id)).toThrow(expect.objectContaining({ statusCode: 403, code: ERROR_CODES.FORBIDDEN }));
  });
});
