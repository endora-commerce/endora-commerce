import { describe, expect, it } from 'vitest';
import {
  copyScopedValueResponseSchema,
  SCOPED_SAVE_CELLS_MAX,
  saveScopedValuesRequestSchema,
  scopedValueChangesSchema,
} from './product-scoped-values.js';
import { fieldPathSchema, productScopedWriteInputSchema } from './product-scopes.js';
import { scopedWrite } from './scoped-write-encoding.js';
import { z } from 'zod';

/**
 * Feature 170 (R21; C1 review) — the bounds of the save body are refused **while parsing**, not
 * only by a refine after it: a record with more keys than the cell cap, a reserved record key
 * (`__proto__`, `constructor`, `prototype` — an own key once `JSON.parse` has run), an over-long
 * URL key before it is normalised, a malformed inherit marker, and a field path whose subject is
 * not a uuid.
 */

const UUID = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const save = (changes: unknown) => ({ scope: {}, version: '0', changes });

describe('170 — scopedValueChangesSchema bounds', () => {
  it.each(['attributes', 'attachments', 'packagingUnits'] as const)('refuses more %s keys than the cell cap', (family) => {
    const entries = Array.from({ length: SCOPED_SAVE_CELLS_MAX + 1 }, (_, i) =>
      family === 'attributes' ? [`attr_${i}`, 'x'] : [UUID(i), { name: 'x' }],
    );
    const result = scopedValueChangesSchema.safeParse({ [family]: Object.fromEntries(entries) });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/at most/i);
  });

  it('refuses more gallery items than the cell cap', () => {
    const items = Object.fromEntries(Array.from({ length: SCOPED_SAVE_CELLS_MAX + 1 }, (_, i) => [UUID(i), { hidden: true }]));
    expect(scopedValueChangesSchema.safeParse({ gallery: { items } }).success).toBe(false);
  });

  it('accepts a record at the cap', () => {
    const attributes = Object.fromEntries(Array.from({ length: SCOPED_SAVE_CELLS_MAX }, (_, i) => [`attr_${i}`, 'x']));
    expect(scopedValueChangesSchema.safeParse({ attributes }).success).toBe(true);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the reserved record key %s (never drops it)', (key) => {
    const body = JSON.parse(`{"attributes":{"${key}":"x","colour":"red"}}`) as unknown;
    const result = scopedValueChangesSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/reserved/i);
  });

  it('refuses an over-long URL key before normalising it', () => {
    expect(scopedValueChangesSchema.safeParse({ urlKey: 'a'.repeat(161) }).success).toBe(false);
    expect(scopedValueChangesSchema.safeParse({ urlKey: 'A'.repeat(160) }).success).toBe(true);
    expect(scopedValueChangesSchema.safeParse({ urlKey: 'A'.repeat(100_000) }).success).toBe(false);
  });

  it('the whole save body still refuses more than the cell cap across families', () => {
    const attributes = Object.fromEntries(Array.from({ length: SCOPED_SAVE_CELLS_MAX }, (_, i) => [`attr_${i}`, 'x']));
    expect(saveScopedValuesRequestSchema.safeParse(save({ attributes, name: 'One more' })).success).toBe(false);
  });
});

describe('170 — scopedWrite inherit marker', () => {
  it('refuses a marker carrying anything else, even under a permissive value schema', () => {
    const permissive = z.object({ value: scopedWrite(z.unknown().refine((v) => v !== undefined)) });
    expect(permissive.safeParse({ value: { inherit: true, extra: 1 } }).success).toBe(false);
    expect(permissive.safeParse({ value: { inherit: false } }).success).toBe(false);
    expect(permissive.safeParse({ value: { inherit: true } }).success).toBe(true);
    expect(permissive.safeParse({ value: { other: 1 } }).success).toBe(true);
  });

  it('the connector port input refuses a malformed marker', () => {
    const result = productScopedWriteInputSchema.safeParse({
      cells: [{ scope: {}, field: 'name', value: { inherit: true, extra: 1 } }],
    });
    expect(result.success).toBe(false);
  });
});

describe('170 — fieldPathSchema subjects are strict uuids', () => {
  it.each([
    `gallery:${UUID(1)}:altText`,
    `attachment:${UUID(2)}:hidden`,
    `packagingUnit:${UUID(3)}:name`,
  ])('accepts %s', (path) => {
    expect(fieldPathSchema.safeParse(path).success).toBe(true);
  });

  it.each([
    `gallery:${'-'.repeat(36)}:altText`,
    'gallery:0000000000000000000000000000000000ab:altText',
    `attachment:${'a'.repeat(36)}:name`,
    'packagingUnit:00000000-0000-4000-8000-00000000000:name',
  ])('refuses %s', (path) => {
    expect(fieldPathSchema.safeParse(path).success).toBe(false);
  });
});

describe('170 — copy response currentValue', () => {
  it('is an own value or the empty marker, and nothing undefined', () => {
    const ok = (currentValue: unknown) =>
      copyScopedValueResponseSchema.safeParse({
        data: { overwrites: [{ channelId: UUID(1), currentValue }], applied: 0, version: '1' },
      }).success;
    expect(ok('Wiertarka')).toBe(true);
    expect(ok({ empty: true })).toBe(true);
    expect(ok(undefined)).toBe(false);
  });
});
