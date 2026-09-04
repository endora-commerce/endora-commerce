import { describe, expect, it } from 'vitest';
import { XmlFeedSerializer } from './xml-feed-serializer.js';
import { createFeedReadable } from './feed-stream.js';
import type { FeedItemField } from './serializer.interface.js';

/**
 * Feature 067 / T021 — the streaming XML serializer (FR-011, FR-034).
 *
 * Three properties matter here and all are load-bearing:
 *
 *  - **Escaping is security-relevant.** Every value is operator-entered product
 *    copy landing verbatim in an XML document a third party parses. The five
 *    predefined entities are escaped, and XML-1.0-invalid control characters are
 *    STRIPPED (not escaped — they have no representation at all, and a single
 *    `\x00` in one description makes Merchant Center reject the whole document).
 *  - **The hostile fixtures below spell their control characters as escapes.**
 *    A raw byte in the source produces exactly the same string at runtime, so
 *    nothing is lost — but a raw `\x00` makes git classify this file as binary,
 *    at which point every diff of it reads "Binary files differ" and the fixture
 *    stops being reviewable (issue #190). Keep them escaped.
 *  - **Output is incremental.** The serializer never accumulates; a 100k-item
 *    feed must not exist in memory as one string (FR-034).
 */

function serializer(): XmlFeedSerializer {
  return new XmlFeedSerializer({
    title: 'Example shop',
    link: 'https://shop.example.com',
    description: 'Product feed',
  });
}

function fields(pairs: Record<string, string>): FeedItemField[] {
  return Object.entries(pairs).map(([name, value]) => ({ name, value }));
}

describe('XmlFeedSerializer — RSS 2.0 envelope', () => {
  it('opens with the XML declaration, the rss root and the g: namespace', () => {
    const begin = serializer().begin();
    expect(begin).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(begin).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(begin).toContain('<channel>');
    expect(begin).toContain('<title>Example shop</title>');
    expect(begin).toContain('<link>https://shop.example.com</link>');
    expect(begin).toContain('<description>Product feed</description>');
  });

  it('closes the channel and the rss root', () => {
    const end = serializer().end();
    expect(end).toContain('</channel>');
    expect(end).toContain('</rss>');
  });

  it('escapes the channel header too — a shop name is operator-entered', () => {
    const begin = new XmlFeedSerializer({
      title: 'Bed & Bath <Ltd>',
      link: 'https://shop.example.com/?a=1&b=2',
      description: '"quoted"',
    }).begin();
    expect(begin).toContain('<title>Bed &amp; Bath &lt;Ltd&gt;</title>');
    expect(begin).toContain('<link>https://shop.example.com/?a=1&amp;b=2</link>');
    // Nothing inside the element bodies is a raw special character, and every
    // `&` opens one of the five predefined entities.
    const bodies = [...begin.matchAll(/<(title|link|description)>(.*?)<\/\1>/g)].map(
      (m) => m[2] ?? '',
    );
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body).not.toMatch(/[<>"']/);
      expect(body.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&');
    }
  });

  it('wraps each item in <item> and writes one element per field', () => {
    const chunk = serializer().item(fields({ 'g:id': 'SKU-1', 'g:price': '10.00 PLN' }));
    expect(chunk).toContain('<item>');
    expect(chunk).toContain('<g:id>SKU-1</g:id>');
    expect(chunk).toContain('<g:price>10.00 PLN</g:price>');
    expect(chunk).toContain('</item>');
  });

  it('omits a field whose value is the empty string rather than writing an empty element', () => {
    const chunk = serializer().item(fields({ 'g:id': 'SKU-1', 'g:gtin': '' }));
    expect(chunk).toContain('<g:id>SKU-1</g:id>');
    expect(chunk).not.toContain('g:gtin');
  });
});

describe('XmlFeedSerializer — escaping', () => {
  it('escapes all five XML predefined entities', () => {
    const chunk = serializer().item(
      fields({ title: `Tom & Jerry <b>"best"</b> it's 5 > 3` }),
    );
    expect(chunk).toContain(
      '<title>Tom &amp; Jerry &lt;b&gt;&quot;best&quot;&lt;/b&gt; it&apos;s 5 &gt; 3</title>',
    );
    // Nothing raw survived.
    expect(chunk).not.toContain('<b>');
    expect(chunk).not.toContain('"best"');
  });

  it('escapes & exactly once (no double-escaping of an already-escaped entity)', () => {
    const chunk = serializer().item(fields({ title: '&amp;' }));
    expect(chunk).toContain('<title>&amp;amp;</title>');
  });

  it('escapes the element name as well, so a hostile output name cannot inject markup', () => {
    const chunk = serializer().item([{ name: 'a<b>', value: 'x' }]);
    expect(chunk).not.toContain('<a<b>>');
  });

  it('strips the XML-1.0-invalid control characters \\x00-\\x08', () => {
    const hostile = `A\x00B\x01C\x02D\x03E\x04F\x05G\x06H\x07I\x08J`;
    const chunk = serializer().item(fields({ description: hostile }));
    expect(chunk).toContain('<description>ABCDEFGHIJ</description>');
    for (let code = 0x00; code <= 0x08; code++) {
      expect(chunk).not.toContain(String.fromCharCode(code));
    }
  });

  it('keeps tab, newline and carriage return, which XML 1.0 allows', () => {
    const chunk = serializer().item(fields({ description: 'a\tb\nc\rd' }));
    expect(chunk).toContain('a\tb\nc\rd');
  });

  it('strips the remaining invalid C0 controls and the C1 range', () => {
    const chunk = serializer().item(fields({ description: 'a\x0bb\x0cc\x1fd\x7fe' }));
    expect(chunk).toContain('<description>abcde</description>');
  });
});

describe('XmlFeedSerializer — incremental output (FR-034)', () => {
  it('holds no growing internal state: the chunk for item N does not depend on N', () => {
    const s = serializer();
    const first = s.item(fields({ 'g:id': 'SKU-1' }));
    for (let i = 0; i < 1_000; i++) s.item(fields({ 'g:id': `SKU-${i}` }));
    const afterThousand = s.item(fields({ 'g:id': 'SKU-1' }));
    expect(afterThousand).toBe(first);
  });

  it('streams: the consumer sees output before the item source is drained', async () => {
    const TOTAL = 10_000;
    let yielded = 0;
    async function* source(): AsyncGenerator<FeedItemField[]> {
      for (let i = 0; i < TOTAL; i++) {
        yielded += 1;
        yield fields({
          'g:id': `SKU-${i}`,
          'g:title': `Product number ${i}`,
          'g:description': 'x'.repeat(200),
        });
      }
    }

    const stream = createFeedReadable(serializer(), source());
    let yieldedAtFirstChunk = -1;
    let chunks = 0;
    let bytes = 0;
    for await (const chunk of stream) {
      if (yieldedAtFirstChunk < 0) yieldedAtFirstChunk = yielded;
      chunks += 1;
      bytes += (chunk as Buffer).length;
    }

    // If anything buffered the document, the generator would have been drained
    // to completion before a single byte reached the consumer. This is the
    // assertion that fails the moment someone reintroduces `array.join()`.
    expect(yieldedAtFirstChunk).toBeGreaterThanOrEqual(0);
    expect(yieldedAtFirstChunk).toBeLessThan(TOTAL);
    expect(chunks).toBeGreaterThan(1);
    // Sanity: the whole document really was produced.
    expect(bytes).toBeGreaterThan(TOTAL * 200);
    expect(yielded).toBe(TOTAL);
  });

  it('produces a well-formed document end to end', async () => {
    async function* source(): AsyncGenerator<FeedItemField[]> {
      yield fields({ 'g:id': 'A' });
      yield fields({ 'g:id': 'B' });
    }
    const chunks: string[] = [];
    for await (const chunk of createFeedReadable(serializer(), source())) {
      chunks.push(String(chunk));
    }
    const doc = chunks.join('');
    expect(doc.startsWith('<?xml')).toBe(true);
    expect(doc.trimEnd().endsWith('</rss>')).toBe(true);
    expect(doc.match(/<item>/g)).toHaveLength(2);
  });
});

describe('XmlFeedSerializer — file metadata', () => {
  it('declares the content type and extension the routes use', () => {
    const s = serializer();
    expect(s.contentType).toBe('application/xml; charset=utf-8');
    expect(s.fileExtension).toBe('xml');
  });
});
