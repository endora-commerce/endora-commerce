import type { Content } from 'pdfmake/interfaces.js';
import type { InvoiceDetail } from '@endora-commerce/contracts';
import type { AmountToWordsLocale } from '../services/amount-to-words.js';
import {
  headerSection,
  partiesSection,
  lineItemsSection,
  vatSummarySection,
  totalsSection,
  notesSection,
  footerSection,
  spacerSection,
  dividerSection,
  logoSection,
} from './sections.js';

/**
 * This module's own invoice template blocks — the ten it renders itself.
 *
 * A block another module declares is rendered by that module, through
 * `invoicePdfBlockRegistry` (`specs/134-paid-module-extraction/` T063): the
 * {@link ContributedBlockRenderer} a caller hands {@link treeToContent}.
 */
export const INVOICE_COMPONENT_NAMES = [
  'invoices.InvoiceHeader',
  'invoices.InvoiceParties',
  'invoices.InvoiceLineItems',
  'invoices.InvoiceVatSummary',
  'invoices.InvoiceTotals',
  'invoices.InvoiceNotes',
  'invoices.InvoiceSpacer',
  'invoices.InvoiceDivider',
  'invoices.InvoiceLogo',
  'invoices.InvoiceFooter',
] as const;
export type InvoiceComponentName = (typeof INVOICE_COMPONENT_NAMES)[number];

/** What the renderer hands every own-block mapper beyond the stored props. */
export interface OwnBlockRenderOptions {
  /** A present, placed contributed block prints the KSeF number (T137). */
  readonly suppressKsefNumber?: boolean;
}

type Mapper = (
  props: Record<string, unknown>,
  inv: InvoiceDetail,
  locale: AmountToWordsLocale,
  options: OwnBlockRenderOptions,
) => Content;

const COMPONENT_MAP: Record<InvoiceComponentName, Mapper> = {
  'invoices.InvoiceHeader': (p, inv, _locale, options) => headerSection(inv, p, options),
  'invoices.InvoiceParties': (p, inv) => partiesSection(inv, p),
  'invoices.InvoiceLineItems': (p, inv) => lineItemsSection(inv, p),
  'invoices.InvoiceVatSummary': (p, inv) => vatSummarySection(inv, p),
  'invoices.InvoiceTotals': (p, inv, locale) => totalsSection(inv, locale, p),
  'invoices.InvoiceNotes': (p, inv) => notesSection(p, inv),
  'invoices.InvoiceSpacer': (p) => spacerSection(p),
  'invoices.InvoiceDivider': (p) => dividerSection(p),
  'invoices.InvoiceLogo': (p) => logoSection(p),
  'invoices.InvoiceFooter': (p, inv) => footerSection(p, inv),
};

interface PuckNode {
  type?: string;
  props?: Record<string, unknown>;
}
interface PuckTree {
  content?: PuckNode[];
}

/**
 * A contributed block's renderer for one render, already bound to the data its
 * contributor resolved — or `undefined` when no present module renders `name`.
 */
export type ContributedBlockRenderer = (
  name: string,
) => ((props: Record<string, unknown>) => Content) | undefined;

const NO_CONTRIBUTED_BLOCKS: ContributedBlockRenderer = () => undefined;

/**
 * Map a Puck content tree (one language) to pdfmake content, dispatching each
 * of this module's own blocks to its section builder and every other block to
 * `contributed`. A block nothing renders — its declaring module absent, off or
 * unknown — is skipped without throwing, and its stored props are never
 * touched (feature 096, FR-019/FR-020). Returns `null` when the tree has no
 * renderable block so the caller can fall back to the built-in layout
 * (FR-016); a tree with at least one does not fall back.
 */
export function treeToContent(
  tree: unknown,
  inv: InvoiceDetail,
  locale: AmountToWordsLocale,
  contributed: ContributedBlockRenderer = NO_CONTRIBUTED_BLOCKS,
  options: OwnBlockRenderOptions = {},
): Content[] | null {
  const nodes = (tree as PuckTree | null)?.content;
  if (!Array.isArray(nodes)) return null;
  const out: Content[] = [];
  for (const node of nodes) {
    const type = node?.type;
    if (typeof type !== 'string') continue;
    if (type in COMPONENT_MAP) {
      out.push(COMPONENT_MAP[type as InvoiceComponentName](node.props ?? {}, inv, locale, options));
      continue;
    }
    const render = contributed(type);
    if (render) out.push(render(node.props ?? {}));
  }
  return out.length > 0 ? out : null;
}

/** The block names a tree places, in order — what a render asks contributors to resolve for. */
export function placedBlockNames(tree: unknown): string[] {
  const nodes = (tree as PuckTree | null)?.content;
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => node?.type).filter((type): type is string => typeof type === 'string');
}

/** Extract the per-language Puck tree from a CMS-style content envelope. */
export function pickLanguageTree(content: unknown, language: string): unknown {
  const env = content as { languages?: Record<string, unknown> } | null;
  if (!env?.languages) return null;
  return env.languages[language] ?? Object.values(env.languages)[0] ?? null;
}
