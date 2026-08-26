import { describe, expect, it } from 'vitest';
import { DelimitedFeedSerializer } from '../../../../packages/modules/product_feeds/src/backend/services/serializers/delimited-feed-serializer.js';
import { createFeedReadable } from '../../../../packages/modules/product_feeds/src/backend/services/serializers/feed-stream.js';
import type { FeedItemField } from '../../../../packages/modules/product_feeds/src/backend/services/serializers/serializer.interface.js';

/**
 * Feature 067 / T022 — the streaming delimited serializer (FR-011).
 *
 * RFC 4180 rules, copied from `import_export/services/csv-codec.ts` but
 * deliberately NOT imported: that file is another module's internal
 * (Principle I), it cannot stream (`rows.map().join()`), and it is comma-only
 * while Amazon and eBay flat files are tab-separated (research §R3).
 */

function csv(columns: string[]): DelimitedFeedSerializer {
  return new DelimitedFeedSerializer({ columns, delimiter: ',' });
}

function tsv(columns: string[]): DelimitedFeedSerializer {
  return new DelimitedFeedSerializer({ columns, delimiter: '\t' });
}

function txt(columns: string[]): DelimitedFeedSerializer {
  return new DelimitedFeedSerializer({ columns, delimiter: '\t', flavour: 'txt' });
}

function fields(pairs: Record<string, string>): FeedItemField[] {
  return Object.entries(pairs).map(([name, value]) => ({ name, value }));
}

describe('DelimitedFeedSerializer — the txt flavour', () => {
  /**
   * `.txt` exists because several marketplace importers accept a tab-separated
   * upload only under that extension. It is the same bytes as TSV; if it ever
   * stops being, a feed that used to import will start failing silently.
   */
  it('writes bytes identical to TSV', () => {
    const columns = ['id', 'title', 'price'];
    const row = fields({ id: 'SKU-1', title: 'A shirt', price: '19.99' });
    expect(txt(columns).begin()).toBe(tsv(columns).begin());
    expect(txt(columns).item(row)).toBe(tsv(columns).item(row));
  });

  it('strips embedded tabs and newlines exactly as TSV does', () => {
    const row = fields({ id: 'SKU-1', title: 'Two\tparts\nsplit' });
    expect(txt(['id', 'title']).item(row)).toBe(tsv(['id', 'title']).item(row));
  });

  it('differs from TSV only in extension and media type', () => {
    expect(txt(['id']).fileExtension).toBe('txt');
    expect(txt(['id']).contentType).toBe('text/plain; charset=utf-8');
  });

  it('leaves the delimiter-implied default untouched for existing callers', () => {
    // Callers that pass no flavour must keep the behaviour they had.
    expect(tsv(['id']).fileExtension).toBe('tsv');
    expect(csv(['id']).fileExtension).toBe('csv');
  });
});

describe('DelimitedFeedSerializer — header row', () => {
  it('writes the declared columns, in order, as the first row', () => {
    expect(csv(['id', 'title', 'price']).begin()).toBe('id,title,price\r\n');
  });

  it('quotes a header that itself needs quoting', () => {
    expect(csv(['id', 'a,b']).begin()).toBe('id,"a,b"\r\n');
  });

  it('uses the tab delimiter for TSV', () => {
    expect(tsv(['id', 'title']).begin()).toBe('id\ttitle\r\n');
  });
});

describe('DelimitedFeedSerializer — RFC 4180 quoting', () => {
  it('leaves an ordinary value unquoted', () => {
    expect(csv(['id']).item(fields({ id: 'SKU-1' }))).toBe('SKU-1\r\n');
  });

  it('quotes a value containing the delimiter', () => {
    expect(csv(['title']).item(fields({ title: 'Red, large' }))).toBe('"Red, large"\r\n');
  });

  it('quotes a value containing a double quote and doubles the quote', () => {
    expect(csv(['title']).item(fields({ title: 'A "big" one' }))).toBe('"A ""big"" one"\r\n');
  });

  it('quotes a value containing a newline or a carriage return', () => {
    expect(csv(['d']).item(fields({ d: 'line1\nline2' }))).toBe('"line1\nline2"\r\n');
    expect(csv(['d']).item(fields({ d: 'line1\rline2' }))).toBe('"line1\rline2"\r\n');
  });

  it('does not quote a value containing a tab in CSV mode — a tab is not the delimiter there', () => {
    expect(csv(['d']).item(fields({ d: 'a\tb' }))).toBe('a\tb\r\n');
  });

  it('writes an empty cell for a missing field rather than shifting the row', () => {
    const row = csv(['id', 'title', 'price']).item(fields({ id: 'SKU-1', price: '10.00' }));
    expect(row).toBe('SKU-1,,10.00\r\n');
  });

  it('emits values in the declared column order, not the order the resolver produced them', () => {
    const row = csv(['id', 'title']).item([
      { name: 'title', value: 'T' },
      { name: 'id', value: 'SKU-1' },
    ]);
    expect(row).toBe('SKU-1,T\r\n');
  });

  it('ignores a field the template did not declare as a column', () => {
    const row = csv(['id']).item(fields({ id: 'SKU-1', stray: 'x' }));
    expect(row).toBe('SKU-1\r\n');
  });
});

describe('DelimitedFeedSerializer — TSV strips rather than quotes', () => {
  it('strips embedded tabs, newlines and carriage returns in TSV mode', () => {
    // Marketplace flat-file parsers do not implement RFC 4180 quoting, so a
    // quoted embedded newline would corrupt the file rather than survive it.
    const row = tsv(['d']).item(fields({ d: 'a\tb\nc\rd' }));
    expect(row).toBe('a b c d\r\n');
    expect(row.slice(0, -2)).not.toContain('\t');
  });

  it('does not quote in TSV mode even when the value contains a double quote', () => {
    expect(tsv(['d']).item(fields({ d: 'A "big" one' }))).toBe('A "big" one\r\n');
  });
});

describe('DelimitedFeedSerializer — streaming and metadata', () => {
  it('writes nothing at the end — a delimited file has no footer', () => {
    expect(csv(['id']).end()).toBe('');
  });

  it('declares the content type and extension per delimiter', () => {
    expect(csv(['id']).contentType).toBe('text/csv; charset=utf-8');
    expect(csv(['id']).fileExtension).toBe('csv');
    expect(tsv(['id']).contentType).toBe('text/tab-separated-values; charset=utf-8');
    expect(tsv(['id']).fileExtension).toBe('tsv');
  });

  it('streams: the consumer sees output before the item source is drained', async () => {
    const TOTAL = 10_000;
    let yielded = 0;
    async function* source(): AsyncGenerator<FeedItemField[]> {
      for (let i = 0; i < TOTAL; i++) {
        yielded += 1;
        yield fields({ id: `SKU-${i}`, description: 'x'.repeat(200) });
      }
    }
    const stream = createFeedReadable(csv(['id', 'description']), source());
    let yieldedAtFirstChunk = -1;
    for await (const _chunk of stream) {
      if (yieldedAtFirstChunk < 0) yieldedAtFirstChunk = yielded;
    }
    expect(yieldedAtFirstChunk).toBeGreaterThanOrEqual(0);
    expect(yieldedAtFirstChunk).toBeLessThan(TOTAL);
    expect(yielded).toBe(TOTAL);
  });
});
