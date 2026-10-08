import { describe, expect, it } from 'vitest';
import {
  adminAttributeResponseSchema,
  createAttributeRequestSchema,
  updateAttributeRequestSchema,
} from '../src/catalog.js';

/**
 * `isPriceRule` — the attribute flag that says whether an attribute may be
 * used as a price-building rule in a Price List. It is a sibling of
 * `isPromoRule` and travels through the same three shapes: optional on
 * create, optional on update, always present on read.
 */
const CREATE_BASE = {
  key: 'material',
  label: { 'en-US': 'Material' },
  type: 'input',
  isSearchable: false,
  isFilterable: false,
  isVariantAxis: false,
};

describe('attribute contracts — isPriceRule', () => {
  it('create accepts the flag and leaves it absent when omitted', () => {
    const flagged = createAttributeRequestSchema.parse({ ...CREATE_BASE, isPriceRule: true });
    expect(flagged.isPriceRule).toBe(true);
    const plain = createAttributeRequestSchema.parse(CREATE_BASE);
    expect(plain.isPriceRule).toBeUndefined();
  });

  it('create rejects a non-boolean flag', () => {
    const res = createAttributeRequestSchema.safeParse({ ...CREATE_BASE, isPriceRule: 'yes' });
    expect(res.success).toBe(false);
  });

  it('update accepts the flag on its own', () => {
    const parsed = updateAttributeRequestSchema.parse({ isPriceRule: true });
    expect(parsed.isPriceRule).toBe(true);
  });

  it('the admin read shape requires the flag', () => {
    expect(Object.keys(adminAttributeResponseSchema.shape)).toContain('isPriceRule');
    const shape = adminAttributeResponseSchema.shape as Record<
      string,
      { safeParse: (v: unknown) => { success: boolean } }
    >;
    expect(shape['isPriceRule']?.safeParse(undefined).success).toBe(false);
    expect(shape['isPriceRule']?.safeParse(false).success).toBe(true);
  });
});
