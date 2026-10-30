import { describe, expect, it } from 'vitest';
import type { BlockTranslatableText } from '@endora-commerce/contracts';
import { extract, type Declarations } from './extract.js';
import { inject } from './inject.js';

/**
 * Feature 151, T013 — extraction walks every component (content, slots, nested
 * slot arrays, legacy zones), takes only the declared prose, deduplicates, and
 * `inject` with an identity translation gives the document back unchanged.
 */

const DECLARATIONS: Record<string, BlockTranslatableText[]> = {
  'cms.Heading': [{ path: 'text' }],
  'cms.Accordion': [{ path: 'items[].title' }, { path: 'items[].content', format: 'html' }],
  'cms.RichContent': [{ path: 'content', format: 'tiptap' }],
  'cms.Row': [],
  'cms.Column': [],
  'cms.SimpleTable': [{ path: 'columns[].label' }, { path: 'tableRows[].cells[].value' }],
};
const declarations: Declarations = (name) => DECLARATIONS[name];

const rich = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Kup ' },
        { type: 'text', text: 'teraz', marks: [{ type: 'bold' }] },
      ],
    },
  ],
};

function canvas() {
  return {
    root: { props: { title: 'Strona' } },
    content: [
      { type: 'cms.Heading', props: { id: 'h1', text: 'Witaj', level: 2, editorName: 'Nagłówek' } },
      {
        type: 'cms.Row',
        props: {
          id: 'row1',
          content: [
            {
              type: 'cms.Column',
              props: {
                id: 'col1',
                content: [
                  { type: 'cms.Heading', props: { id: 'h2', text: 'Witaj' } },
                  { type: 'acme.Widget', props: { id: 'w1', caption: 'Nie ruszaj' } },
                ],
              },
            },
          ],
          columnItems: [{ span: 6, content: [{ type: 'cms.Heading', props: { id: 'h3', text: 'Stare' } }] }],
        },
      },
      {
        type: 'cms.Accordion',
        props: {
          id: 'acc',
          items: [
            { title: 'Pytanie', content: '<p>Odpowiedź <a href="/x">tutaj</a></p>' },
            { title: '42', content: '' },
          ],
        },
      },
      { type: 'cms.RichContent', props: { id: 'rc', content: rich, html: '<p>Kup <strong>teraz</strong></p>' } },
      {
        type: 'cms.SimpleTable',
        props: { id: 't', columns: [{ label: 'Plan' }], tableRows: [{ cells: [{ value: 'Starter' }, { value: '€49' }] }] },
      },
    ],
    zones: { 'row1:legacy': [{ type: 'cms.Heading', props: { id: 'h4', text: 'Strefa' } }] },
  };
}

describe('extract', () => {
  it('takes declared prose only, deduplicated, in document order', () => {
    const extraction = extract(canvas(), declarations);
    expect(extraction.segments.map((s) => [s.kind, s.text])).toEqual([
      ['plain', 'Witaj'],
      ['plain', 'Stare'],
      ['plain', 'Pytanie'],
      ['html', '<0/>Odpowiedź <1/>tutaj<2/><3/>'],
      ['inline', 'Kup <0>teraz</0>'],
      ['plain', 'Plan'],
      ['plain', 'Starter'],
      ['plain', 'Strefa'],
    ]);
    // 'Witaj' twice, 'Stare' once; '42' and '€49' carry no letter and are not sent.
    expect(extraction.locations).toHaveLength(9);
    expect(extraction.characters).toBe(extraction.segments.reduce((n, s) => n + s.text.length, 0));
  });

  it('never sends editor names, ids, link targets or undeclared props', () => {
    const sent = extract(canvas(), declarations).segments.map((s) => s.text).join('\n');
    for (const forbidden of ['Nagłówek', 'h1', '/x', 'Nie ruszaj', 'Strona', '<strong>']) {
      expect(sent).not.toContain(forbidden);
    }
  });

  it('counts undeclared blocks by name and still walks their children', () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'acme.Box',
          props: { id: 'b', content: [{ type: 'cms.Heading', props: { id: 'h', text: 'Wewnątrz' } }] },
        },
        { type: 'acme.Box', props: { id: 'b2', content: [] } },
      ],
    };
    const extraction = extract(data, declarations);
    expect([...extraction.untranslatableBlocks]).toEqual([['acme.Box', 2]]);
    expect(extraction.segments.map((s) => s.text)).toEqual(['Wewnątrz']);
  });

  it('ignores non-string values at a declared path', () => {
    const data = { root: {}, content: [{ type: 'cms.Heading', props: { id: 'h', text: { not: 'a string' } } }] };
    expect(extract(data, declarations).segments).toEqual([]);
  });

  it('walks into an accordion panel that holds blocks, beside one still stored as HTML (feature 163, T059)', () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Accordion',
          props: {
            id: 'acc',
            items: [
              { title: 'Pytanie', panel: [{ type: 'cms.Heading', props: { id: 'h', text: 'W panelu' } }] },
              { title: 'Stare', content: '<p>Zapisane</p>' },
            ],
          },
        },
      ],
    };
    const extraction = extract(data, declarations);
    expect(extraction.segments.map((s) => [s.kind, s.text])).toEqual([
      ['plain', 'Pytanie'],
      ['plain', 'Stare'],
      ['html', '<0/>Zapisane<1/>'],
      ['plain', 'W panelu'],
    ]);
    const identity = new Map(extraction.segments.map((s) => [s.id, s.text]));
    expect(inject(data, extraction, identity).data).toEqual(data);
  });
});

describe('inject', () => {
  it('with an identity translation returns a deep-equal copy', () => {
    const data = canvas();
    const extraction = extract(data, declarations);
    const identity = new Map(extraction.segments.map((s) => [s.id, s.text]));
    const result = inject(data, extraction, identity);
    expect(result.data).toEqual(canvas());
    expect(result.data).not.toBe(data);
    expect(result.translated).toBe(extraction.locations.length);
    expect(result.untranslated).toBe(0);
  });

  it('writes each translation to every location of its segment', () => {
    const data = canvas();
    const extraction = extract(data, declarations);
    const translations = new Map(extraction.segments.map((s) => [s.id, s.text]));
    const witaj = extraction.segments.find((s) => s.text === 'Witaj')!;
    translations.set(witaj.id, 'Welcome');
    const out = inject(data, extraction, translations).data as ReturnType<typeof canvas>;
    expect(out.content[0]!.props.text).toBe('Welcome');
    expect((out.content[1]!.props.content as Array<{ props: { content: Array<{ props: { text: string } }> } }>)[0]!.props.content[0]!.props.text).toBe('Welcome');
    expect(data.content[0]!.props.text).toBe('Witaj');
  });

  it('keeps a location whose translation fails validation and counts it', () => {
    const data = canvas();
    const extraction = extract(data, declarations);
    const translations = new Map(extraction.segments.map((s) => [s.id, s.text]));
    const html = extraction.segments.find((s) => s.kind === 'html')!;
    translations.set(html.id, 'Answer <1/>here<0/><2/><3/>');
    const inline = extraction.segments.find((s) => s.kind === 'inline')!;
    translations.delete(inline.id);
    const result = inject(data, extraction, translations);
    expect(result.untranslated).toBe(2);
    expect(result.data).toEqual(canvas());
  });

  it('rejects a plain translation that lost a placeholder or forged a tag', () => {
    const data = { root: {}, content: [{ type: 'cms.Heading', props: { id: 'h', text: 'Cześć {{customer.firstName}}' } }] };
    const extraction = extract(data, declarations);
    const id = extraction.segments[0]!.id;
    expect(inject(data, extraction, new Map([[id, 'Hi there']])).untranslated).toBe(1);
    expect(inject(data, extraction, new Map([[id, 'Hi <0>{{customer.firstName}}</0>']])).untranslated).toBe(1);
    expect(
      ((inject(data, extraction, new Map([[id, 'Hi {{customer.firstName}} &lt;3']])).data as { content: unknown[] }).content[0] as { props: { text: string } }).props.text,
    ).toBe('Hi {{customer.firstName}} <3');
  });
});

/**
 * Feature 163, T163 — a heading's inline rich text may hold an icon of the
 * catalog (`{type: 'inlineIcon', attrs: {name}}`). It travels as one atomic
 * `<n/>` tag: its name is never sent, a translation may move it, and one that
 * drops it leaves the heading as it was.
 */
describe('an inline icon in a heading (feature 163, T163)', () => {
  const ICON = { type: 'inlineIcon', attrs: { name: 'sparkles' } };
  const declarationsWithTitle: Declarations = (name) => (name === 'acme.Title' ? [{ path: 'title', format: 'tiptap' }] : undefined);
  const page = () => ({
    root: {},
    content: [
      {
        type: 'acme.Title',
        props: { id: 't', title: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nowe pomysły ' }, ICON] }] } },
      },
    ],
  });

  it('is one tag in the segment, without its name', () => {
    const extraction = extract(page(), declarationsWithTitle);
    expect(extraction.segments.map((segment) => segment.text)).toEqual(['Nowe pomysły <0/>']);
    expect(JSON.stringify(extraction.segments)).not.toContain('sparkles');
  });

  it('comes back unchanged with the translation, and a translation that drops it is refused', () => {
    const data = page();
    const extraction = extract(data, declarationsWithTitle);
    const id = extraction.segments[0]!.id;
    const out = inject(data, extraction, new Map([[id, '<0/> New ideas']]));
    expect(out.untranslated).toBe(0);
    expect(((out.data as { content: unknown[] }).content[0] as { props: { title: { content: Array<{ content: unknown[] }> } } }).props.title.content[0]!.content).toEqual([
      ICON,
      { type: 'text', text: ' New ideas' },
    ]);
    const dropped = inject(data, extraction, new Map([[id, 'New ideas']]));
    expect(dropped.untranslated).toBe(1);
    expect(dropped.data).toEqual(page());
  });
});
