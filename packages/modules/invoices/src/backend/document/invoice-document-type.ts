import {
  supportedLanguageOf,
  type DocumentBlockRenderer,
  type DocumentTypeRegistration,
  type InvoiceDocumentData,
  type InvoicePdfBlockRegistration,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { invoicesProseTable, type InvoicesTranslate } from '../invoices-prose.js';
import { embedInvoiceLogoImages, type LoadAssetImage } from '../pdf-components/embed-logo-images.js';
import { sampleInvoiceDetail } from '../pdf-components/sample.js';
import { INVOICE_PDF_LABEL_KEYS, type InvoicePdfLabels } from '../pdf-components/sections.js';
import { INVOICE_COMPONENT_NAMES, renderOwnBlock } from '../pdf-components/tree-mapper.js';
import { GENERIC_INVOICE_TEMPLATE_CONTENT } from '../seeds/generic-invoice-template.js';
import type { InvoicePdfBlockRegistry } from '../services/invoice-pdf-block-registry.js';
import { describeOwnBlock } from './block-descriptions.js';

export const INVOICE_DOCUMENT_TYPE = 'invoices.invoice';

/** The language invoice PDFs are printed in (owner answer N5). */
export const INVOICE_RENDER_LANGUAGE = 'pl-PL';

/** What `prepareRender` computes once per invoice PDF. */
export interface InvoicePrepared {
  /** Each placed contributed block's per-render data, or `null` when it could not be read. */
  readonly resolved: ReadonlyMap<string, unknown>;
  /** A present, placed block prints the KSeF number, so the header must not (134 T137). */
  readonly suppressKsefNumber: boolean;
}

type InvoiceBlock = DocumentBlockRenderer<InvoiceDocumentData, InvoicePrepared>;

const OWN = new Set<string>(INVOICE_COMPONENT_NAMES);

/**
 * The *Invoice* document type (`specs/152-compare-pdf-template/contracts/invoice-document.md`
 * §1, simplified by owner answers P1 and P2).
 *
 * - **Palette**: the ten invoice blocks — each rendered by its existing section
 *   builder — then every block another present module contributes to invoices
 *   through `invoicePdfBlockRegistry` (`ksef.InvoiceSection`), unchanged for the
 *   contributor. No general-purpose blocks.
 * - **Built-in layout**: the generic invoice tree. It is what every invoice is
 *   printed with until an operator sets an invoice template as default; it
 *   replaced the seeded "generic" template row (P2).
 * - **Per-render data** (`prepareRender`): each placed contributor's
 *   `resolve(invoiceId)`, a rejection read as `null` — an enrichment never
 *   fails a legal document — and the KSeF-number rule: the header stands down
 *   only while a present block that prints the number is placed.
 * - **Logo**: the logo block inlines its own image (asset or URL, 3 s timeout)
 *   when it renders, so pdfmake never fetches anything.
 * - Polish only (N5); A4 portrait, margins 40/40/48/40, 10 pt; the preview's
 *   sample prints the amount in words in English, as the old editor did.
 * - **Labels** a template prop does not supply are drawn in the document's
 *   `language`, from this module's bundle through `translate`; without it, in
 *   English (issue #95).
 */
export function createInvoiceDocumentType(deps: {
  readonly contributed: InvoicePdfBlockRegistry;
  readonly loadAssetImage: LoadAssetImage;
  readonly translate?: InvoicesTranslate;
}): DocumentTypeRegistration<InvoiceDocumentData, InvoicePrepared> {
  // One resolution per render and language: every own block of one PDF draws
  // from the same table, keyed on the render's data object.
  const labelsByRender = new WeakMap<object, Map<SupportedLanguage, Promise<InvoicePdfLabels>>>();
  const labelsFor = (data: InvoiceDocumentData, language: string): Promise<InvoicePdfLabels> => {
    const supported = supportedLanguageOf(language);
    let byLanguage = labelsByRender.get(data);
    if (!byLanguage) {
      byLanguage = new Map();
      labelsByRender.set(data, byLanguage);
    }
    let labels = byLanguage.get(supported);
    if (!labels) {
      labels = invoicesProseTable(deps.translate, INVOICE_PDF_LABEL_KEYS, supported);
      byLanguage.set(supported, labels);
    }
    return labels;
  };

  const own: InvoiceBlock[] = INVOICE_COMPONENT_NAMES.map(
    (name): InvoiceBlock => ({
      name,
      moduleId: 'invoices',
      describe: () => describeOwnBlock(name),
      async render({ props, data, prepared, language }) {
        let effective: Record<string, unknown> = { ...props };
        if (name === 'invoices.InvoiceLogo') {
          const embedded = (await embedInvoiceLogoImages(
            { content: [{ type: 'invoices.InvoiceLogo', props: effective }] },
            deps.loadAssetImage,
          )) as { content: { props: Record<string, unknown> }[] };
          effective = embedded.content[0]?.props ?? effective;
        }
        return renderOwnBlock(name, effective, data.invoice, data.amountLocale, {
          suppressKsefNumber: prepared.suppressKsefNumber,
          labels: await labelsFor(data, language),
        });
      },
    }),
  );

  const adapt = (registration: InvoicePdfBlockRegistration): InvoiceBlock => ({
    name: registration.name,
    moduleId: registration.moduleId,
    describe: () => {
      const { label, fields } = registration.describe();
      return { label, fields: { ...fields } };
    },
    render: ({ props, data, prepared }) =>
      registration.render({
        props,
        invoice: data.invoice,
        locale: data.amountLocale,
        resolved: prepared.resolved.get(registration.name) ?? null,
      }),
  });

  return {
    code: INVOICE_DOCUMENT_TYPE,
    moduleId: 'invoices',
    labelKey: 'documentTypes.invoice.label',
    descriptionKey: 'documentTypes.invoice.description',
    blocks: () => [...own, ...deps.contributed.present().filter((b) => !OWN.has(b.name)).map(adapt)],
    coreBlocks: 'none',
    selection: 'default_only',
    languages: [INVOICE_RENDER_LANGUAGE],
    defaultContent: () => ({
      schemaVersion: 1,
      languages: {
        [INVOICE_RENDER_LANGUAGE]: structuredClone(
          (GENERIC_INVOICE_TEMPLATE_CONTENT.languages as Record<string, unknown>)[INVOICE_RENDER_LANGUAGE],
        ),
      },
    }) as ReturnType<DocumentTypeRegistration['defaultContent']>,
    pageDefaults: {
      pageSize: 'A4',
      orientation: 'portrait',
      marginTop: 40,
      marginRight: 40,
      marginBottom: 48,
      marginLeft: 40,
      baseFontSize: 10,
      styles: { docTitle: { fontSize: 14, bold: true } },
    },
    async prepareRender(data, { placedBlocks }) {
      const present = deps.contributed.present();
      const placed = present.filter((block) => placedBlocks === null || placedBlocks.has(block.name));
      const resolved = new Map<string, unknown>();
      for (const block of placed) {
        if (!block.resolve) continue;
        try {
          resolved.set(block.name, (await block.resolve(data.invoice.id)) ?? null);
        } catch {
          // The data is an enrichment; an invoice never fails to render on it.
          resolved.set(block.name, null);
        }
      }
      return {
        resolved,
        suppressKsefNumber: placed.some((block) => block.printsKsefReferenceNumber === true),
      };
    },
    sampleData: () => ({ invoice: sampleInvoiceDetail(), amountLocale: 'en' }),
  };
}
