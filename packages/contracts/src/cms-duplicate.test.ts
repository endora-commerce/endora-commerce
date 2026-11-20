import { describe, expect, it } from 'vitest';
import { duplicateCmsRecordRequestSchema } from './index.js';

/**
 * Issue #1495 (UX audit CONTENT-13, DEC-17) — the body of
 * `POST /api/v1/admin/cms/{pages|blocks|templates}/:id/duplicate`. The copy's
 * name is the only thing a caller may choose; its slug or code is always
 * derived, so the endpoint cannot become a second create path.
 */
describe('duplicateCmsRecordRequestSchema', () => {
  it('accepts an empty body and a name', () => {
    expect(duplicateCmsRecordRequestSchema.parse({})).toEqual({});
    expect(duplicateCmsRecordRequestSchema.parse({ name: '  About us (copy) ' })).toEqual({
      name: 'About us (copy)',
    });
  });

  it('accepts a name of exactly 200 characters', () => {
    expect(duplicateCmsRecordRequestSchema.safeParse({ name: 'a'.repeat(200) }).success).toBe(true);
  });

  it.each([
    ['a slug', { slug: 'about-copy' }],
    ['a code', { code: 'hero-copy' }],
    ['an empty name', { name: '' }],
    ['a whitespace name', { name: '   ' }],
    ['a name over 200 characters', { name: 'a'.repeat(201) }],
    ['a name that is not a string', { name: 7 }],
  ])('refuses %s', (_label, body) => {
    expect(duplicateCmsRecordRequestSchema.safeParse(body).success).toBe(false);
  });
});
