/**
 * The pure Page Builder helpers the catalogue's content shares between
 * category content (feature `fcf6daa76`) and product content attributes
 * (`specs/172-product-content-attributes/`, research R-2, R-3, R-12).
 *
 * No I/O and no entity: every function here takes plain JSON and answers
 * plain JSON, so the rule each one states has exactly one home.
 */

/** One language's Page Builder document — opaque beyond being a JSON object. */
export type PageBuilderDocument = Record<string, unknown>;

/** The stored envelope: one document per language code. */
export interface PageBuilderEnvelope {
  languages: Record<string, PageBuilderDocument>;
}

/** What the product form's card shows of one language, instead of the document (R-3). */
export interface PageBuilderDocumentSummary {
  /** Top-level blocks. */
  blocks: number;
  /** The first text a block carries, tags stripped, whitespace folded, at most {@link EXCERPT_MAX_LENGTH} characters. */
  excerpt: string | null;
}

/** The ceiling on a summary's excerpt, in characters. */
export const EXCERPT_MAX_LENGTH = 120;

/** The block props an excerpt is read from, in order of preference. */
const TEXT_PROPS = ['text', 'title', 'heading', 'body', 'html'] as const;

/**
 * Whether a Page Builder document would render anything: a block at the top
 * level, or in a legacy `zones` bucket. An editor that was opened and saved
 * untouched stores a document with neither.
 */
export function hasPageBuilderBlocks(tree: PageBuilderDocument): boolean {
  if (Array.isArray(tree['content']) && tree['content'].length > 0) return true;
  const zones = tree['zones'];
  if (zones && typeof zones === 'object') {
    return Object.values(zones).some((zone) => Array.isArray(zone) && zone.length > 0);
  }
  return false;
}

/**
 * The envelope as it is stored (FR-013, R-2): a language whose document holds
 * no block is dropped, and an envelope with no language left is `null` — "no
 * value". Normalising once on write means every reader (the card, the delete
 * count, the product page) reads one fact rather than re-deriving it.
 */
export function normalisePageBuilderEnvelope(
  envelope: PageBuilderEnvelope | null,
): PageBuilderEnvelope | null {
  if (envelope === null) return null;
  const languages: Record<string, PageBuilderDocument> = {};
  for (const [language, document] of Object.entries(envelope.languages)) {
    if (hasPageBuilderBlocks(document)) languages[language] = document;
  }
  return Object.keys(languages).length > 0 ? { languages } : null;
}

/** Tags stripped and whitespace folded — what an excerpt reads as. */
function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first non-empty text of one block's props, in {@link TEXT_PROPS} order. */
function blockText(block: unknown): string | null {
  if (!block || typeof block !== 'object') return null;
  const props = (block as { props?: unknown }).props;
  if (!props || typeof props !== 'object') return null;
  for (const name of TEXT_PROPS) {
    const value = (props as Record<string, unknown>)[name];
    if (typeof value !== 'string') continue;
    const text = plainText(value);
    if (text.length > 0) return text;
  }
  return null;
}

/**
 * One language's summary (R-3): the top-level block count, and the first text
 * a top-level block carries. The "first text" rule is per block shape, which
 * is why it lives here and not in a jsonpath.
 */
export function summarisePageBuilderDocument(document: PageBuilderDocument): PageBuilderDocumentSummary {
  const content = Array.isArray(document['content']) ? (document['content'] as unknown[]) : [];
  let excerpt: string | null = null;
  for (const block of content) {
    const text = blockText(block);
    if (text !== null) {
      excerpt = text.slice(0, EXCERPT_MAX_LENGTH);
      break;
    }
  }
  return { blocks: content.length, excerpt };
}

/** The UTF-8 byte length of the envelope's JSON — what the 1 MiB ceiling is measured in (FR-012). */
export function pageBuilderEnvelopeBytes(envelope: PageBuilderEnvelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

/** The part of a read's context the language walk reads. */
export interface PageBuilderLanguageContext {
  preferredLanguage?: string | null | undefined;
  resolvedChannel: { defaultLanguage?: string | null | undefined };
}

/**
 * The language a reader is shown (FR-033, R-12), shared by category and product
 * content: the caller's, then the channel's default, then `en-US`, then `en`,
 * then any stored language. A language whose document holds no block is
 * skipped, because an operator who saved the Polish tab empty did not ask for
 * the English text to disappear from the Polish storefront. `null` when no
 * language holds a block.
 */
export function resolvePageBuilderLanguage(
  languages: Readonly<Record<string, PageBuilderDocument>>,
  ctx: PageBuilderLanguageContext,
): { language: string; document: PageBuilderDocument } | null {
  const candidates = [
    ctx.preferredLanguage,
    ctx.resolvedChannel.defaultLanguage,
    'en-US',
    'en',
    ...Object.keys(languages),
  ].filter((value): value is string => typeof value === 'string');
  for (const language of candidates) {
    if (!Object.hasOwn(languages, language)) continue;
    const document = languages[language];
    if (document !== undefined && hasPageBuilderBlocks(document)) return { language, document };
  }
  return null;
}
