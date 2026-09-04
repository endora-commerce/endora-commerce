import { describe, expect, it } from 'vitest';
import exceljs from 'exceljs';
import type { Readable } from 'node:stream';
import { XlsxFeedSerializer } from './xlsx-feed-serializer.js';
import { createFeedReadable } from './feed-stream.js';
import type { FeedItemField } from './serializer.interface.js';

/**
 * The XLSX serializer is the first that owns its own sink, so the guarantees
 * the chunk contract used to enforce structurally have to be asserted here
 * instead: it must not drain the source before emitting, and it must write a
 * workbook a spreadsheet can actually open.
 */

const COLUMNS = ['id', 'title', 'price'] as const;

function row(id: string, title: string, price: string): readonly FeedItemField[] {
  return [
    { name: 'id', value: id },
    { name: 'title', value: title },
    { name: 'price', value: price },
  ];
}

/** Collects a Readable into one Buffer. */
async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

async function* itemsOf(rows: Array<readonly FeedItemField[]>): AsyncGenerator<
  readonly FeedItemField[]
> {
  for (const r of rows) yield r;
}

/** Reads the produced workbook back and returns its cells as strings. */
async function readBack(buffer: Buffer): Promise<string[][]> {
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const sheet = workbook.worksheets[0];
  expect(sheet).toBeDefined();
  const out: string[][] = [];
  sheet!.eachRow((sheetRow) => {
    // exceljs cells are 1-based and `values[0]` is unused. The array is also
    // SPARSE — an empty cell is a hole, and `map` skips holes rather than
    // visiting them — so densify it before reading, or a blank cell comes back
    // as a hole and compares unequal to the empty string it actually is.
    const values = sheetRow.values as unknown[];
    out.push(
      Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) => {
        const value = values[i + 1];
        return value === undefined || value === null ? '' : String(value);
      }),
    );
  });
  return out;
}

describe('XlsxFeedSerializer', () => {
  it('advertises the Office Open XML media type and extension', () => {
    const serializer = new XlsxFeedSerializer({ columns: COLUMNS });
    expect(serializer.fileExtension).toBe('xlsx');
    expect(serializer.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('produces a workbook a spreadsheet reader can open', async () => {
    const serializer = new XlsxFeedSerializer({ columns: COLUMNS });
    const buffer = await drain(
      createFeedReadable(serializer, itemsOf([row('SKU-1', 'A shirt', '19.99')])),
    );
    // A real xlsx is a ZIP: the local file header magic is the cheapest proof
    // that this is not a text file with an optimistic extension.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const cells = await readBack(buffer);
    expect(cells[0]).toEqual(['id', 'title', 'price']);
    expect(cells[1]).toEqual(['SKU-1', 'A shirt', '19.99']);
  });

  it('writes cells in template column order, not resolver order', async () => {
    const serializer = new XlsxFeedSerializer({ columns: COLUMNS });
    const scrambled: readonly FeedItemField[] = [
      { name: 'price', value: '5.00' },
      { name: 'id', value: 'SKU-2' },
      { name: 'title', value: 'A hat' },
    ];
    const cells = await readBack(
      await drain(createFeedReadable(serializer, itemsOf([scrambled]))),
    );
    expect(cells[1]).toEqual(['SKU-2', 'A hat', '5.00']);
  });

  it('leaves a missing field as an empty cell rather than shifting the row', async () => {
    const serializer = new XlsxFeedSerializer({ columns: COLUMNS });
    const partial: readonly FeedItemField[] = [
      { name: 'id', value: 'SKU-3' },
      { name: 'price', value: '7.50' },
    ];
    const cells = await readBack(await drain(createFeedReadable(serializer, itemsOf([partial]))));
    expect(cells[1]).toEqual(['SKU-3', '', '7.50']);
  });

  it('keeps identifiers as text so Excel cannot reinterpret them', async () => {
    // A leading zero on an EAN and a long GTIN are the two that bite: numeric
    // cells would drop the zero and render the GTIN in scientific notation.
    const serializer = new XlsxFeedSerializer({ columns: ['id', 'gtin', 'price'] });
    const cells = await readBack(
      await drain(
        createFeedReadable(
          serializer,
          itemsOf([
            [
              { name: 'id', value: '0730' },
              { name: 'gtin', value: '05901234123457' },
              { name: 'price', value: '19.99' },
            ],
          ]),
        ),
      ),
    );
    expect(cells[1]).toEqual(['0730', '05901234123457', '19.99']);
  });

  it('emits no shared-string table, which is what keeps the heap flat', async () => {
    // The memory-critical choice, asserted on the artefact rather than on the
    // option that produced it. A shared-string table is a workbook-wide
    // dictionary retained until commit, so its presence would mean the whole
    // catalogue's text is held in memory (research §R2). Heap use across
    // 100 000 rows was measured at 14 MB → 17 MB with it off.
    const serializer = new XlsxFeedSerializer({ columns: COLUMNS });
    const rows = Array.from({ length: 500 }, (_, i) => row(`SKU-${i}`, `Item ${i}`, '1.00'));
    const buffer = await drain(createFeedReadable(serializer, itemsOf(rows)));
    // Part names appear verbatim in the ZIP central directory.
    expect(buffer.toString('latin1')).not.toContain('sharedStrings.xml');
    expect(buffer.toString('latin1')).toContain('xl/worksheets/');
  });

  it('consumes the whole source exactly once', async () => {
    let yielded = 0;
    async function* counted(): AsyncGenerator<readonly FeedItemField[]> {
      for (let i = 0; i < 300; i += 1) {
        yielded += 1;
        yield row(`SKU-${i}`, `Item ${i}`, '1.00');
      }
    }
    await drain(createFeedReadable(new XlsxFeedSerializer({ columns: COLUMNS }), counted()));
    expect(yielded).toBe(300);
  });

  it('round-trips every row of a larger feed', async () => {
    const serializer = new XlsxFeedSerializer({ columns: COLUMNS });
    const rows = Array.from({ length: 250 }, (_, i) => row(`SKU-${i}`, `Item ${i}`, '1.00'));
    const cells = await readBack(await drain(createFeedReadable(serializer, itemsOf(rows))));
    expect(cells).toHaveLength(251);
    expect(cells[250]).toEqual(['SKU-249', 'Item 249', '1.00']);
  });

  it('destroys the stream when the source fails, so no half-written file is stored', async () => {
    async function* explodes(): AsyncGenerator<readonly FeedItemField[]> {
      yield row('SKU-1', 'A shirt', '19.99');
      throw new Error('catalogue went away');
    }
    const stream = createFeedReadable(new XlsxFeedSerializer({ columns: COLUMNS }), explodes());
    await expect(drain(stream)).rejects.toThrow('catalogue went away');
  });
});
