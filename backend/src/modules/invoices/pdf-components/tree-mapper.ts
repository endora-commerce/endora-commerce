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
  ksefSection,
} from './sections.js';

/** Invoice template component names (the bounded WYSIWYG palette, research R2). */
export const INVOICE_COMPONENT_NAMES = [
  'InvoiceHeader',
  'InvoiceParties',
  'InvoiceLineItems',
  'InvoiceVatSummary',
  'InvoiceTotals',
  'InvoiceNotes',
  'InvoiceKsef',
] as const;
export type InvoiceComponentName = (typeof INVOICE_COMPONENT_NAMES)[number];

type Mapper = (props: Record<string, unknown>, inv: InvoiceDetail, locale: AmountToWordsLocale) => Content;

const COMPONENT_MAP: Record<InvoiceComponentName, Mapper> = {
  InvoiceHeader: (_p, inv) => headerSection(inv),
  InvoiceParties: (_p, inv) => partiesSection(inv),
  InvoiceLineItems: (_p, inv) => lineItemsSection(inv),
  InvoiceVatSummary: (_p, inv) => vatSummarySection(inv),
  InvoiceTotals: (_p, inv, locale) => totalsSection(inv, locale),
  InvoiceNotes: (p, inv) => notesSection(p as { text?: string }, inv),
  InvoiceKsef: (_p, inv) => ksefSection(inv),
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
export function pickLanguageTree(
  content: unknown,
  language: string,
): unknown {
  const env = content as { languages?: Record<string, unknown> } | null;
  if (!env?.languages) return null;
  return env.languages[language] ?? Object.values(env.languages)[0] ?? null;
}
