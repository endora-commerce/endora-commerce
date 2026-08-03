import type {
  FeedFileExtension,
  FeedItemField,
  FeedSerializer,
} from './serializer.interface.js';

/**
 * Streaming CSV / TSV feed serializer — feature 067 / FR-011, research §R3.
 *
 * The RFC 4180 rules are copied from
 * `import_export/services/csv-codec.ts` and deliberately **not** imported.
 * Three independent reasons, any one sufficient: that file is another module's
 * internal (Principle I); `serializeCsv(rows)` does `rows.map().join('\n')`, so
 * it cannot stream; and it is comma-only, while Amazon and eBay flat files are
 * tab-separated.
 *
 * **CSV quotes, TSV strips.** Marketplace flat-file parsers that consume TSV do
 * not implement RFC 4180 quoting, so a quoted embedded newline would corrupt
 * the file instead of surviving it. In TSV mode the offending characters are
 * replaced by a space, which is lossy but parseable — the opposite trade-off
 * from CSV, and the correct one for that consumer.
 */

export type FeedDelimiter = ',' | '\t';

/** CRLF is what RFC 4180 specifies and what every marketplace importer expects. */
const ROW_TERMINATOR = '\r\n';

export interface DelimitedFeedSerializerOptions {
  /** The template's ordered output names — the header row and the cell order. */
  columns: readonly string[];
  delimiter: FeedDelimiter;
}

export class DelimitedFeedSerializer implements FeedSerializer {
  readonly contentType: string;
  readonly fileExtension: FeedFileExtension;

  private readonly columns: readonly string[];
  private readonly delimiter: FeedDelimiter;

  constructor(options: DelimitedFeedSerializerOptions) {
    this.columns = options.columns;
    this.delimiter = options.delimiter;
    const isTsv = options.delimiter === '\t';
    this.contentType = isTsv
      ? 'text/tab-separated-values; charset=utf-8'
      : 'text/csv; charset=utf-8';
    this.fileExtension = isTsv ? 'tsv' : 'csv';
  }

  begin(): string {
    return this.columns.map((c) => this.encode(c)).join(this.delimiter) + ROW_TERMINATOR;
  }

  item(fields: readonly FeedItemField[]): string {
    // Index by output name so the row follows the TEMPLATE's column order, not
    // the order the resolver happened to produce. A shifted row is the classic
    // way a flat-file import silently imports garbage.
    const byName = new Map<string, string>();
    for (const field of fields) byName.set(field.name, field.value);
    return (
      this.columns.map((c) => this.encode(byName.get(c) ?? '')).join(this.delimiter) +
      ROW_TERMINATOR
    );
  }

  end(): string {
    return '';
  }

  private encode(value: string): string {
    if (this.delimiter === '\t') {
      // Strip rather than quote — see the class comment.
      return value.replace(/[\t\r\n]+/g, ' ');
    }
    const needsQuoting =
      value.includes('"') ||
      value.includes(this.delimiter) ||
      value.includes('\n') ||
      value.includes('\r');
    if (!needsQuoting) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
}
