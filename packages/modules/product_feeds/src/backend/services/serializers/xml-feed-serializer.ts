import type {
  FeedFileExtension,
  FeedItemField,
  FeedSerializer,
} from './serializer.interface.js';

/**
 * Streaming RSS 2.0 feed serializer — feature 067 / FR-011, research §R2.
 *
 * The shape Google Merchant Center and Meta both consume: an RSS 2.0 document
 * whose `<channel>` holds one `<item>` per offer, with the provider fields in
 * the `g:` namespace (`http://base.google.com/ns/1.0`).
 *
 * **Why hand-written** (Constitution IV): the output is a *generated* document
 * with a fixed, shallow shape. The whole job is escaping plus a wrapper. A
 * library would buy nothing and add supply-chain surface; nothing here *parses*
 * XML, which is where hand-rolling would be indefensible.
 *
 * **Why no CDATA**: escaping is sufficient and is what Google's own feed spec
 * recommends. CDATA merely moves the escaping problem to `]]>`.
 */

const GOOGLE_NAMESPACE_URI = 'http://base.google.com/ns/1.0';

/**
 * Characters that XML 1.0 cannot represent at all. They are **stripped**, not
 * escaped — there is no escape for them, and `&#0;` is itself invalid.
 *
 * This is not a cosmetic concern. Feed values are operator-entered product
 * copy, frequently pasted from a supplier spreadsheet or a Word document, and a
 * single `\x00` or `\x1F` anywhere in a 100k-item document makes Merchant
 * Center reject the *whole* file rather than one offer.
 *
 * Kept: `\t` (0x09), `\n` (0x0A), `\r` (0x0D) — the three C0 controls XML 1.0
 * allows. Removed: the rest of C0, `\x7F`, and the C1 range `\x80-\x9F`.
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Escapes the five XML predefined entities. Order matters: `&` first, or the
 * ampersands introduced by the later replacements would be escaped again.
 *
 * Same rules as `seo/services/sitemap-generator.service.ts`, re-implemented here
 * rather than imported — that is another module's internal (Principle I) and
 * its `renderSitemap` buffers, which is exactly what this module must not do.
 */
export function escapeXmlValue(value: string): string {
  return value
    .replace(INVALID_XML_CHARS_RE, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Element names are template-authored, so they are operator input too. Anything
 * outside the XML name production is dropped rather than escaped — an escaped
 * `&lt;` inside a tag name would be just as invalid, only harder to diagnose.
 */
export function sanitizeXmlElementName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.:-]/g, '');
  return /^[A-Za-z_:]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

export interface XmlFeedSerializerOptions {
  /** `<channel><title>` — the shop or feed name. */
  title: string;
  /** `<channel><link>` — the storefront origin for the feed's channel. */
  link: string;
  /** `<channel><description>`. */
  description: string;
  /** Namespace URI bound to the `g:` prefix. Meta accepts Google's. */
  namespaceUri?: string;
}

export class XmlFeedSerializer implements FeedSerializer {
  readonly contentType = 'application/xml; charset=utf-8';
  readonly fileExtension: FeedFileExtension = 'xml';

  constructor(private readonly options: XmlFeedSerializerOptions) {}

  begin(): string {
    const ns = this.options.namespaceUri ?? GOOGLE_NAMESPACE_URI;
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<rss version="2.0" xmlns:g="${escapeXmlValue(ns)}">\n` +
      '<channel>\n' +
      `<title>${escapeXmlValue(this.options.title)}</title>\n` +
      `<link>${escapeXmlValue(this.options.link)}</link>\n` +
      `<description>${escapeXmlValue(this.options.description)}</description>\n`
    );
  }

  item(fields: readonly FeedItemField[]): string {
    let out = '<item>\n';
    for (const field of fields) {
      // An empty value is an ABSENT field, not an empty element: providers treat
      // `<g:gtin></g:gtin>` as a malformed value, whereas an omitted optional
      // field is simply unset.
      if (field.value === '') continue;
      const name = sanitizeXmlElementName(field.name);
      out += `<${name}>${escapeXmlValue(field.value)}</${name}>\n`;
    }
    return `${out}</item>\n`;
  }

  end(): string {
    return '</channel>\n</rss>\n';
  }
}
