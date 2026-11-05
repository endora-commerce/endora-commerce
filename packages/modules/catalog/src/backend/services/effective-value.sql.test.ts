import { describe, expect, it } from 'vitest';
import { effectiveAttributeSql, effectiveTextSql } from './effective-value.sql.js';

/**
 * Feature 163 (T060), rewritten by feature 174 (T033; research R1, R22) — the shape of the
 * effective-value expressions over the C×L → C → G chain: one placeholder per bound value, the
 * values in placeholder order, nothing spliced into the text, and the empty override detected by
 * `jsonb_typeof(value -> 'v')`, never by `->>`. Their meaning is held to the TypeScript chain by
 * `effective-text-parity.test.ts` [PG].
 */

const CHANNEL = '11111111-1111-4111-8111-111111111111';
const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

describe('effectiveTextSql', () => {
  it.each([['pl-PL'], [null]])('binds exactly its placeholders at language %j', (languageCode) => {
    const e = effectiveTextSql('name', { channelId: CHANNEL, languageCode });
    const sql = e.sql('p0');
    expect(placeholders(sql)).toBe(e.params.length);
    expect(sql).not.toContain(CHANNEL);
    expect(sql).toContain('p0.name');
    expect(sql).toContain('product_value_overrides');
    // The C×L row is read only when the scope names a language.
    expect(e.params).toEqual(languageCode === null ? ['name', CHANNEL] : ['name', CHANNEL, 'pl-PL', 'name', CHANNEL]);
  });

  it('renders the same params whatever the alias', () => {
    const e = effectiveTextSql('description', { channelId: CHANNEL, languageCode: 'pl-PL' });
    expect(placeholders(e.sql('x'))).toBe(placeholders(e.sql('p0')));
  });

  it('answers an empty override by its JSON type, never with ->> on the value', () => {
    const sql = effectiveTextSql('description', { channelId: CHANNEL, languageCode: 'pl-PL' }).sql('p0');
    expect(sql).toContain("jsonb_typeof(x.cl -> 'v') = 'string'");
    expect(sql).not.toMatch(/value ->> 'v'/);
  });
});

describe('effectiveAttributeSql', () => {
  it.each([[['G', 'C', 'CL'] as const], [['G', 'C'] as const], [['G'] as const]])(
    'binds exactly its placeholders for the scope set %j',
    (levels) => {
      const e = effectiveAttributeSql('color', levels, { channelId: CHANNEL, languageCode: 'pl-PL' });
      const sql = e.sql('p0');
      expect(placeholders(sql)).toBe(e.params.length);
      expect(sql).not.toContain("'color'");
    },
  );

  it('is the Global value alone for a {G} attribute', () => {
    const e = effectiveAttributeSql('color', ['G'], { channelId: CHANNEL, languageCode: 'pl-PL' });
    expect(e.sql('p0')).toBe('(p0.attribute_values -> ?::text)');
    expect(e.params).toEqual(['color']);
  });

  it('reads no C×L row for a {G,C} attribute', () => {
    const e = effectiveAttributeSql('size', ['G', 'C'], { channelId: CHANNEL, languageCode: 'pl-PL' });
    expect(e.params).not.toContain('pl-PL');
  });
});
