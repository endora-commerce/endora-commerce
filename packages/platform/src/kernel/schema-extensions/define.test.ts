import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineColumnExtension, isColumnExtension, resolvedColumnExtension } from './define.js';
import { SchemaExtensionInvalidError } from './errors.js';
import { columnExtensionPatchSchema, columnExtensionSchema } from './zod.js';
import type { ColumnExtensionPatch, ColumnExtensionValues } from './types.js';

/**
 * `specs/178-extensible-columns/` FR-001 – FR-003: the declaration, its inferred
 * value types (one row per type of `data-model.md` §3) and the Zod schemas that
 * must accept and refuse the same values.
 */

const everyType = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  columns: {
    note: { type: 'text', nullable: true },
    code: { type: 'varchar', length: 8, default: '' },
    flag: { type: 'boolean', default: false },
    tier: { type: 'smallint', default: 0 },
    count: { type: 'integer', nullable: true },
    big: { type: 'bigint', default: '0' },
    amount: { type: 'numeric', precision: 6, scale: 2, nullable: true },
    day: { type: 'date', nullable: true },
    at: { type: 'timestamptz', nullable: true },
    ref: { type: 'uuid', nullable: true },
    meta: { type: 'jsonb', nullable: true, schema: z.object({ tags: z.array(z.string()) }) },
  },
});

describe('defineColumnExtension — inferred types', () => {
  it('infers one value type per column spec', () => {
    expectTypeOf<ColumnExtensionValues<typeof everyType>>().toEqualTypeOf<{
      note: string | null;
      code: string;
      flag: boolean;
      tier: number;
      count: number | null;
      big: string;
      amount: string | null;
      day: string | null;
      at: Date | null;
      ref: string | null;
      meta: { tags: string[] } | null;
    }>();
  });

  it('makes the patch a partial of the values', () => {
    expectTypeOf<ColumnExtensionPatch<typeof everyType>>().toEqualTypeOf<
      Partial<ColumnExtensionValues<typeof everyType>>
    >();
  });

  it('keeps host, module and id literal', () => {
    expectTypeOf(everyType.host).toEqualTypeOf<'organizations'>();
    expectTypeOf(everyType.module).toEqualTypeOf<'acme_erp'>();
    expectTypeOf(everyType.id).toEqualTypeOf<'acme_erp:organizations'>();
  });

  it('refuses a host that is not a custom-field host table, at compile time and at import', () => {
    // @ts-expect-error `invoices` is not an extensible host table.
    expect(() => defineColumnExtension({ host: 'invoices', module: 'acme_erp', columns: {} })).toThrow(
      /host-not-extensible/,
    );
  });
});

describe('defineColumnExtension — the value', () => {
  it('is frozen, branded and defaults adminReads to false (OD-178-5)', () => {
    expect(Object.isFrozen(everyType)).toBe(true);
    expect(Object.isFrozen(everyType.columns)).toBe(true);
    expect(isColumnExtension(everyType)).toBe(true);
    expect(isColumnExtension({ ...everyType })).toBe(false);
    expect(everyType.adminReads).toBe(false);
    expect(everyType.id).toBe('acme_erp:organizations');
  });

  it('resolves physical names and the normalised spec', () => {
    const resolved = resolvedColumnExtension(everyType);
    const code = resolved.columns.find((c) => c.key === 'code')!;
    expect(code.physicalName).toBe('x_acme_erp_code');
    expect(code.spec).toEqual({ type: 'varchar', length: 8, nullable: false, default: '', index: false });
    expect(JSON.stringify(code.spec)).toBe(
      '{"type":"varchar","length":8,"nullable":false,"default":"","index":false}',
    );
    const meta = resolved.columns.find((c) => c.key === 'meta')!;
    expect(meta.spec).toEqual({ type: 'jsonb', nullable: true, default: null, index: false });
  });
});

describe('columnExtensionSchema / columnExtensionPatchSchema', () => {
  const schema = columnExtensionSchema(everyType);
  const patch = columnExtensionPatchSchema(everyType);
  const valid = {
    note: null,
    code: 'ABCDEFGH',
    flag: true,
    tier: -32768,
    count: 2147483647,
    big: '-9223372036854775808',
    amount: '1234.56',
    day: '2026-11-10',
    at: new Date('2026-11-10T10:00:00Z'),
    ref: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01',
    meta: { tags: ['a'] },
  };

  it('accepts a full valid value set', () => {
    expect(schema.parse(valid)).toEqual(valid);
  });

  it('refuses what the column cannot store', () => {
    const refusals: Record<string, unknown> = {
      code: 'ABCDEFGHI',
      tier: 32768,
      count: 2147483648,
      big: '1.5',
      amount: '12345.6',
      day: '2026-13-01',
      at: '2026-11-10T10:00:00Z',
      ref: 'not-a-uuid',
      meta: { tags: [1] },
      flag: null,
    };
    for (const [key, value] of Object.entries(refusals)) {
      expect(patch.safeParse({ [key]: value }).success, key).toBe(false);
      expect(schema.safeParse({ ...valid, [key]: value }).success, key).toBe(false);
    }
  });

  it('takes a partial patch and refuses an undeclared key', () => {
    expect(patch.parse({ code: 'X' })).toEqual({ code: 'X' });
    expect(patch.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('accepts null only for nullable columns', () => {
    expect(patch.safeParse({ note: null }).success).toBe(true);
    expect(patch.safeParse({ code: null }).success).toBe(false);
  });
});

/** Review finding 2 — a key the projection itself maps would overwrite the PK or the tenant key. */
describe('defineColumnExtension — reserved keys', () => {
  it.each(['id', 'organizationId'])('refuses the key %s', (key) => {
    let thrown: unknown;
    try {
      defineColumnExtension({
        host: 'organizations',
        module: 'acme_erp',
        columns: { [key]: { type: 'uuid', nullable: true } },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaExtensionInvalidError);
    expect((thrown as SchemaExtensionInvalidError).rule).toBe('key');
    expect((thrown as Error).message).toMatch(/reserved/);
  });
});
