import { describe, expect, it } from 'vitest';
import {
  filterProtectedWrites,
  pimLocaleMappingEntriesSchema,
  pimLocaleMappingSchema,
  planLocaleWrites,
  sameSourceLocale,
  type PimLocaleMapping,
  type PimSourceValues,
} from './pim-locale-mapping.js';
import { SCOPED_WRITE_CASES, SCOPED_WRITE_CASE_FIELDS } from './scoped-write-encoding.cases.js';
import { productScopedWriteInputSchema } from './product-scopes.js';
import { validateScopedWrite } from './scoped-write-encoding.js';

/**
 * Feature 168 (`contracts/pim-locale-mapping.md` §1–§4; FR-040…FR-047; spec US4) — the mapping
 * contract shared by every PIM connector and the CSV import profiles, and the planner that turns
 * per-locale source values into scoped writes.
 */

const B2B = '00000000-0000-4000-8000-0000000000b2';
const SKLEP = '00000000-0000-4000-8000-00000000005c';
const DE_SHOP = '00000000-0000-4000-8000-0000000000de';

const validScopes = {
  channels: [
    { channelId: B2B, languages: ['pl-PL'] },
    { channelId: SKLEP, languages: ['pl-PL', 'en-US'] },
  ],
};

const mapping = (over: Partial<PimLocaleMapping> = {}): PimLocaleMapping => ({
  sourceLanguageForGlobal: null,
  entries: [
    {
      sourceLocale: 'pl_PL',
      sourceChannel: null,
      targets: [
        { channelId: B2B, languageCode: 'pl-PL' },
        { channelId: SKLEP, languageCode: 'pl' },
      ],
    },
  ],
  ...over,
});

const source = (over: Partial<PimSourceValues> = {}): PimSourceValues => ({
  global: { 'attribute:weight': 12 },
  perLocale: [
    { locale: 'pl_PL', sourceChannel: null, values: { name: 'Wiertarka', description: 'Opis' } },
    { locale: 'de_DE', sourceChannel: null, values: { name: 'Bohrmaschine' } },
  ],
  ...over,
});

describe('mapping schema (§1)', () => {
  it('accepts locale tags in PIM and BCP-47 spellings', () => {
    for (const tag of ['pl_PL', 'pl-PL', 'pl', 'fil_PH']) {
      expect(pimLocaleMappingSchema.safeParse(mapping({ sourceLanguageForGlobal: tag })).success).toBe(true);
    }
    expect(pimLocaleMappingSchema.safeParse(mapping({ sourceLanguageForGlobal: 'polish' })).success).toBe(false);
  });

  it('refuses two entries for the same (locale, source channel), compared case- and separator-insensitively', () => {
    const entry = { sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: B2B, languageCode: 'pl-PL' }] };
    expect(pimLocaleMappingEntriesSchema.safeParse([entry, { ...entry, sourceLocale: 'PL-pl' }]).success).toBe(false);
    expect(pimLocaleMappingEntriesSchema.safeParse([entry, { ...entry, sourceChannel: 'print' }]).success).toBe(true);
  });

  it('refuses an entry without targets and over-long lists', () => {
    expect(pimLocaleMappingEntriesSchema.safeParse([{ sourceLocale: 'pl', sourceChannel: null, targets: [] }]).success).toBe(false);
    const target = { channelId: B2B, languageCode: 'pl-PL' };
    expect(
      pimLocaleMappingEntriesSchema.safeParse([{ sourceLocale: 'pl', sourceChannel: null, targets: Array(65).fill(target) }]).success,
    ).toBe(false);
  });

  it('compares source locales case-insensitively with _ ≡ -', () => {
    expect(sameSourceLocale('pl_PL', 'pl-pl')).toBe(true);
    expect(sameSourceLocale('pl', 'pl_PL')).toBe(false);
  });
});

describe('planLocaleWrites (§2)', () => {
  it('US4 #1 / rule 3: a mapped locale writes each target as C×L, in the channel spelling', () => {
    const plan = planLocaleWrites({ source: source(), mapping: mapping(), validScopes });
    const names = plan.writes.filter((w) => w.field === 'name');
    expect(names).toEqual([
      { scope: { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' }, field: 'name', op: { op: 'set', value: 'Wiertarka' } },
      { scope: { level: 'channel_language', channelId: SKLEP, languageCode: 'pl-PL' }, field: 'name', op: { op: 'set', value: 'Wiertarka' } },
    ]);
  });

  it('rule 1: global values are written to Global', () => {
    const plan = planLocaleWrites({ source: source(), mapping: mapping(), validScopes });
    expect(plan.writes).toContainEqual({ scope: { level: 'global' }, field: 'attribute:weight', op: { op: 'set', value: 12 } });
  });

  it('US4 #2 / rule 4: an unmapped locale is written nowhere and reported', () => {
    const plan = planLocaleWrites({ source: source(), mapping: mapping(), validScopes });
    expect(plan.writes.some((w) => w.op.op === 'set' && w.op.value === 'Bohrmaschine')).toBe(false);
    expect(plan.unmapped).toEqual([{ locale: 'de_DE', sourceChannel: null }]);
  });

  it('US4 #3: an entry with a source channel feeds only from that channel; it wins over the generic entry', () => {
    const m = mapping({
      entries: [
        { sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: SKLEP, languageCode: 'pl-PL' }] },
        { sourceLocale: 'pl_PL', sourceChannel: 'ecommerce', targets: [{ channelId: B2B, languageCode: 'pl-PL' }] },
      ],
    });
    const plan = planLocaleWrites({
      source: {
        global: {},
        perLocale: [
          { locale: 'pl_PL', sourceChannel: 'ecommerce', values: { name: 'Sklepowa' } },
          { locale: 'pl_PL', sourceChannel: 'print', values: { name: 'Drukowana' } },
        ],
      },
      mapping: m,
      validScopes,
    });
    expect(plan.writes).toEqual([
      { scope: { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' }, field: 'name', op: { op: 'set', value: 'Sklepowa' } },
      { scope: { level: 'channel_language', channelId: SKLEP, languageCode: 'pl-PL' }, field: 'name', op: { op: 'set', value: 'Drukowana' } },
    ]);
    expect(plan.unmapped).toEqual([]);
  });

  it('an entry with a source channel does not match values from another source channel', () => {
    const m = mapping({
      entries: [{ sourceLocale: 'pl_PL', sourceChannel: 'ecommerce', targets: [{ channelId: B2B, languageCode: 'pl-PL' }] }],
    });
    const plan = planLocaleWrites({
      source: { global: {}, perLocale: [{ locale: 'pl_PL', sourceChannel: 'print', values: { name: 'x' } }] },
      mapping: m,
      validScopes,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.unmapped).toEqual([{ locale: 'pl_PL', sourceChannel: 'print' }]);
  });

  it('US4 #5 / rule 5: a target the product is not valid for is skipped; the others are written', () => {
    const m = mapping({
      entries: [
        {
          sourceLocale: 'pl_PL',
          sourceChannel: null,
          targets: [
            { channelId: B2B, languageCode: 'pl-PL' },
            { channelId: DE_SHOP, languageCode: 'pl-PL' },
            { channelId: B2B, languageCode: 'en-US' },
          ],
        },
      ],
    });
    const plan = planLocaleWrites({ source: source(), mapping: m, validScopes });
    expect(plan.skipped).toEqual([
      { scope: { level: 'channel_language', channelId: DE_SHOP, languageCode: 'pl-PL' }, reason: 'not_a_member' },
      { scope: { level: 'channel_language', channelId: B2B, languageCode: 'en-US' }, reason: 'language_not_offered' },
    ]);
    expect(plan.writes.filter((w) => w.field === 'name').map((w) => w.scope)).toEqual([
      { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' },
    ]);
  });

  it('US4 #8 / rule 2: the source language for Global writes Global, and its mapped targets too', () => {
    const plan = planLocaleWrites({
      source: {
        global: { 'attribute:weight': 12 },
        perLocale: [
          { locale: 'en_US', sourceChannel: null, values: { name: 'Drill' } },
          { locale: 'pl_PL', sourceChannel: null, values: { name: 'Wiertarka' } },
        ],
      },
      mapping: mapping({
        sourceLanguageForGlobal: 'en-US',
        entries: [
          { sourceLocale: 'en_US', sourceChannel: null, targets: [{ channelId: SKLEP, languageCode: 'en-US' }] },
          { sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: B2B, languageCode: 'pl-PL' }] },
        ],
      }),
      validScopes,
    });
    expect(plan.writes).toContainEqual({ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Drill' } });
    expect(plan.writes).toContainEqual({ scope: { level: 'global' }, field: 'attribute:weight', op: { op: 'set', value: 12 } });
    expect(plan.writes).toContainEqual({
      scope: { level: 'channel_language', channelId: SKLEP, languageCode: 'en-US' },
      field: 'name',
      op: { op: 'set', value: 'Drill' },
    });
    expect(plan.unmapped).toEqual([]);
  });

  it('the source language for Global without an entry writes Global only and is not unmapped', () => {
    const plan = planLocaleWrites({
      source: { global: {}, perLocale: [{ locale: 'en_US', sourceChannel: null, values: { name: 'Drill' } }] },
      mapping: mapping({ sourceLanguageForGlobal: 'en_US', entries: [] }),
      validScopes,
    });
    expect(plan.writes).toEqual([{ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Drill' } }]);
    expect(plan.unmapped).toEqual([]);
  });

  it('rule 6: a field without a C×L level is written at the target channel, never at C×L', () => {
    const plan = planLocaleWrites({
      source: { global: {}, perLocale: [{ locale: 'pl_PL', sourceChannel: null, values: { status: 'active', 'attribute:size': 3 } }] },
      mapping: mapping({ entries: [{ sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: B2B, languageCode: 'pl-PL' }] }] }),
      validScopes,
      fieldLevels: (field) => (field === 'attribute:size' ? ['G', 'C'] : undefined),
    });
    expect(plan.writes).toEqual([
      { scope: { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' }, field: 'status', op: { op: 'set', value: 'active' } },
      { scope: { level: 'channel', channelId: B2B }, field: 'attribute:size', op: { op: 'set', value: 3 } },
    ]);
  });

  it('rule 7: two generic groups on one (field, scope) — the first entry in mapping order wins', () => {
    const plan = planLocaleWrites({
      source: {
        global: {},
        perLocale: [
          { locale: 'pl', sourceChannel: null, values: { name: 'z pl' } },
          { locale: 'pl_PL', sourceChannel: null, values: { name: 'z pl_PL' } },
        ],
      },
      mapping: mapping({
        entries: [
          { sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: B2B, languageCode: 'pl-PL' }] },
          { sourceLocale: 'pl', sourceChannel: null, targets: [{ channelId: B2B, languageCode: 'pl-PL' }] },
        ],
      }),
      validScopes,
    });
    expect(plan.writes).toEqual([
      { scope: { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' }, field: 'name', op: { op: 'set', value: 'z pl_PL' } },
    ]);
  });

  it('passes decoded ops through unchanged (empty and inherit)', () => {
    const plan = planLocaleWrites({
      source: { global: {}, perLocale: [{ locale: 'pl_PL', sourceChannel: null, values: { description: { op: 'empty' }, name: { op: 'inherit' } } }] },
      mapping: mapping({ entries: [{ sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: B2B, languageCode: 'pl-PL' }] }] }),
      validScopes,
    });
    expect(plan.writes.map((w) => [w.field, w.op])).toEqual([
      ['description', { op: 'empty' }],
      ['name', { op: 'inherit' }],
    ]);
  });
});

describe('filterProtectedWrites (§3, FR-046)', () => {
  it('a protected path removes every scope of the field', () => {
    const plan = planLocaleWrites({ source: source(), mapping: mapping({ sourceLanguageForGlobal: 'pl_PL' }), validScopes });
    const { kept, protected: count } = filterProtectedWrites(plan.writes, ['name']);
    expect(kept.some((w) => w.field === 'name')).toBe(false);
    expect(count).toBe(3);
    expect(kept.some((w) => w.field === 'description')).toBe(true);
  });

  it('maps attribute and SEO-free paths; no protection keeps everything (US4 #7)', () => {
    const writes = [
      { field: 'attribute:weight' as const },
      { field: 'name' as const },
    ];
    expect(filterProtectedWrites(writes, ['attribute.weight']).kept).toEqual([{ field: 'name' }]);
    expect(filterProtectedWrites(writes, []).kept).toEqual(writes);
  });
});

describe('the shared encoding cases through the connector input (§4, SC-014)', () => {
  const json = SCOPED_WRITE_CASES.filter((c) => 'json' in c);

  for (const c of json) {
    it(c.name, () => {
      const scope =
        c.level === 'G'
          ? {}
          : c.level === 'C'
            ? { channelId: B2B }
            : { channelId: B2B, languageCode: 'pl-PL' };
      const parsed = productScopedWriteInputSchema.safeParse({ cells: [{ scope, field: c.field, value: c.json }] });
      if (c.expect === 'no_change') {
        expect(parsed.success).toBe(true);
        expect(parsed.data!.cells[0]!.op).toBeUndefined();
        return;
      }
      expect(parsed.success).toBe(true);
      const op = parsed.data!.cells[0]!.op!;
      const refusal = validateScopedWrite(SCOPED_WRITE_CASE_FIELDS[c.field], op, c.level);
      if (typeof c.expect === 'string') expect(refusal).toBe(c.expect);
      else {
        expect(refusal).toBeNull();
        expect(op).toEqual(c.expect);
      }
    });
  }

  it('refuses more than 2 000 cells and a malformed field path', () => {
    const cell = { scope: {}, field: 'name', value: 'x' };
    expect(productScopedWriteInputSchema.safeParse({ cells: Array(2001).fill(cell) }).success).toBe(false);
    expect(productScopedWriteInputSchema.safeParse({ cells: [{ ...cell, field: 'name.pl' }] }).success).toBe(false);
    expect(productScopedWriteInputSchema.safeParse({ cells: [{ ...cell, scope: { languageCode: 'pl' } }] }).success).toBe(false);
  });
});
