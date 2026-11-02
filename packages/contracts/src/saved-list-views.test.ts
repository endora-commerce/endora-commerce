import { describe, expect, it, vi } from 'vitest';
import {
  SAVED_LIST_VIEW_COLUMNS_MAX,
  SAVED_LIST_VIEW_FILTERS_MAX_BYTES,
  SAVED_LIST_VIEW_NAME_MAX,
  SAVED_LIST_VIEW_TOKEN_MAX,
  createProductSavedViewRequestSchema,
  createQuoteRequestSavedViewRequestSchema,
  createReturnSavedViewRequestSchema,
  hasForbiddenNameCharacters,
  savedListViewNameKey,
  savedListViewNameSchema,
  savedListViewSchema,
  updateProductSavedViewRequestSchema,
  updateQuoteRequestSavedViewRequestSchema,
  updateReturnSavedViewRequestSchema,
} from './saved-list-views.js';

const VIEW_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';

const ITEM = {
  id: VIEW_ID,
  name: 'Unpaid EU',
  shared: false,
  ownerAdminUserId: OWNER_ID,
  ownedByCaller: true,
  canModify: true,
  filters: { status: 'new' },
};

/** A `filters` object whose `JSON.stringify` is exactly `bytes` UTF-8 bytes long. */
function filtersOfBytes(bytes: number, fill = 'x', fillBytes = 1): Record<string, unknown> {
  // `{"k":""}` is 8 bytes of envelope.
  const payload = bytes - 8;
  return { k: fill.repeat(Math.floor(payload / fillBytes)) + 'x'.repeat(payload % fillBytes) };
}

const BASE_CREATE = { name: 'Unpaid EU', shared: false, filters: {} };

describe('savedListViewNameSchema (FR-003, S-06)', () => {
  it('trims the name', () => {
    expect(savedListViewNameSchema.parse('  a  ')).toBe('a');
  });

  it('rejects an empty and a whitespace-only name', () => {
    expect(savedListViewNameSchema.safeParse('').success).toBe(false);
    expect(savedListViewNameSchema.safeParse('   ').success).toBe(false);
  });

  it('accepts exactly 160 characters and rejects 161', () => {
    expect(SAVED_LIST_VIEW_NAME_MAX).toBe(160);
    expect(savedListViewNameSchema.safeParse('a'.repeat(160)).success).toBe(true);
    expect(savedListViewNameSchema.safeParse('a'.repeat(161)).success).toBe(false);
  });

  it('measures the limit after trimming', () => {
    expect(savedListViewNameSchema.safeParse(`  ${'a'.repeat(160)}  `).success).toBe(true);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['right-to-left override', 'a‮b'],
    ['zero-width space', 'a​b'],
  ])('rejects a name containing a %s', (_label, name) => {
    expect(hasForbiddenNameCharacters(name)).toBe(true);
    expect(savedListViewNameSchema.safeParse(name).success).toBe(false);
  });

  it('accepts Polish letters and emoji', () => {
    for (const name of ['Zaległe zamówienia — ŁÓDŹ', 'Pilne 🚀']) {
      expect(hasForbiddenNameCharacters(name)).toBe(false);
      expect(savedListViewNameSchema.parse(name)).toBe(name);
    }
  });
});

describe('savedListViewNameKey (FR-022)', () => {
  it('compares names trimmed and case-insensitively', () => {
    expect(savedListViewNameKey(' Unpaid EU ')).toBe(savedListViewNameKey('unpaid eu'));
  });

  it('keeps names that differ by more than case and whitespace apart', () => {
    expect(savedListViewNameKey('Unpaid EU')).not.toBe(savedListViewNameKey('Unpaid US'));
  });

  it('does not depend on the host locale, as SQL lower() does not', () => {
    // A Turkish default locale lower-cases `I` to dotless `ı`; the server's
    // `lower(btrim(name))` does not, so the client key must not either.
    const original = String.prototype.toLocaleLowerCase;
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) {
      return original.call(this, 'tr-TR');
    });
    try {
      expect(savedListViewNameKey(' Invoices ')).toBe('invoices');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('savedListViewSchema (R-8, R-9)', () => {
  it('accepts an item without sort and visibleColumns', () => {
    const parsed = savedListViewSchema.parse(ITEM);
    expect(parsed.sort).toBeUndefined();
    expect(parsed.visibleColumns).toBeUndefined();
  });

  it('accepts sort and visibleColumns as null', () => {
    const parsed = savedListViewSchema.parse({ ...ITEM, sort: null, visibleColumns: null });
    expect(parsed.sort).toBeNull();
    expect(parsed.visibleColumns).toBeNull();
  });

  it('keeps sort and visibleColumns when present', () => {
    const parsed = savedListViewSchema.parse({
      ...ITEM,
      sort: { field: 'createdAt', dir: 'desc' },
      visibleColumns: ['number', 'status'],
    });
    expect(parsed.sort).toEqual({ field: 'createdAt', dir: 'desc' });
    expect(parsed.visibleColumns).toEqual(['number', 'status']);
  });

  it('requires ownedByCaller and canModify', () => {
    const { ownedByCaller: _o, ...withoutOwned } = ITEM;
    const { canModify: _c, ...withoutCanModify } = ITEM;
    expect(savedListViewSchema.safeParse(withoutOwned).success).toBe(false);
    expect(savedListViewSchema.safeParse(withoutCanModify).success).toBe(false);
  });
});

describe('product saved-view requests (R-9)', () => {
  it('strips sort and visibleColumns on create', () => {
    const parsed = createProductSavedViewRequestSchema.parse({
      ...BASE_CREATE,
      sort: { field: 'name', dir: 'asc' },
      visibleColumns: ['name'],
    });
    expect(parsed).not.toHaveProperty('sort');
    expect(parsed).not.toHaveProperty('visibleColumns');
  });

  it('trims the name on create', () => {
    expect(createProductSavedViewRequestSchema.parse({ ...BASE_CREATE, name: ' a ' }).name).toBe(
      'a',
    );
  });

  it('is partial on update', () => {
    expect(updateProductSavedViewRequestSchema.parse({})).toEqual({});
    expect(updateProductSavedViewRequestSchema.parse({ shared: true })).toEqual({ shared: true });
    expect(updateProductSavedViewRequestSchema.parse({ name: ' b ' })).toEqual({ name: 'b' });
  });
});

describe('quote-request saved-view requests (R-9)', () => {
  it('keeps sort and visibleColumns on create', () => {
    const parsed = createQuoteRequestSavedViewRequestSchema.parse({
      ...BASE_CREATE,
      sort: { field: 'createdAt', dir: 'desc' },
      visibleColumns: ['number'],
    });
    expect(parsed.sort).toEqual({ field: 'createdAt', dir: 'desc' });
    expect(parsed.visibleColumns).toEqual(['number']);
  });

  it('accepts sort and visibleColumns as null or absent', () => {
    expect(createQuoteRequestSavedViewRequestSchema.safeParse(BASE_CREATE).success).toBe(true);
    expect(
      createQuoteRequestSavedViewRequestSchema.safeParse({
        ...BASE_CREATE,
        sort: null,
        visibleColumns: null,
      }).success,
    ).toBe(true);
  });

  it('is partial on update', () => {
    expect(updateQuoteRequestSavedViewRequestSchema.parse({})).toEqual({});
    expect(updateQuoteRequestSavedViewRequestSchema.parse({ name: ' b ' })).toEqual({ name: 'b' });
  });
});

describe('return saved-view requests (#312)', () => {
  const SORT = { field: 'submittedAt', dir: 'desc' } as const;

  it('requires shared and sort on create, as the order list does', () => {
    expect(createReturnSavedViewRequestSchema.safeParse({ ...BASE_CREATE, sort: SORT }).success).toBe(true);
    expect(createReturnSavedViewRequestSchema.safeParse(BASE_CREATE).success).toBe(false);
    expect(
      createReturnSavedViewRequestSchema.safeParse({ name: 'a', filters: {}, sort: SORT }).success,
    ).toBe(false);
  });

  it('keeps visibleColumns, absent or null', () => {
    const parsed = createReturnSavedViewRequestSchema.parse({ ...BASE_CREATE, sort: SORT, visibleColumns: ['rma'] });
    expect(parsed.visibleColumns).toEqual(['rma']);
    expect(
      createReturnSavedViewRequestSchema.safeParse({ ...BASE_CREATE, sort: SORT, visibleColumns: null }).success,
    ).toBe(true);
  });

  it('is partial on update', () => {
    expect(updateReturnSavedViewRequestSchema.parse({})).toEqual({});
    expect(updateReturnSavedViewRequestSchema.parse({ name: ' b ' })).toEqual({ name: 'b' });
  });
});

describe('write bounds on every create and update schema (S-05, S-06)', () => {
  /** The return list's create, like the order list's, always carries a sort. */
  const WITH_SORT = { sort: { field: 'submittedAt', dir: 'desc' } } as const;
  const schemas = [
    ['createProductSavedViewRequestSchema', createProductSavedViewRequestSchema, true, {}],
    ['updateProductSavedViewRequestSchema', updateProductSavedViewRequestSchema, true, {}],
    ['createQuoteRequestSavedViewRequestSchema', createQuoteRequestSavedViewRequestSchema, false, {}],
    ['updateQuoteRequestSavedViewRequestSchema', updateQuoteRequestSavedViewRequestSchema, false, {}],
    ['createReturnSavedViewRequestSchema', createReturnSavedViewRequestSchema, false, WITH_SORT],
    ['updateReturnSavedViewRequestSchema', updateReturnSavedViewRequestSchema, false, {}],
  ] as const;

  it('exports the bounds', () => {
    expect(SAVED_LIST_VIEW_FILTERS_MAX_BYTES).toBe(8192);
    expect(SAVED_LIST_VIEW_COLUMNS_MAX).toBe(64);
    expect(SAVED_LIST_VIEW_TOKEN_MAX).toBe(64);
  });

  it('builds the filters fixtures at the intended size', () => {
    expect(JSON.stringify(filtersOfBytes(8192)).length).toBe(8192);
    // 2-byte letters: under the cap in characters, over it in bytes.
    const polish = JSON.stringify(filtersOfBytes(8194, 'ł', 2));
    expect(polish.length).toBeLessThan(8192);
  });

  for (const [label, schema, stripsListState, extra] of schemas) {
    const BASE_CREATE = { name: 'Unpaid EU', shared: false, filters: {}, ...extra };
    describe(label, () => {
      it('rejects a name with a control or format character', () => {
        expect(schema.safeParse({ ...BASE_CREATE, name: 'a‮b' }).success).toBe(false);
      });

      it('rejects a whitespace-only name and a 161-character name', () => {
        expect(schema.safeParse({ ...BASE_CREATE, name: '   ' }).success).toBe(false);
        expect(schema.safeParse({ ...BASE_CREATE, name: 'a'.repeat(161) }).success).toBe(false);
      });

      it('accepts filters at the byte cap and rejects one byte over', () => {
        expect(schema.safeParse({ ...BASE_CREATE, filters: filtersOfBytes(8192) }).success).toBe(
          true,
        );
        expect(schema.safeParse({ ...BASE_CREATE, filters: filtersOfBytes(8193) }).success).toBe(
          false,
        );
      });

      it('counts filters in UTF-8 bytes, not characters', () => {
        expect(
          schema.safeParse({ ...BASE_CREATE, filters: filtersOfBytes(8194, 'ł', 2) }).success,
        ).toBe(false);
      });

      if (!stripsListState) {
        it('bounds visibleColumns to 64 entries of 64 characters', () => {
          const ok = Array.from({ length: 64 }, (_, i) => `${i}`.padEnd(64, 'c'));
          expect(schema.safeParse({ ...BASE_CREATE, visibleColumns: ok }).success).toBe(true);
          expect(
            schema.safeParse({ ...BASE_CREATE, visibleColumns: [...ok, 'extra'] }).success,
          ).toBe(false);
          expect(
            schema.safeParse({ ...BASE_CREATE, visibleColumns: ['c'.repeat(65)] }).success,
          ).toBe(false);
        });

        it('bounds sort.field to 64 characters', () => {
          expect(
            schema.safeParse({ ...BASE_CREATE, sort: { field: 'f'.repeat(64), dir: 'asc' } })
              .success,
          ).toBe(true);
          expect(
            schema.safeParse({ ...BASE_CREATE, sort: { field: 'f'.repeat(65), dir: 'asc' } })
              .success,
          ).toBe(false);
        });
      }
    });
  }
});
