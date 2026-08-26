import exceljs from 'exceljs';
import type { Writable } from 'node:stream';
import type {
  FeedFileExtension,
  FeedItemField,
  StreamingFeedSerializer,
} from './serializer.interface.js';

/**
 * Streaming XLSX feed serializer — the Office Open XML workbook.
 *
 * This is the one output format that cannot satisfy the chunk contract the
 * other serializers implement. An `.xlsx` is a ZIP archive whose central
 * directory records the offset and CRC of every entry that came before it, so
 * "the chunk for the thousandth item is byte-identical to the chunk for the
 * first" is not merely untrue here — it is unrepresentable. It therefore
 * implements `StreamingFeedSerializer` and owns its own sink.
 *
 * What the chunk contract used to guarantee structurally is preserved by three
 * deliberate choices, all of which matter at 100k items:
 *
 *  - **`useSharedStrings: false`.** The shared-string table is a workbook-wide
 *    dictionary, so it is retained in full until the workbook is committed —
 *    precisely the accumulation research §R2 rules out. Writing strings inline
 *    costs file size and buys bounded memory, which is the right way round for
 *    a file nothing re-reads.
 *  - **`useStyles: false`.** Styles are likewise workbook-global, and a feed
 *    has no formatting to express.
 *  - **`commit()` on every row.** An uncommitted row is retained on the
 *    worksheet; committing hands it to the zip entry and lets it go.
 *
 * Together those hold the heap flat: measured across 100 000 rows, heap use
 * moved from 14 MB to 17 MB. Worth knowing when reading this: the writer
 * ignores the return value of `write()`, so it does *not* slow down when the
 * consumer is behind — it will pull this source as fast as the source yields.
 * That is acceptable only because committed rows are released; it is the
 * per-row `commit()`, not back-pressure, that bounds the memory here.
 *
 * Every value is written as a string. A feed carries identifiers, prices and
 * GTINs that Excel would otherwise "helpfully" reinterpret — `0730" ` becomes a
 * date, a leading zero on an EAN is discarded, and a long GTIN turns into
 * scientific notation. The resolver has already produced the exact text the
 * provider expects, so any coercion here is corruption.
 */

/** Sheet name. Excel forbids `[]:*?/\` and caps the name at 31 characters. */
const SHEET_NAME = 'Feed';


export interface XlsxFeedSerializerOptions {
  /** The template's ordered output names — the header row and the cell order. */
  columns: readonly string[];
}

export class XlsxFeedSerializer implements StreamingFeedSerializer {
  readonly contentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly fileExtension: FeedFileExtension = 'xlsx';

  private readonly columns: readonly string[];

  constructor(options: XlsxFeedSerializerOptions) {
    this.columns = options.columns;
  }

  async writeTo(
    sink: Writable,
    source: AsyncIterable<readonly FeedItemField[]>,
  ): Promise<void> {
    const workbook = new exceljs.stream.xlsx.WorkbookWriter({
      stream: sink,
      useStyles: false,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet(SHEET_NAME);

    sheet.addRow([...this.columns]).commit();

    for await (const fields of source) {
      // Indexed by output name so the row follows the TEMPLATE's column order
      // rather than the order the resolver happened to produce. A shifted row
      // is the classic way a spreadsheet import silently loads garbage.
      const byName = new Map<string, string>();
      for (const field of fields) byName.set(field.name, field.value);
      // `commit()` per row is what releases it: an uncommitted row stays on the
      // worksheet in memory, which would reintroduce the accumulation this
      // class exists to avoid.
      sheet.addRow(this.columns.map((column) => byName.get(column) ?? '')).commit();
    }

    sheet.commit();
    await workbook.commit();
  }
}
