/** Legacy TipTap doc — plain-text extraction only (no HTML rendering). */
type TiptapNode = {
  type?: string;
  text?: string;
  content?: unknown[];
};

export interface LegacyTextSource {
  text?: unknown | undefined;
  html?: unknown | undefined;
  tiptapContent?: unknown | undefined;
}

function coercePlainText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function walkTiptapNode(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as TiptapNode;
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (!Array.isArray(n.content)) return '';
  const parts = n.content.map((child) => walkTiptapNode(child));
  if (n.type === 'paragraph' || n.type === 'heading') {
    return parts.join('');
  }
  return parts.join('');
}

export function extractPlainTextFromTiptap(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const root = doc as TiptapNode;
  if (root.type !== 'doc' || !Array.isArray(root.content)) return '';
  return root.content
    .map((block) => walkTiptapNode(block))
    .filter((line) => line.length > 0)
    .join('\n');
}

export function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resolves display text for Simple Text, including legacy rows that still store
 * TipTap JSON or an HTML fallback instead of the `text` field.
 */
export function resolveTextContent(source: LegacyTextSource): string {
  const direct = coercePlainText(source.text).trim();
  if (direct) return direct;

  const fromTiptap = extractPlainTextFromTiptap(source.tiptapContent);
  if (fromTiptap) return fromTiptap;

  const fromHtml = coercePlainText(source.html).trim();
  if (fromHtml) return stripHtmlToPlainText(fromHtml);

  return '';
}
