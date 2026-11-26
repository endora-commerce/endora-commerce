import { describe, expect, it } from 'vitest';
import type {
  DocumentFieldDefinition,
  DocumentItem,
  DocumentItemSection,
  DocumentRenderContext,
  DocumentValue,
} from '@endora-commerce/contracts';
import { numberItems, renderItemsTable, type ItemsTableInput } from './items-table.js';

/**
 * T010, T043 — the Line items table, asserted on pdfmake definitions
 * (`specs/153-quote-request-pdf-template/contracts/document-collections.md` §3.2, §3.3).
 */

const money = (amount: number, currency = 'PLN'): DocumentValue => ({ kind: 'money', amount, currency });
const text = (value: string): DocumentValue => ({ kind: 'text', value });
const field = (path: string, over: Partial<DocumentFieldDefinition> = {}): DocumentFieldDefinition => ({
  path,
  label: `L:${path}`,
  valueKind: 'text',
  group: 'line',
  audience: 'customer',
  ...over,
});

const FIELDS: DocumentFieldDefinition[] = [
  field('row.number', { valueKind: 'number', defaultAlign: 'right', defaultFormat: { decimals: 0 } }),
  field('name'),
  field('price', { valueKind: 'money', defaultFormat: { decimals: 2 } }),
  field('discount', { valueKind: 'percent', defaultFormat: { decimals: 1 } }),
  field('note'),
  field('brand', { group: 'product' }),
];
const SUMMARY_FIELDS: DocumentFieldDefinition[] = [
  field('net', { valueKind: 'money' }),
  field('discounts', { valueKind: 'money' }),
];

const items = (rows: Record<string, DocumentValue>[]): DocumentItem[] => numberItems(rows.map((values) => ({ values })));

const LINES = items([
  { name: text('Bolt'), price: money(10), discount: null, note: text('Urgent'), brand: text('Acme') },
  { name: text('Nut'), price: money(2.5), discount: { kind: 'percent', value: 12.5 }, note: null, brand: text('Bolts Inc') },
  { name: text('Washer'), price: null, discount: null, note: null, brand: text('Acme') },
]);

const context: DocumentRenderContext = {
  documentType: 'acme.lines',
  language: 'en-US',
  salesChannelId: null,
  preview: false,
  pageWidth: 500,
};

const column = (id: string, fieldPath: string, over: Record<string, unknown> = {}) => ({
  id,
  field: fieldPath,
  label: '',
  width: 'auto',
  align: 'auto',
  format: {},
  emptyText: '',
  visibleWhen: { op: 'always' },
  ...over,
});

function render(props: Record<string, unknown>, over: Partial<ItemsTableInput> = {}) {
  return renderItemsTable({
    props,
    catalogue: { fields: FIELDS, summaryFields: SUMMARY_FIELDS },
    items: LINES,
    summary: { net: money(17.5), discounts: null },
    language: 'en-US',
    context,
    interpolate: (t) => t.replace('{{who}}', 'Anna'),
    ...over,
  }) as { stack: Record<string, unknown>[]; margin: number[] };
}

type Cell = { text?: string; colSpan?: number; alignment?: string; bold?: boolean; fillColor?: string; italics?: boolean };
const tableOf = (node: { stack: Record<string, unknown>[] }) =>
  node.stack[0] as { table: { headerRows: number; dontBreakRows: boolean; widths: unknown[]; body: Cell[][] }; fontSize: number };
const rowTexts = (body: Cell[][]) => body.map((row) => row.map((cell) => cell.text ?? ''));

describe('numberItems', () => {
  it('assigns row.number 1…n in item order without touching the input', () => {
    const input = [{ values: { name: text('a') } }, { values: { name: text('b') } }];
    const out = numberItems(input);
    expect(out.map((i) => i.values['row.number'])).toEqual([{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }]);
    expect(input[0]!.values).not.toHaveProperty('row.number');
  });
});

describe('renderItemsTable — columns (FR-032–FR-037)', () => {
  it('prints a real table: header row repeated, rows never split, catalogue labels by default', () => {
    const node = render({ columns: [column('c1', 'row.number'), column('c2', 'name'), column('c3', 'price')] });
    const table = tableOf(node);
    expect(table.table.headerRows).toBe(1);
    expect(table.table.dontBreakRows).toBe(true);
    expect(rowTexts(table.table.body)).toEqual([
      ['L:row.number', 'L:name', 'L:price'],
      ['1', 'Bolt', 'PLN\u00a010.00'],
      ['2', 'Nut', 'PLN\u00a02.50'],
      ['3', 'Washer', ''],
    ]);
    expect(node.margin).toEqual([0, 0, 0, 12]);
  });

  it('a header label replaces the catalogue name and is interpolated', () => {
    const table = tableOf(render({ columns: [column('c1', 'name', { label: 'For {{who}}' })] }));
    expect(table.table.body[0]![0]!.text).toBe('For Anna');
  });

  it('never drops a column; any_has_value drops it only when no line has a value', () => {
    const hidden = tableOf(
      render({
        columns: [
          column('c1', 'name'),
          column('c2', 'note', { visibleWhen: { op: 'never' } }),
          column('c3', 'discount', { visibleWhen: { op: 'any_has_value' } }),
        ],
      }),
    );
    expect(hidden.table.body[0]!.map((c) => c.text)).toEqual(['L:name', 'L:discount']);
    const noDiscount = items([{ name: text('a'), discount: null }]);
    const none = tableOf(
      render(
        { columns: [column('c1', 'name'), column('c3', 'discount', { visibleWhen: { op: 'any_has_value' } })] },
        { items: noDiscount },
      ),
    );
    expect(none.table.body[0]!.map((c) => c.text)).toEqual(['L:name']);
  });

  it('a rule may test another field', () => {
    const table = tableOf(
      render({ columns: [column('c1', 'name'), column('c2', 'price', { visibleWhen: { op: 'any_has_value', field: 'missing' } })] }),
    );
    expect(table.table.body[0]!.map((c) => c.text)).toEqual(['L:name']);
  });

  it('formats per kind with the column format over the field default, aligned by kind', () => {
    const table = tableOf(
      render({
        columns: [
          column('c1', 'price', { format: { currencyDisplay: 'none', decimals: 1 } }),
          column('c2', 'discount'),
          column('c3', 'name', { align: 'center' }),
        ],
      }),
    );
    expect(table.table.body[2]!.map((c) => c.text)).toEqual(['2.5', '12.5 %', 'Nut']);
    expect(table.table.body[1]!.map((c) => c.alignment)).toEqual(['right', 'right', 'center']);
    expect(table.table.body[0]!.map((c) => c.alignment)).toEqual(['right', 'right', 'center']);
  });

  it('prints the column empty text where a line has no value', () => {
    const table = tableOf(render({ columns: [column('c1', 'price', { emptyText: '—' })] }));
    expect(table.table.body[3]![0]!.text).toBe('—');
  });

  it('an unknown field prints its empty text in the body and nothing in the header (FR-037)', () => {
    const table = tableOf(render({ columns: [column('c1', 'name'), column('c2', 'attributes.gone', { emptyText: 'n/a' })] }));
    expect(rowTexts(table.table.body).map((row) => row[1])).toEqual(['', 'n/a', 'n/a', 'n/a']);
  });

  it('no line, or no visible column, prints the empty text instead of a grid', () => {
    const empty = render({ columns: [column('c1', 'name')], emptyText: 'No lines for {{who}}' }, { items: [] });
    expect(empty.stack[0]).toEqual({ text: 'No lines for Anna' });
    const allHidden = render({ columns: [column('c1', 'name', { visibleWhen: { op: 'never' } })], emptyText: 'Nothing' });
    expect(allHidden.stack[0]).toEqual({ text: 'Nothing' });
  });

  it('widths: auto, fill and points; fixed widths over the page are scaled down proportionally', () => {
    expect(
      tableOf(render({ columns: [column('a', 'name'), column('b', 'note', { width: 'fill' }), column('c', 'price', { width: 60 })] })).table
        .widths,
    ).toEqual(['auto', '*', 60]);
    const scaled = tableOf(render({ columns: [column('a', 'name', { width: 400 }), column('b', 'price', { width: 400 })] }));
    expect(scaled.table.widths).toEqual([250, 250]);
  });

  it('style: header fill, striped rows, font size, border colour', () => {
    const node = render({
      columns: [column('c1', 'name')],
      headerBackground: '#eeeeee',
      stripedRows: true,
      stripeColor: '#fafafa',
      fontSize: 11,
      borderColor: '#123456',
    });
    const table = tableOf(node) as ReturnType<typeof tableOf> & { layout: { hLineColor: () => string } };
    expect(table.table.body[0]![0]!.fillColor).toBe('#eeeeee');
    expect(table.table.body.slice(1).map((row) => row[0]!.fillColor)).toEqual([undefined, '#fafafa', undefined]);
    expect(table.fontSize).toBe(11);
    expect(table.layout.hLineColor()).toBe('#123456');
  });

  it('survives hostile props: wrong types read as defaults, an unknown op as always', () => {
    const node = render({
      columns: [
        { id: 1, field: 'name', label: 7, width: 'huge', align: 'justify', format: 'x', emptyText: 3, visibleWhen: { op: 'sometimes' } },
        'not a column',
        { field: 42 },
      ],
      fontSize: 'big',
      headerBackground: 'red',
      stripedRows: 'maybe',
      marginBottom: -5,
    });
    const table = tableOf(node);
    expect(rowTexts(table.table.body).map((row) => row[0])).toEqual(['L:name', 'Bolt', 'Nut', 'Washer']);
    expect(table.table.widths[0]).toBe('auto');
    expect(table.fontSize).toBe(9);
    expect(node.margin).toEqual([0, 0, 0, 0]);
    const nothing = render({ columns: 'nope' });
    expect(nothing.stack[0]).toEqual({ text: '' });
  });
});

describe('renderItemsTable — a column printed as a link (issue #1904)', () => {
  const LINKED_FIELDS: DocumentFieldDefinition[] = [
    field('name', { linkPath: 'url' }),
    field('url'),
    field('sku'),
  ];
  const LINKED = items([
    { name: text('Bolt'), url: text('https://shop.example.com/p/bolt'), sku: text('B-1') },
    { name: text('Nut'), url: null, sku: text('N-1') },
    { name: text('Washer'), url: text('javascript:alert(1)'), sku: text('W-1') },
  ]);
  const renderLinked = (columns: Record<string, unknown>[]) =>
    tableOf(render({ columns }, { catalogue: { fields: LINKED_FIELDS, summaryFields: [] }, items: LINKED }));
  type LinkCell = Cell & { link?: string; color?: string };

  it('links the value to the page its field declares, line by line; a line without an address prints plain text', () => {
    const body = renderLinked([column('c1', 'name', { link: true })]).table.body as LinkCell[][];
    expect(body[1]![0]).toMatchObject({ text: 'Bolt', link: 'https://shop.example.com/p/bolt', color: '#1d4ed8' });
    expect(body[2]![0]!.link).toBeUndefined();
    expect(body[2]![0]!.color).toBeUndefined();
    expect(body[3]![0]!.link).toBeUndefined();
    // The header is never a link.
    expect(body[0]![0]!.link).toBeUndefined();
  });

  it('is off by default, and reads the option as Puck stores it', () => {
    const off = renderLinked([column('c1', 'name')]).table.body as LinkCell[][];
    expect(off.flat().some((cell) => 'link' in cell)).toBe(false);
    const stored = renderLinked([column('c1', 'name', { link: 'true' })]).table.body as LinkCell[][];
    expect(stored[1]![0]!.link).toBe('https://shop.example.com/p/bolt');
  });

  it('a field that declares no URL field never links, whatever the option says', () => {
    const body = renderLinked([column('c1', 'sku', { link: true })]).table.body as LinkCell[][];
    expect(body.flat().some((cell) => 'link' in cell)).toBe(false);
  });

  it('a line whose value is empty prints the empty text, unlinked', () => {
    const body = tableOf(
      render(
        { columns: [column('c1', 'name', { link: true, emptyText: '—' })] },
        { catalogue: { fields: LINKED_FIELDS, summaryFields: [] }, items: items([{ name: null, url: text('https://shop.example.com/p/x') }]) },
      ),
    ).table.body as LinkCell[][];
    expect(body[1]![0]).toEqual({ text: '—', alignment: 'left' });
  });
});

describe('renderItemsTable — detail row (FR-040)', () => {
  const detailRow = {
    enabled: true,
    entries: [
      { field: 'note', label: 'Note', visibleWhen: { op: 'has_value' } },
      { field: 'brand', label: '', visibleWhen: { op: 'has_value' } },
      { field: 'name', label: 'Hidden', visibleWhen: { op: 'never' } },
    ],
    separator: ' | ',
    italics: true,
    fontSize: 7,
  };

  it('prints the entries that hold, label: value, joined, spanning the table; no row when none prints', () => {
    const table = tableOf(render({ columns: [column('c1', 'name'), column('c2', 'price')], detailRow }));
    const body = table.table.body;
    expect(body).toHaveLength(1 + 3 + 3);
    expect(body[2]![0]).toMatchObject({ text: 'Note: Urgent | Acme', colSpan: 2, italics: true, fontSize: 7 });
    expect(body[4]![0]!.text).toBe('Bolts Inc');
    expect(body[6]![0]!.text).toBe('Acme');
    const noBrand = items([{ name: text('x'), note: null, brand: null }]);
    expect(tableOf(render({ columns: [column('c1', 'name')], detailRow }, { items: noBrand })).table.body).toHaveLength(2);
  });

  it('is off unless enabled', () => {
    const table = tableOf(render({ columns: [column('c1', 'name')], detailRow: { ...detailRow, enabled: false } }));
    expect(table.table.body).toHaveLength(4);
  });
});

describe('renderItemsTable — totals (FR-041)', () => {
  it('prints the rows whose rule holds over the totals, in a separate right-aligned unbreakable table', () => {
    const node = render({
      columns: [column('c1', 'name')],
      totals: [
        { field: 'net', label: '', visibleWhen: { op: 'has_value' }, emphasis: true },
        { field: 'discounts', label: 'Discounts', visibleWhen: { op: 'has_value' } },
        { field: 'discounts', label: 'Discounts always', visibleWhen: { op: 'always' } },
        { field: 'net', label: 'Never', visibleWhen: { op: 'never' } },
        { field: 'unknown', label: 'Unknown', visibleWhen: { op: 'always' } },
      ],
    });
    const totals = node.stack[1] as { unbreakable: boolean; columns: [unknown, { table: { body: Cell[][] } }] };
    expect(totals.unbreakable).toBe(true);
    const body = totals.columns[1].table.body;
    expect(rowTexts(body)).toEqual([
      ['L:net', 'PLN\u00a017.50'],
      ['Discounts always', ''],
      ['Unknown', ''],
    ]);
    expect(body[0]!.every((cell) => cell.bold === true)).toBe(true);
    expect(body[1]![1]!.alignment).toBe('right');
  });

  it('prints no totals table when no row holds', () => {
    const node = render({ columns: [column('c1', 'name')], totals: [{ field: 'discounts', label: 'D' }] });
    expect(node.stack).toHaveLength(1);
  });
});

describe('renderItemsTable — grouping (FR-042)', () => {
  const lines = items([
    { name: text('a'), brand: text('Acme'), price: money(1) },
    { name: text('b'), brand: null, price: money(2) },
    { name: text('c'), brand: text('Bolts'), price: money(3) },
    { name: text('d'), brand: text('Acme'), price: money(4.25) },
  ]);

  it('groups in order of first appearance, keeps order within a group, never restarts the position', () => {
    const table = tableOf(
      render(
        {
          columns: [column('c1', 'row.number'), column('c2', 'name'), column('c3', 'price')],
          grouping: { field: 'brand', emptyLabel: 'Other', subtotalField: 'price', subtotalLabel: 'Subtotal' },
        },
        { items: lines },
      ),
    );
    expect(rowTexts(table.table.body)).toEqual([
      ['L:row.number', 'L:name', 'L:price'],
      ['Acme', '', ''],
      ['1', 'a', 'PLN\u00a01.00'],
      ['4', 'd', 'PLN\u00a04.25'],
      ['Subtotal', '', 'PLN\u00a05.25'],
      ['Other', '', ''],
      ['2', 'b', 'PLN\u00a02.00'],
      ['Subtotal', '', 'PLN\u00a02.00'],
      ['Bolts', '', ''],
      ['3', 'c', 'PLN\u00a03.00'],
      ['Subtotal', '', 'PLN\u00a03.00'],
    ]);
    expect(table.table.body[1]![0]).toMatchObject({ colSpan: 3, bold: true });
    expect(table.table.body[4]![0]).toMatchObject({ colSpan: 2, alignment: 'right' });
  });

  it('a subtotal of mixed currencies prints nothing; no subtotal field, no subtotal row', () => {
    const mixed = items([
      { name: text('a'), brand: text('X'), price: money(1) },
      { name: text('b'), brand: text('X'), price: money(1, 'EUR') },
    ]);
    const table = tableOf(
      render(
        { columns: [column('c1', 'name'), column('c2', 'price')], grouping: { field: 'brand', subtotalField: 'price', subtotalLabel: 'S' } },
        { items: mixed },
      ),
    );
    expect(rowTexts(table.table.body).at(-1)).toEqual(['S', '']);
    const plain = tableOf(
      render({ columns: [column('c1', 'name')], grouping: { field: 'brand', subtotalField: null } }, { items: mixed }),
    );
    expect(plain.table.body).toHaveLength(1 + 1 + 2);
  });
});

describe('renderItemsTable — preview samples', () => {
  it('fills a field’s sample value where a preview line has none', () => {
    const fields = [...FIELDS, field('attributes.colour', { sampleValue: text('Example') })];
    const table = tableOf(
      render(
        { columns: [column('c1', 'attributes.colour')] },
        { catalogue: { fields, summaryFields: [] }, context: { ...context, preview: true } },
      ),
    );
    expect(rowTexts(table.table.body).map((row) => row[0])).toEqual(['L:attributes.colour', 'Example', 'Example', 'Example']);
    const real = tableOf(render({ columns: [column('c1', 'attributes.colour')] }, { catalogue: { fields, summaryFields: [] } }));
    expect(rowTexts(real.table.body).map((row) => row[0])).toEqual(['L:attributes.colour', '', '', '']);
  });
});

// ---------------------------------------------------------------------------
// Feature 159 — the document's groups (`specs/159-quote-request-item-groups/contracts/document-sections.md` §3)
// ---------------------------------------------------------------------------

/**
 * The flat definitions the table printed before feature 159, recorded from the
 * pre-feature renderer (`FLAT_153`, at the end of this file). A document
 * with no group must print them byte for byte (SC-004) whatever the table's
 * grouping says and whether or not the type declares sections.
 */
const FLAT_CASES: Record<string, Record<string, unknown>> = {
  bare: { columns: [column('c1', 'row.number'), column('c2', 'name'), column('c3', 'price')], grouping: null },
  styled: {
    columns: [column('c1', 'name', { width: 'fill' }), column('c2', 'discount', { visibleWhen: { op: 'any_has_value' } }), column('c3', 'price', { width: 80 })],
    headerBackground: '#eeeeee',
    stripedRows: true,
    stripeColor: '#fafafa',
    fontSize: 10,
    borderColor: '#123456',
    marginBottom: 20,
  },
  detailAndTotals: {
    columns: [column('c1', 'row.number'), column('c2', 'name'), column('c3', 'price')],
    detailRow: { enabled: true, entries: [{ field: 'note', label: 'Note', visibleWhen: { op: 'has_value' } }, { field: 'brand', label: '' }] },
    totals: [
      { field: 'net', label: 'Net', visibleWhen: { op: 'has_value' }, emphasis: true },
      { field: 'discounts', label: 'Discounts', visibleWhen: { op: 'has_value' } },
    ],
    grouping: null,
    emptyText: 'No lines',
  },
  byField: {
    columns: [column('c1', 'row.number'), column('c2', 'name'), column('c3', 'price')],
    grouping: { field: 'brand', emptyLabel: 'Other', subtotalField: 'price', subtotalLabel: 'Subtotal' },
    totals: [{ field: 'net', label: '', visibleWhen: { op: 'always' } }],
  },
};
const asJson = (node: unknown): unknown => JSON.parse(JSON.stringify(node));
const recorded = (): Record<string, unknown> => FLAT_153;

const priced = (amount: number | null): Record<string, DocumentValue> => ({ net: amount === null ? null : money(amount), discounts: null });
const GROUPED: DocumentItemSection[] = [
  { key: 'g-a', kind: 'group', label: 'Hall A', itemIndexes: [0, 1], summary: priced(12.5) },
  { key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [2], summary: priced(null) },
];
const ONLY_UNGROUPED: DocumentItemSection[] = [{ key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [0, 1, 2], summary: priced(17.5) }];

describe('renderItemsTable — a document without groups prints as before (159 SC-004)', () => {
  it.each(Object.keys(FLAT_CASES))('%s: byte-identical to the pre-feature definition', (name) => {
    const expected = recorded()[name];
    const props = FLAT_CASES[name]!;
    expect(asJson(render(props))).toEqual(expected);
    expect(asJson(render(props, { sections: [] }))).toEqual(expected);
    expect(asJson(render(props, { sections: ONLY_UNGROUPED }))).toEqual(expected);
  });

  it('null, absent and an explicit sections mode all print flat when no section is a group', () => {
    const base = FLAT_CASES['detailAndTotals']!;
    const expected = recorded()['detailAndTotals'];
    const { grouping: _grouping, ...absent } = base;
    expect(asJson(render(absent, { sections: ONLY_UNGROUPED }))).toEqual(expected);
    expect(asJson(render({ ...base, grouping: { by: 'sections', otherItemsLabel: 'Rest', showItemCount: true } }, { sections: ONLY_UNGROUPED }))).toEqual(expected);
  });
});

describe('renderItemsTable — sections (159 FR-042, FR-043)', () => {
  const props = {
    columns: [column('c1', 'row.number'), column('c2', 'name'), column('c3', 'price')],
    totals: [
      { field: 'net', label: 'Net', visibleWhen: { op: 'has_value' }, emphasis: true },
      { field: 'discounts', label: '', visibleWhen: { op: 'always' } },
      { field: 'net', label: 'Hidden', visibleWhen: { op: 'never' } },
    ],
    grouping: null,
    headerBackground: '#eeeeee',
  };

  it('prints a heading, the rows and the table’s totals rows per section, Other items last, positions continuous', () => {
    const node = render(props, { sections: GROUPED });
    const table = tableOf(node);
    expect(rowTexts(table.table.body)).toEqual([
      ['L:row.number', 'L:name', 'L:price'],
      ['Hall A · 2 items', '', ''],
      ['1', 'Bolt', 'PLN\u00a010.00'],
      ['2', 'Nut', 'PLN\u00a02.50'],
      ['Net', '', 'PLN\u00a012.50'],
      ['L:discounts', '', ''],
      ['Other items · 1 item', '', ''],
      ['3', 'Washer', ''],
      ['L:discounts', '', ''],
    ]);
    expect(table.table.body[1]![0]).toMatchObject({ colSpan: 3, bold: true, fillColor: '#eeeeee' });
    expect(table.table.body[4]![0]).toMatchObject({ colSpan: 2, alignment: 'right' });
    expect(table.table.body[4]![0]!.bold).toBeUndefined();
    expect(table.table.body[4]![2]).toMatchObject({ alignment: 'right' });
    // The document's totals still follow, from the document's summary.
    const totals = node.stack[1] as { columns: [unknown, { table: { body: Cell[][] } }] };
    expect(rowTexts(totals.columns[1].table.body)[0]).toEqual(['Net', 'PLN\u00a017.50']);
  });

  it('the Other items heading: the template’s text, interpolated; the count can be switched off', () => {
    const table = tableOf(
      render({ ...props, totals: [], grouping: { by: 'sections', otherItemsLabel: 'Rest for {{who}}', showItemCount: false } }, { sections: GROUPED }),
    );
    expect(rowTexts(table.table.body).map((row) => row[0])).toEqual(['L:row.number', 'Hall A', '1', '2', 'Rest for Anna', '3']);
  });

  it('Polish: Pozostałe pozycje and the plural forms of the count', () => {
    const many = numberItems(Array.from({ length: 6 }, (_, i) => ({ values: { name: text(`n${i}`) } })));
    const sections: DocumentItemSection[] = [
      { key: 'a', kind: 'group', label: 'Hala A', itemIndexes: [0], summary: {} },
      { key: 'b', kind: 'group', label: 'Hala B', itemIndexes: [1, 2, 3, 4, 5], summary: {} },
    ];
    const table = tableOf(render({ columns: [column('c1', 'name')] }, { items: many, sections, language: 'pl-PL' }));
    expect(rowTexts(table.table.body).filter((row) => row[0]!.startsWith('Hala'))).toEqual([['Hala A · 1 pozycja'], ['Hala B · 5 pozycji']]);
    const withRest = tableOf(
      render(
        { columns: [column('c1', 'name')] },
        { items: many.slice(0, 4), sections: [sections[0]!, { key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [1, 2, 3], summary: {} }], language: 'pl-PL' },
      ),
    );
    expect(rowTexts(withRest.table.body).at(1 + 1 + 1)).toEqual(['Pozostałe pozycje · 3 pozycje']);
  });

  it('striping continues across sections; detail rows stay with their line', () => {
    const table = tableOf(
      render(
        { ...props, totals: [], stripedRows: true, stripeColor: '#fafafa', detailRow: { enabled: true, entries: [{ field: 'note', label: '' }] } },
        { sections: GROUPED },
      ),
    );
    const body = table.table.body;
    expect(rowTexts(body).map((row) => row[0])).toEqual(['L:row.number', 'Hall A · 2 items', '1', 'Urgent', '2', 'Other items · 1 item', '3']);
    expect([body[2]![0]!.fillColor, body[4]![0]!.fillColor, body[6]![0]!.fillColor]).toEqual([undefined, '#fafafa', undefined]);
  });

  it('no totals rows: no subtotal rows', () => {
    const table = tableOf(render({ ...props, totals: undefined }, { sections: GROUPED }));
    expect(table.table.body).toHaveLength(1 + 1 + 2 + 1 + 1);
  });

  it('a one-column table prints the subtotal label and value in one right-aligned cell', () => {
    const table = tableOf(render({ ...props, columns: [column('c2', 'name')] }, { sections: GROUPED }));
    expect(table.table.body[4]).toEqual([{ text: 'Net PLN\u00a012.50', alignment: 'right' }]);
  });

  it('No grouping prints flat although the document has groups', () => {
    const flat = asJson(render({ ...props, grouping: null }));
    expect(asJson(render({ ...props, grouping: { by: 'none' } }, { sections: GROUPED }))).toEqual(flat);
  });

  it('grouping by a field ignores the document’s groups, exactly as 153', () => {
    const expected = recorded()['byField'];
    expect(asJson(render(FLAT_CASES['byField']!, { sections: GROUPED }))).toEqual(expected);
    expect(asJson(render({ ...FLAT_CASES['byField']!, grouping: { by: 'field', ...(FLAT_CASES['byField']!['grouping'] as object) } }, { sections: GROUPED }))).toEqual(expected);
  });

  it('a partition the table cannot use prints flat', () => {
    const flat = asJson(render(props));
    const broken: DocumentItemSection[] = [
      { key: 'g-a', kind: 'group', label: 'Hall A', itemIndexes: [0, 2], summary: {} },
      { key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [1], summary: {} },
    ];
    expect(asJson(render(props, { sections: broken }))).toEqual(flat);
    expect(asJson(render(props, { sections: [GROUPED[0]!] }))).toEqual(flat);
  });

  it('a group heading is the administrator’s name, never interpolated or translated', () => {
    const sections: DocumentItemSection[] = [{ ...GROUPED[0]!, label: '{{who}} floor', itemIndexes: [0, 1, 2] }];
    const table = tableOf(render({ ...props, totals: [] }, { sections }));
    expect(table.table.body[1]![0]!.text).toBe('{{who}} floor · 3 items');
  });
});

/**
 * `FLAT_CASES` as the Line items table rendered them before feature 159 —
 * recorded once from the renderer as 153 left it, as JSON (the table `layout`
 * functions do not serialise; their code is unchanged). Never re-record this
 * to make a test pass: a difference here is a change to every ungrouped PDF.
 */
const FLAT_153: Record<string, unknown> = {
  "bare": {
    "stack": [
      {
        "table": {
          "headerRows": 1,
          "dontBreakRows": true,
          "widths": [
            "auto",
            "auto",
            "auto"
          ],
          "body": [
            [
              {
                "text": "L:row.number",
                "bold": true,
                "alignment": "right",
                "fillColor": "#f1f5f9"
              },
              {
                "text": "L:name",
                "bold": true,
                "alignment": "left",
                "fillColor": "#f1f5f9"
              },
              {
                "text": "L:price",
                "bold": true,
                "alignment": "right",
                "fillColor": "#f1f5f9"
              }
            ],
            [
              {
                "text": "1",
                "alignment": "right"
              },
              {
                "text": "Bolt",
                "alignment": "left"
              },
              {
                "text": "PLN 10.00",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "2",
                "alignment": "right"
              },
              {
                "text": "Nut",
                "alignment": "left"
              },
              {
                "text": "PLN 2.50",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "3",
                "alignment": "right"
              },
              {
                "text": "Washer",
                "alignment": "left"
              },
              {
                "text": "",
                "alignment": "right"
              }
            ]
          ]
        },
        "fontSize": 9,
        "layout": {}
      }
    ],
    "margin": [
      0,
      0,
      0,
      12
    ]
  },
  "styled": {
    "stack": [
      {
        "table": {
          "headerRows": 1,
          "dontBreakRows": true,
          "widths": [
            "*",
            "auto",
            80
          ],
          "body": [
            [
              {
                "text": "L:name",
                "bold": true,
                "alignment": "left",
                "fillColor": "#eeeeee"
              },
              {
                "text": "L:discount",
                "bold": true,
                "alignment": "right",
                "fillColor": "#eeeeee"
              },
              {
                "text": "L:price",
                "bold": true,
                "alignment": "right",
                "fillColor": "#eeeeee"
              }
            ],
            [
              {
                "text": "Bolt",
                "alignment": "left"
              },
              {
                "text": "",
                "alignment": "right"
              },
              {
                "text": "PLN 10.00",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Nut",
                "alignment": "left",
                "fillColor": "#fafafa"
              },
              {
                "text": "12.5 %",
                "alignment": "right",
                "fillColor": "#fafafa"
              },
              {
                "text": "PLN 2.50",
                "alignment": "right",
                "fillColor": "#fafafa"
              }
            ],
            [
              {
                "text": "Washer",
                "alignment": "left"
              },
              {
                "text": "",
                "alignment": "right"
              },
              {
                "text": "",
                "alignment": "right"
              }
            ]
          ]
        },
        "fontSize": 10,
        "layout": {}
      }
    ],
    "margin": [
      0,
      0,
      0,
      20
    ]
  },
  "detailAndTotals": {
    "stack": [
      {
        "table": {
          "headerRows": 1,
          "dontBreakRows": true,
          "widths": [
            "auto",
            "auto",
            "auto"
          ],
          "body": [
            [
              {
                "text": "L:row.number",
                "bold": true,
                "alignment": "right",
                "fillColor": "#f1f5f9"
              },
              {
                "text": "L:name",
                "bold": true,
                "alignment": "left",
                "fillColor": "#f1f5f9"
              },
              {
                "text": "L:price",
                "bold": true,
                "alignment": "right",
                "fillColor": "#f1f5f9"
              }
            ],
            [
              {
                "text": "1",
                "alignment": "right"
              },
              {
                "text": "Bolt",
                "alignment": "left"
              },
              {
                "text": "PLN 10.00",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Note: Urgent · Acme",
                "colSpan": 3,
                "italics": true,
                "fontSize": 8,
                "color": "#475569"
              },
              {
                "text": ""
              },
              {
                "text": ""
              }
            ],
            [
              {
                "text": "2",
                "alignment": "right"
              },
              {
                "text": "Nut",
                "alignment": "left"
              },
              {
                "text": "PLN 2.50",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Bolts Inc",
                "colSpan": 3,
                "italics": true,
                "fontSize": 8,
                "color": "#475569"
              },
              {
                "text": ""
              },
              {
                "text": ""
              }
            ],
            [
              {
                "text": "3",
                "alignment": "right"
              },
              {
                "text": "Washer",
                "alignment": "left"
              },
              {
                "text": "",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Acme",
                "colSpan": 3,
                "italics": true,
                "fontSize": 8,
                "color": "#475569"
              },
              {
                "text": ""
              },
              {
                "text": ""
              }
            ]
          ]
        },
        "fontSize": 9,
        "layout": {}
      },
      {
        "unbreakable": true,
        "margin": [
          0,
          6,
          0,
          0
        ],
        "columns": [
          {
            "width": "*",
            "text": ""
          },
          {
            "width": "auto",
            "table": {
              "widths": [
                "auto",
                "auto"
              ],
              "body": [
                [
                  {
                    "text": "Net",
                    "alignment": "right",
                    "bold": true,
                    "border": [
                      false,
                      true,
                      false,
                      false
                    ]
                  },
                  {
                    "text": "PLN 17.50",
                    "alignment": "right",
                    "bold": true,
                    "border": [
                      false,
                      true,
                      false,
                      false
                    ]
                  }
                ]
              ]
            },
            "layout": {}
          }
        ]
      }
    ],
    "margin": [
      0,
      0,
      0,
      12
    ]
  },
  "byField": {
    "stack": [
      {
        "table": {
          "headerRows": 1,
          "dontBreakRows": true,
          "widths": [
            "auto",
            "auto",
            "auto"
          ],
          "body": [
            [
              {
                "text": "L:row.number",
                "bold": true,
                "alignment": "right",
                "fillColor": "#f1f5f9"
              },
              {
                "text": "L:name",
                "bold": true,
                "alignment": "left",
                "fillColor": "#f1f5f9"
              },
              {
                "text": "L:price",
                "bold": true,
                "alignment": "right",
                "fillColor": "#f1f5f9"
              }
            ],
            [
              {
                "text": "Acme",
                "colSpan": 3,
                "bold": true,
                "fillColor": "#f1f5f9"
              },
              {
                "text": ""
              },
              {
                "text": ""
              }
            ],
            [
              {
                "text": "1",
                "alignment": "right"
              },
              {
                "text": "Bolt",
                "alignment": "left"
              },
              {
                "text": "PLN 10.00",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "3",
                "alignment": "right"
              },
              {
                "text": "Washer",
                "alignment": "left"
              },
              {
                "text": "",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Subtotal",
                "colSpan": 2,
                "bold": true,
                "alignment": "right"
              },
              {
                "text": ""
              },
              {
                "text": "PLN 10.00",
                "bold": true,
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Bolts Inc",
                "colSpan": 3,
                "bold": true,
                "fillColor": "#f1f5f9"
              },
              {
                "text": ""
              },
              {
                "text": ""
              }
            ],
            [
              {
                "text": "2",
                "alignment": "right"
              },
              {
                "text": "Nut",
                "alignment": "left"
              },
              {
                "text": "PLN 2.50",
                "alignment": "right"
              }
            ],
            [
              {
                "text": "Subtotal",
                "colSpan": 2,
                "bold": true,
                "alignment": "right"
              },
              {
                "text": ""
              },
              {
                "text": "PLN 2.50",
                "bold": true,
                "alignment": "right"
              }
            ]
          ]
        },
        "fontSize": 9,
        "layout": {}
      },
      {
        "unbreakable": true,
        "margin": [
          0,
          6,
          0,
          0
        ],
        "columns": [
          {
            "width": "*",
            "text": ""
          },
          {
            "width": "auto",
            "table": {
              "widths": [
                "auto",
                "auto"
              ],
              "body": [
                [
                  {
                    "text": "L:net",
                    "alignment": "right",
                    "border": [
                      false,
                      false,
                      false,
                      false
                    ]
                  },
                  {
                    "text": "PLN 17.50",
                    "alignment": "right",
                    "border": [
                      false,
                      false,
                      false,
                      false
                    ]
                  }
                ]
              ]
            },
            "layout": {}
          }
        ]
      }
    ],
    "margin": [
      0,
      0,
      0,
      12
    ]
  }
};
