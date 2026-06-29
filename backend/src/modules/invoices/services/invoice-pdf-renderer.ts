import path from 'node:path';
import { createRequire } from 'node:module';
import type { TDocumentDefinitions, TFontDictionary, Content } from 'pdfmake/interfaces.js';
import type { InvoiceDetail } from '@b2b/contracts';
import type { AmountToWordsLocale } from './amount-to-words.js';
import {
  headerSection,
  partiesSection,
  lineItemsSection,
  vatSummarySection,
  totalsSection,
  ksefSection,
} from '../pdf-components/sections.js';
import { treeToContent } from '../pdf-components/tree-mapper.js';

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

function buildFontDictionary(): TFontDictionary {
  const fontsDir = requireFromHere
    .resolve('pdfmake/package.json')
    .replace(/package\.json$/, `fonts${path.sep}Roboto${path.sep}`);
  return {
    Roboto: {
      normal: `${fontsDir}Roboto-Regular.ttf`,
      bold: `${fontsDir}Roboto-Medium.ttf`,
      italics: `${fontsDir}Roboto-Italic.ttf`,
      bolditalics: `${fontsDir}Roboto-MediumItalic.ttf`,
    },
  };
}

let fontsRegistered = false;

/** Built-in generic layout — the FR-016 fallback when no valid template exists. */
function builtinLayout(inv: InvoiceDetail, locale: AmountToWordsLocale): Content[] {
  return [
    headerSection(inv),
    partiesSection(inv),
    lineItemsSection(inv),
    {
      columns: [
        { width: '55%', stack: [vatSummarySection(inv)] },
        { width: '45%', stack: [totalsSection(inv, locale)] },
      ],
      margin: [0, 0, 0, 16],
    },
    ...(inv.kind === 'correction' && inv.originalInvoiceId
      ? [{ text: 'Dokument korygujący do faktury pierwotnej.', italics: true, margin: [0, 0, 0, 8] } as Content]
      : []),
    ksefSection(inv),
  ];
}

/**
 * Renders an invoice to a PDF Buffer using pdfmake (feature 047, R1/R2/US6).
 *
 * When a WYSIWYG (Puck) template tree is supplied and yields renderable invoice
 * components, the PDF follows that layout; otherwise it falls back to the
 * built-in generic layout (FR-016). Both paths share the same section builders.
 */
export class InvoicePdfRenderer {
  render(
    invoice: InvoiceDetail,
    locale: AmountToWordsLocale = 'pl',
    templateTree?: unknown,
  ): Promise<Buffer> {
    if (!fontsRegistered) {
      pdfMake.setFonts(buildFontDictionary());
      pdfMake.setUrlAccessPolicy(() => false);
      fontsRegistered = true;
    }
    const fromTemplate = templateTree ? treeToContent(templateTree, invoice, locale) : null;
    const content = fromTemplate ?? builtinLayout(invoice, locale);
    return pdfMake.createPdf(this.buildDoc(content)).getBuffer();
  }

  private buildDoc(content: Content[]): TDocumentDefinitions {
    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 48],
      defaultStyle: { fontSize: 10, font: 'Roboto' },
      styles: { docTitle: { fontSize: 14, bold: true } },
      content,
    };
  }
}
