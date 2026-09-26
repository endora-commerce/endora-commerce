import path from 'node:path';
import { createRequire } from 'node:module';
import type { TDocumentDefinitions, TFontDictionary, Content } from 'pdfmake/interfaces.js';
import type { InvoiceDetail, InvoicePdfBlockRegistration } from '@endora-commerce/contracts';
import type { AmountToWordsLocale } from './amount-to-words.js';
import {
  headerSection,
  partiesSection,
  lineItemsSection,
  vatSummarySection,
  totalsSection,
} from '../pdf-components/sections.js';
import {
  INVOICE_COMPONENT_NAMES,
  placedBlockNames,
  treeToContent,
  type ContributedBlockRenderer,
} from '../pdf-components/tree-mapper.js';
import { InvoicePdfBlockRegistry } from './invoice-pdf-block-registry.js';
import {
  embedInvoiceLogoImages,
  type LoadAssetImage,
} from '../pdf-components/embed-logo-images.js';

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

/**
 * Built-in generic layout — the FR-016 fallback when no valid template exists.
 *
 * Its last entries are the present contributors' blocks, with their default
 * props. That is where `ksefSection(inv)` used to be written out: a use of the
 * KSeF block the E4 ruling's table did not list, generalised with the other
 * four rather than kept (`specs/134-paid-module-extraction/` T063).
 */
function builtinLayout(
  inv: InvoiceDetail,
  locale: AmountToWordsLocale,
  contributed: readonly Content[],
): Content[] {
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
    ...contributed,
  ];
}

const OWN_BLOCKS: ReadonlySet<string> = new Set(INVOICE_COMPONENT_NAMES);

export type InvoicePdfRendererOptions = {
  /** Load library asset bytes for InvoiceLogo (avoids pdfmake self-HTTP). */
  loadAssetImage?: LoadAssetImage;
  /**
   * The blocks other modules render (T063/T126). Defaults to an empty,
   * always-present registry, so a renderer a unit test builds renders this
   * module's own blocks and nothing else.
   */
  blocks?: InvoicePdfBlockRegistry;
};

/**
 * Renders an invoice to a PDF Buffer using pdfmake (feature 047, R1/R2/US6).
 *
 * When a WYSIWYG (Puck) template tree is supplied and yields renderable invoice
 * components, the PDF follows that layout; otherwise it falls back to the
 * built-in generic layout (FR-016). Both paths share the same section builders.
 */
export class InvoicePdfRenderer {
  readonly #loadAssetImage: LoadAssetImage | undefined;

  /**
   * The contributed-block seam — the generalisation of the
   * `setKsefVerificationResolver` this class carried from feature 059 to 134.
   *
   * That setter was one vendor's contribution point: a composition root had to
   * call it after building both modules, which only this repository's
   * reference root did, so on an instance composed through the platform the
   * PDF carried no KSeF verification block while `ksef` was installed and on
   * (`research.md` D16 §1 item 7). A contributor now registers the whole block —
   * renderer, description and the per-render data it needs — from its own
   * composition, and every render path reads it here.
   */
  readonly blocks: InvoicePdfBlockRegistry;

  constructor(opts: InvoicePdfRendererOptions = {}) {
    this.#loadAssetImage = opts.loadAssetImage;
    this.blocks = opts.blocks ?? new InvoicePdfBlockRegistry();
  }

  async render(
    invoice: InvoiceDetail,
    locale: AmountToWordsLocale = 'pl',
    templateTree?: unknown,
  ): Promise<Buffer> {
    if (!fontsRegistered) {
      pdfMake.setFonts(buildFontDictionary());
      // Images are inlined as data URIs by embedInvoiceLogoImages — deny network.
      pdfMake.setUrlAccessPolicy(() => false);
      fontsRegistered = true;
    }
    const content = await this.content(invoice, locale, templateTree);
    return pdfMake.createPdf(this.buildDoc(content)).getBuffer();
  }

  /**
   * The pdfmake content an invoice renders to — the template's blocks, or the
   * built-in layout when the template places none this module or a present
   * contributor renders (FR-016).
   *
   * Public because it is the one place every render path meets, which makes it
   * the place a test asserts what a PDF carries without parsing one.
   */
  async content(
    invoice: InvoiceDetail,
    locale: AmountToWordsLocale = 'pl',
    templateTree?: unknown,
  ): Promise<Content[]> {
    const tree = templateTree
      ? await embedInvoiceLogoImages(templateTree, this.#loadAssetImage)
      : undefined;

    const present = this.blocks.present();
    const placed = tree ? new Set(placedBlockNames(tree)) : null;
    const resolved = await this.resolveContributed(
      invoice.id,
      present.filter((block) => placed === null || placed.has(block.name)),
    );
    const contributed: ContributedBlockRenderer = (name) => {
      if (OWN_BLOCKS.has(name)) return undefined;
      const block = this.blocks.find(name);
      if (!block) return undefined;
      return (props) =>
        block.render({ props, invoice, locale, resolved: resolved.get(name) ?? null }) as Content;
    };

    const fromTemplate = tree ? treeToContent(tree, invoice, locale, contributed) : null;
    if (fromTemplate) return fromTemplate;
    const fallbackResolved =
      placed === null ? resolved : await this.resolveContributed(invoice.id, present);
    return builtinLayout(
      invoice,
      locale,
      present.map(
        (block) =>
          block.render({
            props: {},
            invoice,
            locale,
            resolved: fallbackResolved.get(block.name) ?? null,
          }) as Content,
      ),
    );
  }

  /**
   * Each block's per-render data, read once. A rejection is the block's `null`:
   * the data is an enrichment, and an invoice — a legal document — never fails
   * to render on it. The `catch` is around a contributed callback, not a port.
   */
  private async resolveContributed(
    invoiceId: string,
    blocks: readonly InvoicePdfBlockRegistration[],
  ): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    for (const block of blocks) {
      if (!block.resolve) continue;
      try {
        out.set(block.name, (await block.resolve(invoiceId)) ?? null);
      } catch {
        out.set(block.name, null);
      }
    }
    return out;
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
