import { describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema, type FormDefinitionInput } from '@endora-commerce/contracts';
import { EXPORT_BATCH_SIZE, entriesCsv, exportColumns, type ExportEntry } from './entry-export.js';

/**
 * `specs/170-forms-module/` T073 — the CSV export of a form's entries (US4-4, FR-052, research R-18):
 * the metadata columns, then one column per field key across **every** version of the form, an
 * address expanded into its parts, a checkbox group joined, a consent as yes/no; every cell a
 * spreadsheet would read as a formula neutralised; a UTF-8 byte-order mark; and the entries read
 * lazily, in batches of 500, so the export holds one batch in memory however many there are.
 */

const parts = (enabled: Partial<Record<'line2' | 'postalCode' | 'country', boolean>>) => ({
  street: { enabled: true as const, required: false },
  line2: { enabled: enabled.line2 ?? false, required: false },
  postalCode: { enabled: enabled.postalCode ?? false, required: false },
  city: { enabled: true as const, required: false },
  country: { enabled: enabled.country ?? false, required: false },
});

function version(fields: FormDefinitionInput['sections'][number]['fields']) {
  return formDefinitionSchema.parse({
    schemaVersion: 1,
    sections: [{ id: 's1', columns: 1, fields }],
    behaviour: { confirmation: { type: 'message' }, captchaRequired: false, confirmationEmail: { enabled: false, includeSummary: false } },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts: {},
  });
}

const V1 = version([
  { id: 'f1', type: 'text', key: 'name' },
  { id: 'f2', type: 'email', key: 'email' },
  { id: 'f3', type: 'address', key: 'address', parts: parts({ postalCode: true }) },
  { id: 'f4', type: 'checkboxes', key: 'tags', options: [{ id: 'o1', value: 'doors' }, { id: 'o2', value: 'windows' }] },
  { id: 'f5', type: 'content' },
  { id: 'f6', type: 'privacy_consent', key: 'privacy', required: true },
]);
const V2 = version([
  { id: 'f1', type: 'text', key: 'name' },
  { id: 'f7', type: 'number', key: 'qty' },
  { id: 'f3', type: 'address', key: 'address', parts: parts({ country: true }) },
  { id: 'f8', type: 'marketing_consent', key: 'news' },
]);

const META = ['entry_id', 'form_key', 'form_version', 'status', 'sales_channel', 'language', 'submitted_at', 'page_url'];

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    formVersionNumber: 1,
    status: 'new',
    salesChannelId: 'channel-1',
    language: 'en-US',
    submittedAt: new Date('2026-10-01T12:00:00.000Z'),
    pageUrl: '/contact',
    answers: {},
    ...overrides,
  };
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of chunks) out += chunk;
  return out;
}

const csvOf = (entries: ExportEntry[]) =>
  collect(
    entriesCsv({
      columns: exportColumns([
        { number: 1, definition: V1 },
        { number: 2, definition: V2 },
      ]),
      formKey: 'contact',
      channelLabel: (id) => (id === 'channel-1' ? 'default' : id),
      readBatch: async (after) => (after === null ? entries : []),
    }),
  );

const rowsOf = (csv: string) => csv.replace(/^﻿/, '').split('\r\n').filter((line) => line !== '');

describe('exportColumns', () => {
  it('puts the metadata first, then every key of every version once, address parts expanded', () => {
    const columns = exportColumns([
      { number: 1, definition: V1 },
      { number: 2, definition: V2 },
    ]);
    expect(columns.map((column) => column.header)).toEqual([
      ...META,
      'name',
      'email',
      'address.street',
      'address.postal_code',
      'address.city',
      'address.country',
      'tags',
      'privacy',
      'qty',
      'news',
    ]);
  });
});

describe('entriesCsv', () => {
  it('starts with a UTF-8 byte-order mark and ends each line with CRLF', async () => {
    const csv = await csvOf([entry()]);
    expect(csv.startsWith('﻿entry_id,form_key,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('writes the metadata, expands the address, joins a checkbox group and says yes or no for a consent', async () => {
    const [, row] = rowsOf(
      await csvOf([
        entry({
          answers: {
            name: 'Ada',
            email: 'ada@example.com',
            address: { street: 'Main 1', postalCode: '30-001', city: 'Kraków' },
            tags: ['doors', 'windows'],
            privacy: true,
            news: false,
            qty: 3,
          },
        }),
      ]),
    );
    expect(row).toBe(
      [
        '00000000-0000-4000-8000-000000000001',
        'contact',
        '1',
        'new',
        'default',
        'en-US',
        '2026-10-01T12:00:00.000Z',
        '/contact',
        'Ada',
        'ada@example.com',
        'Main 1',
        '30-001',
        'Kraków',
        '',
        'doors; windows',
        'yes',
        '3',
        'no',
      ].join(','),
    );
  });

  it('leaves the cells of a key the entry’s version does not have empty', async () => {
    const [, row] = rowsOf(await csvOf([entry({ formVersionNumber: 2, answers: { name: 'Bo', qty: 1 }, pageUrl: null })]));
    expect(row!.split(',').slice(7)).toEqual(['', 'Bo', '', '', '', '', '', '', '', '1', '']);
  });

  it.each([['=1+1'], ['+48 600'], ['-5'], ['@SUM(A1)'], ['\tindent'], ['\rreturn']])(
    'neutralises a cell starting %j with an apostrophe (FR-052)',
    async (value) => {
      const [, row] = rowsOf(await csvOf([entry({ answers: { name: value } })]));
      const cell = row!.split(',')[8]!;
      expect(cell.replace(/^"|"$/g, '').startsWith(`'${value[0]}`)).toBe(true);
    },
  );

  it('quotes a cell holding a comma, a quote or a line break', async () => {
    const [, row] = rowsOf(await csvOf([entry({ answers: { name: 'Smith, "Jr"', email: 'a\nb' } })]));
    expect(row).toContain('"Smith, ""Jr""","a\nb"'.split('\n')[0]);
  });

  it('reads the entries lazily, in batches of 500, each after the last one of the batch before', async () => {
    expect(EXPORT_BATCH_SIZE).toBe(500);
    const all = Array.from({ length: 1200 }, (_, index) =>
      entry({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, submittedAt: new Date(Date.UTC(2026, 0, 1) - index * 1000) }),
    );
    const readBatch = vi.fn(async (after: { submittedAt: Date; id: string } | null, size: number) => {
      const start = after === null ? 0 : all.findIndex((candidate) => candidate.id === after.id) + 1;
      return all.slice(start, start + size);
    });
    const chunks = entriesCsv({ columns: exportColumns([{ number: 1, definition: V1 }]), formKey: 'contact', channelLabel: (id) => id, readBatch });
    const iterator = chunks[Symbol.asyncIterator]();
    await iterator.next();
    expect(readBatch).not.toHaveBeenCalled();
    await iterator.next();
    expect(readBatch).toHaveBeenCalledTimes(1);
    expect(readBatch).toHaveBeenLastCalledWith(null, 500);
    let lines = 1;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) lines += 1;
    expect(lines).toBe(1200);
    expect(readBatch).toHaveBeenCalledTimes(3);
    expect(readBatch.mock.calls[1]![0]).toEqual({ submittedAt: all[499]!.submittedAt, id: all[499]!.id });
  });
});
