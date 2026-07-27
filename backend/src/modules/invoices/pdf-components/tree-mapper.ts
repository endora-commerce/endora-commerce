import type { Content } from 'pdfmake/interfaces.js';
import type { InvoiceDetail } from '@b2b/contracts';
import type { AmountToWordsLocale } from '../services/amount-to-words.js';
import {
  headerSection,
  partiesSection,
  lineItemsSection,
  vatSummarySection,
  totalsSection,
  notesSection,
  footerSection,
  ksefSection,
  spacerSection,
  dividerSection,
  logoSection,
} from './sections.js';

/** Invoice template component names (the bounded WYSIWYG palette). */
export const INVOICE_COMPONENT_NAMES = [
  'InvoiceHeader',
  'InvoiceParties',
  'InvoiceLineItems',
  'InvoiceVatSummary',
  'InvoiceTotals',
  'InvoiceNotes',
  'InvoiceKsef',
  'InvoiceSpacer',
  'InvoiceDivider',
  'InvoiceLogo',
  'InvoiceFooter',
] as const;
export type InvoiceComponentName = (typeof INVOICE_COMPONENT_NAMES)[number];

type Mapper = (props: Record<string, unknown>, inv: InvoiceDetail, locale: AmountToWordsLocale) => Content;

const COMPONENT_MAP: Record<InvoiceComponentName, Mapper> = {
  InvoiceHeader: (p, inv) => headerSection(inv, p),
  InvoiceParties: (p, inv) => partiesSection(inv, p),
  InvoiceLineItems: (p, inv) => lineItemsSection(inv, p),
  InvoiceVatSummary: (p, inv) => vatSummarySection(inv, p),
  InvoiceTotals: (p, inv, locale) => totalsSection(inv, locale, p),
  InvoiceNotes: (p, inv) => notesSection(p, inv),
  InvoiceKsef: (p, inv) => ksefSection(inv, p),
  InvoiceSpacer: (p) => spacerSection(p),
  InvoiceDivider: (p) => dividerSection(p),
  InvoiceLogo: (p) => logoSection(p),
  InvoiceFooter: (p, inv) => footerSection(p, inv),
};

interface PuckNode {
  type?: string;
  props?: Record<string, unknown>;
}
interface PuckTree {
  content?: PuckNode[];
}

/**
 * Map a Puck content tree (one language) to pdfmake content, dispatching each
 * known invoice component to its section builder. Unknown components are
 * skipped. Returns `null` when the tree has no renderable invoice components so
 * the caller can fall back to the built-in layout (FR-016).
 */
export function treeToContent(
  tree: unknown,
  inv: InvoiceDetail,
  locale: AmountToWordsLocale,
): Content[] | null {
  const nodes = (tree as PuckTree | null)?.content;
  if (!Array.isArray(nodes)) return null;
  const out: Content[] = [];
  for (const node of nodes) {
    const type = node?.type as InvoiceComponentName | undefined;
    if (type && type in COMPONENT_MAP) {
      out.push(COMPONENT_MAP[type](node.props ?? {}, inv, locale));
    }
  }
  return out.length > 0 ? out : null;
}

/** Extract the per-language Puck tree from a CMS-style content envelope. */
export function pickLanguageTree(content: unknown, language: string): unknown {
  const env = content as { languages?: Record<string, unknown> } | null;
  if (!env?.languages) return null;
  return env.languages[language] ?? Object.values(env.languages)[0] ?? null;
}
