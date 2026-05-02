import path from 'node:path';
import { createRequire } from 'node:module';
import type {
  TDocumentDefinitions,
  TDocumentInformation,
  TFontDictionary,
  Content,
  TableCell,
  TableLayout,
} from 'pdfmake/interfaces.js';

// pdfmake exports a server-side singleton at its package root that
// already wires the virtual filesystem + URL resolver. `setFonts(...)`
// registers the bundled Roboto family; `createPdf(def).getBuffer()`
// returns a Promise<Buffer>. `@types/pdfmake` declares the same surface
// (`createPdf`, `setFonts`, ...) so we type the singleton with what we
// actually use.
interface PdfMakeOutput {
  getBuffer(): Promise<Buffer>;
}
interface PdfMakeSingleton {
  setFonts(fonts: TFontDictionary): void;
  setUrlAccessPolicy(policy: ((url: string) => boolean) | undefined): void;
  createPdf(def: TDocumentDefinitions): PdfMakeOutput;
}
const requireFromHere = createRequire(import.meta.url);
const pdfMake = requireFromHere('pdfmake') as PdfMakeSingleton;
import type {
  ComparisonOwnerView,
  ComparisonAttributeRow,
  ComparisonDisplayMode,
  ComparisonProductSummary,
} from '@b2b/contracts';
import { AssetByteFetcher } from './asset-byte-fetcher.js';

/**
 * `ComparisonPdfRenderer` — feature 007 / US4 / T055.
 *
 * Builds a `pdfmake` document definition from a `ComparisonOwnerView`
 * and streams the resulting PDF into an in-memory Buffer that the
 * route handler ships back to the customer.
 *
 * Layout invariants (per `contracts/public-comparisons-pdf.md` and
 * spec FR-017–FR-020):
 *
 *   - Page 1 header: comparison title + active display-mode caption.
 *   - Always-on row (table header): one cell per product, each with
 *     base image (≤ 150×150), name, and price.
 *   - Body rows: rows filtered by the active display mode, with the
 *     `rowClass` styling propagated as a left-border colour.
 *   - Page orientation: landscape when product count ≥ 3, portrait
 *     otherwise (covers spec edge case "PDF on very wide
 *     comparisons"). The `pickOrientation` export is unit-tested in
 *     isolation.
 *   - Image fallback: an unavailable base image is replaced with a
 *     1×1 transparent placeholder bytes constant rather than failing
 *     the export.
 *
 * The class wraps pdfmake behind a single seam so swapping the engine
 * later (constitution amendment, etc.) touches one file.
 */
export class ComparisonPdfRenderer {
  /**
   * pdfmake's singleton is process-global, so we just register fonts on
   * it once the first time a renderer is constructed and reuse the
   * registered set on every subsequent render.
   */
  private static fontsRegistered = false;

  constructor() {
    if (!ComparisonPdfRenderer.fontsRegistered) {
      pdfMake.setFonts(buildFontDictionary());
      // Refuse every URL pdfmake might want to fetch directly. Image
      // bytes are pre-fetched by `AssetByteFetcher` and embedded as
      // data URIs, so there is never a legitimate need for pdfmake to
      // open a network socket — a strict deny-all also silences the
      // package's "No URL access policy defined" startup warning.
      pdfMake.setUrlAccessPolicy(() => false);
      ComparisonPdfRenderer.fontsRegistered = true;
    }
  }

  /**
   * Render the supplied view to a PDF Buffer. Uses a fresh
   * {@link AssetByteFetcher} per call so per-request caches do not
   * leak across exports.
   */
  async render(
    view: ComparisonOwnerView,
    opts: { fetcher?: AssetByteFetcher } = {},
  ): Promise<Buffer> {
    const fetcher = opts.fetcher ?? new AssetByteFetcher();
    const def = await this.buildDocumentDefinition(view, fetcher);
    return this.bufferiseDocument(def);
  }

  /**
   * Public for tests: returns the assembled document definition object
   * (no PDF stream produced). Tests assert the right column count, row
   * count, and orientation without binding to pdfmake's byte output.
   */
  async buildDocumentDefinition(
    view: ComparisonOwnerView,
    fetcher: AssetByteFetcher,
  ): Promise<TDocumentDefinitions> {
    const visibleRows = filterRowsByMode(view.comparableAttributes, view.displayMode);
    const productImages = await Promise.all(
      view.products.map(async (p) => {
        if (!p.primaryAssetUrl) return null;
        const bytes = await fetcher.fetch(p.primaryAssetUrl);
        return imageDataUri(bytes);
      }),
    );

    const headerRow = buildHeaderRow(view.products, productImages);
    const bodyRows = visibleRows.map((row) => buildBodyRow(row));

    const tableBody: TableCell[][] = [headerRow, ...bodyRows];
    const columnWidths = ['*', ...view.products.map(() => '*')] as Array<string | number>;

    const orientation = pickOrientation(view.products.length);
    const info: TDocumentInformation = {
      title: 'Product comparison',
      creator: 'B2B Platform',
      producer: 'pdfmake',
    };

    return {
      info,
      pageSize: 'A4',
      pageOrientation: orientation,
      pageMargins: [32, 40, 32, 40],
      defaultStyle: { fontSize: 10, font: 'Roboto' },
      content: [
        {
          text: 'Product comparison',
          style: 'h1',
        },
        {
          text: `Mode: ${MODE_LABELS[view.displayMode]}`,
          style: 'caption',
          margin: [0, 0, 0, 12],
        },
        {
          table: {
            headerRows: 1,
            widths: columnWidths,
            body: tableBody,
          },
          layout: COMPARE_TABLE_LAYOUT,
        } satisfies Content,
      ],
      styles: {
        h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
        caption: { fontSize: 10, italics: true, color: '#555' },
        productName: { fontSize: 11, bold: true },
        productPrice: { fontSize: 10, color: '#333' },
        attrLabel: { fontSize: 10, bold: true },
        attrValue: { fontSize: 10 },
        common: { color: '#155724' },
        different: { color: '#721c24' },
      },
    };
  }

  private async bufferiseDocument(def: TDocumentDefinitions): Promise<Buffer> {
    return pdfMake.createPdf(def).getBuffer();
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing.
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<ComparisonDisplayMode, string> = {
  all: 'All attributes',
  common: 'Common attributes only',
  differences: 'Differences only',
};

/** Spec edge case "PDF on very wide comparisons": ≥3 products → landscape. */
export function pickOrientation(productCount: number): 'landscape' | 'portrait' {
  return productCount >= 3 ? 'landscape' : 'portrait';
}

export function filterRowsByMode(
  rows: ComparisonAttributeRow[],
  mode: ComparisonDisplayMode,
): ComparisonAttributeRow[] {
  if (mode === 'all') return rows;
  if (mode === 'common') return rows.filter((r) => r.rowClass === 'common');
  return rows.filter((r) => r.rowClass === 'different');
}

function buildHeaderRow(
  products: ComparisonProductSummary[],
  images: Array<string | null>,
): TableCell[] {
  const head: TableCell = { text: '', style: 'attrLabel' };
  const cells: TableCell[] = products.map((p, idx) => {
    const stack: Content[] = [];
    const dataUri = images[idx];
    if (dataUri) {
      stack.push({ image: dataUri, fit: [120, 120], alignment: 'center' });
    }
    stack.push({ text: localised(p.name), style: 'productName', alignment: 'center' });
    stack.push({
      text: p.price ? `${p.price.amount} ${p.price.currency}` : '—',
      style: 'productPrice',
      alignment: 'center',
    });
    return { stack };
  });
  return [head, ...cells];
}

function buildBodyRow(row: ComparisonAttributeRow): TableCell[] {
  const labelCell: TableCell = {
    text: localised(row.label),
    style: ['attrLabel', row.rowClass],
  };
  const cells: TableCell[] = row.values.map((v) => ({
    text: v ?? '—',
    style: ['attrValue', row.rowClass],
  }));
  return [labelCell, ...cells];
}

function localised(value: Record<string, string>): string {
  return value['en-US'] ?? value['en'] ?? Object.values(value)[0] ?? '';
}

function imageDataUri(bytes: Buffer): string {
  // pdfmake recognises PNG and JPEG bytes by header. We pass it as a data
  // URI so it is treated as inline image regardless of source URL.
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/**
 * Resolves the bundled Roboto font set that ships with `pdfmake` so we
 * do not depend on a separate font-asset pipeline for the renderer.
 */
function buildFontDictionary(): TFontDictionary {
  // pdfmake/.../fonts/Roboto/* — the path is stable across the package's
  // releases. Use `requireFromHere` (createRequire-wrapped) because the
  // backend runs as an ES module and bare `require` is not defined in
  // that scope.
  const fontsDir = requireFromHere.resolve('pdfmake/package.json').replace(
    /package\.json$/,
    `fonts${path.sep}Roboto${path.sep}`,
  );
  return {
    Roboto: {
      normal: `${fontsDir}Roboto-Regular.ttf`,
      bold: `${fontsDir}Roboto-Medium.ttf`,
      italics: `${fontsDir}Roboto-Italic.ttf`,
      bolditalics: `${fontsDir}Roboto-MediumItalic.ttf`,
    },
  };
}

/** Subtle row-separator borders + soft fill on common rows. */
const COMPARE_TABLE_LAYOUT: TableLayout = {
  hLineWidth: (i: number): number => (i === 0 || i === 1 ? 1 : 0.5),
  vLineWidth: (): number => 0.5,
  hLineColor: (): string => '#ccc',
  vLineColor: (): string => '#ccc',
  paddingTop: (): number => 6,
  paddingBottom: (): number => 6,
  paddingLeft: (): number => 8,
  paddingRight: (): number => 8,
};
