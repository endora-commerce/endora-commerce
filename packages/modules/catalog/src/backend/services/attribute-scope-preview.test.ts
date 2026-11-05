import { describe, expect, it } from 'vitest';
import { attributeScopeChangePreviewResponseSchema } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  AttributeScopePreviewService,
  parseScopeChangeQuery,
  slotsOrphanedByScopeChange,
} from './attribute-scope-preview.js';

/**
 * Feature 163, Phase 9 (T071), on feature 174's one flag (R15) — the FR-090 preview of an
 * attribute's scope change. A row becomes orphaned when the current scope set lets the resolver
 * read it and the requested one does not: a C row needs `C`, a C×L row `CL`. A text → non-text
 * value-type change orphans the C×L rows (feature 174 T042, R15).
 */

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const text = ['G', 'C', 'CL'] as const;
const nonText = ['G', 'C'] as const;
const globalOnly = ['G'] as const;

describe('slotsOrphanedByScopeChange (FR-090, 174 R15)', () => {
  it('scopable text → not scopable orphans both slots; non-text the channel slot', () => {
    expect(slotsOrphanedByScopeChange(text, globalOnly)).toEqual({ channel: true, channelLanguage: true });
    expect(slotsOrphanedByScopeChange(nonText, globalOnly)).toEqual({ channel: true, channelLanguage: false });
  });

  it('text → non-text orphans the C×L slot only', () => {
    expect(slotsOrphanedByScopeChange(text, nonText)).toEqual({ channel: false, channelLanguage: true });
  });

  it('a widening or no change orphans nothing', () => {
    const none = { channel: false, channelLanguage: false };
    for (const [from, to] of [
      [globalOnly, text],
      [nonText, text],
      [text, text],
    ] as const) {
      expect(slotsOrphanedByScopeChange(from, to)).toEqual(none);
    }
  });
});

describe('parseScopeChangeQuery', () => {
  const current = { scopable: true, valueType: 'string' as const };

  it('reads "true"/"false"; an absent flag keeps the current one', () => {
    expect(parseScopeChangeQuery({ scopable: 'false' }, current)).toEqual({ scopable: false, valueType: 'string' });
    expect(parseScopeChangeQuery({}, current)).toEqual(current);
  });

  it('reads a requested value type; an absent one keeps the current type (T042)', () => {
    expect(parseScopeChangeQuery({ valueType: 'number' }, current)).toEqual({ scopable: true, valueType: 'number' });
    expect(parseScopeChangeQuery({ scopable: 'false', valueType: 'select' }, current)).toEqual({
      scopable: false,
      valueType: 'select',
    });
  });

  it('refuses anything else with VALIDATION_FAILED', () => {
    expect(() => parseScopeChangeQuery({ scopable: 'yes' }, current)).toThrow(HttpError);
    expect(() => parseScopeChangeQuery({ scopable: '1' }, current)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_FAILED' }),
    );
    expect(() => parseScopeChangeQuery({ valueType: 'colour' }, current)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_FAILED', details: { field: 'valueType' } }),
    );
  });
});

describe('AttributeScopePreviewService.preview', () => {
  function service(opts: {
    attribute: { key: string; scopable: boolean; valueType: string } | null;
    rows?: Array<{ channel_id: string; n: string }>;
    sql?: Array<{ sql: string; params: unknown[] }>;
  }) {
    const em = {
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          opts.sql?.push({ sql, params });
          return opts.rows ?? [];
        },
      }),
    };
    return new AttributeScopePreviewService(() => em as never, {
      getByIdOrKey: async () => opts.attribute as never,
    });
  }

  it('answers 404 NOT_FOUND for an unknown attribute or a system one (not a row)', async () => {
    await expect(service({ attribute: null }).preview('name', {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('a widening answers 0 without reading the overrides', async () => {
    const sql: Array<{ sql: string; params: unknown[] }> = [];
    const out = await service({ attribute: { key: 'color', scopable: false, valueType: 'string' }, sql }).preview('color', {
      scopable: 'true',
    });
    expect(out).toEqual({ orphanedOverrides: 0, byChannel: [] });
    expect(sql).toHaveLength(0);
  });

  it('a narrowing counts per channel and totals', async () => {
    const sql: Array<{ sql: string; params: unknown[] }> = [];
    const out = await service({
      attribute: { key: 'color', scopable: true, valueType: 'number' },
      rows: [
        { channel_id: C1, n: '3' },
        { channel_id: C2, n: '1' },
      ],
      sql,
    }).preview('color', { scopable: 'false' });
    expect(() => attributeScopeChangePreviewResponseSchema.parse({ data: out })).not.toThrow();
    expect(out).toEqual({
      orphanedOverrides: 4,
      byChannel: [
        { channelId: C1, count: 3 },
        { channelId: C2, count: 1 },
      ],
    });
    expect(sql).toHaveLength(1);
    expect(sql[0]!.params).toContain('color');
    // A non-text scopable attribute holds C rows only: the channel slot is what goes.
    expect(sql[0]!.sql).toMatch(/language_code is null/);
  });

  it('a text \u2192 non-text value-type change counts the C\u00d7L rows only (T042, R15)', async () => {
    const sql: Array<{ sql: string; params: unknown[] }> = [];
    const out = await service({
      attribute: { key: 'material', scopable: true, valueType: 'string' },
      rows: [{ channel_id: C1, n: '2' }],
      sql,
    }).preview('material', { valueType: 'select' });
    expect(out).toEqual({ orphanedOverrides: 2, byChannel: [{ channelId: C1, count: 2 }] });
    expect(sql).toHaveLength(1);
    expect(sql[0]!.sql).toMatch(/language_code is not null/);
  });

  it('a non-text \u2192 text change, or a change between two non-text types, orphans nothing', async () => {
    for (const [from, to] of [
      ['number', 'string'],
      ['number', 'date'],
    ] as const) {
      const sql: Array<{ sql: string; params: unknown[] }> = [];
      const out = await service({ attribute: { key: 'k', scopable: true, valueType: from }, sql }).preview('k', { valueType: to });
      expect(out).toEqual({ orphanedOverrides: 0, byChannel: [] });
      expect(sql).toHaveLength(0);
    }
  });
});
