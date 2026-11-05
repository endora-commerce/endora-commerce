import { describe, expect, it } from 'vitest';
import { isUuidShape, uuidShapeSchema } from './common.js';

/**
 * Issue #753 — the one shape test a `uuid`-keyed path parameter is checked
 * against before it reaches PostgreSQL.
 */
describe('isUuidShape / uuidShapeSchema', () => {
  it.each([
    '00000000-0000-4000-8000-000000000401',
    '6F9619FF-8B86-D011-B42D-00C04FC964FF',
    // Seeded ids do not always honour RFC 9562's version and variant bits, and
    // PostgreSQL does not check them either.
    '00000000-0000-0000-0000-000000000001',
  ])('accepts %s', (value) => {
    expect(isUuidShape(value)).toBe(true);
    expect(uuidShapeSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '1c0785cf',
    'not-a-uuid',
    '',
    '00000000-0000-4000-8000-00000000075z',
    '00000000-0000-4000-8000-0000000004011',
    '{00000000-0000-4000-8000-000000000401}',
    '00000000000040008000000000000401',
  ])('refuses %j', (value) => {
    expect(isUuidShape(value)).toBe(false);
    expect(uuidShapeSchema.safeParse(value).success).toBe(false);
  });
});
